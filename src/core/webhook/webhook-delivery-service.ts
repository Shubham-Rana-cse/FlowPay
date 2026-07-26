/**
 * Webhook Delivery Service (Phase 0 §4/§8.3/§11 Decision #2; FR15).
 *
 * One row per **delivery attempt** to the merchant's endpoint — a single
 * WebhookEvent can have many WebhookDelivery rows if retried, exactly like
 * PaymentAttempt is to Payment (Phase 0 §4). Signing follows Open Design
 * Decision #2: HMAC-SHA256 over the raw JSON body, using
 * `MerchantSettings.webhookSecret`, sent as `X-Signature`.
 *
 * Phase 5 makes one HTTP attempt per call and records the outcome
 * (DELIVERED, or RETRYING/FAILED with a `nextRetryAt` computed via the same
 * exponential-backoff shape `payment-service.ts` already uses for
 * authorize-attempt retries).
 *
 * Phase 6 adds `pollDueWebhookDeliveries`, the background poller that picks
 * `nextRetryAt` rows back up automatically — the same DB-column-plus-cron
 * mechanism `retry-service.ts`'s payment poller uses (Open Design
 * Decision #1), invoked via `POST /api/internal/cron/webhook-retry`.
 * `redeliverWebhookEvent` remains the merchant-triggered "Retry" button in
 * the dashboard for forcing an attempt right now instead of waiting for
 * either `nextRetryAt` or the poller's next tick.
 */
import { prisma } from "@/lib/db";
import { createHmac } from "crypto";
import { WebhookDeliveryStatus } from "@/constants/status";
import { logger } from "@/lib/logger";
import type { WebhookDelivery } from "@/generated/prisma";

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 5000;

function backoffMs(attemptNumber: number): number {
  // 30s, 1m, 2m, 4m, 8m — same doubling shape as payment-service.ts's
  // in-request retry backoff, just scaled for an out-of-band HTTP callback
  // instead of a same-request provider call.
  return 30_000 * 2 ** (attemptNumber - 1);
}

/** HMAC-SHA256 signature over the raw JSON body — Open Design Decision #2. */
export function signPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function serializeDelivery(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    webhook_event_id: delivery.webhookEventId,
    status: delivery.status,
    attempt_count: delivery.attemptCount,
    next_retry_at: delivery.nextRetryAt,
    delivered_at: delivery.deliveredAt,
    created_at: delivery.createdAt,
  };
}

export class WebhookEventNotFoundError extends Error {
  constructor() {
    super("Webhook event not found");
    this.name = "WebhookEventNotFoundError";
  }
}

/**
 * Makes exactly one HTTP POST attempt to the merchant's webhook URL and
 * writes exactly one WebhookDelivery row reflecting the outcome. Never
 * throws — a merchant's endpoint being down must not affect the request
 * that triggered the event (see webhook-event-service.ts's dispatch call
 * site, which is always outside the DB transaction that changed payment
 * state, for the same reason).
 */
export async function attemptDelivery(webhookEventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: webhookEventId },
    include: { merchant: { include: { settings: true } } },
  });
  if (!event) {
    logger.warn("Webhook delivery attempted for unknown event", { webhookEventId });
    return;
  }

  const webhookUrl = event.merchant.settings?.webhookUrl;
  if (!webhookUrl) {
    // No endpoint configured (FR4) — nothing to deliver to. Not an error;
    // most merchants in this project never set one up.
    return;
  }

  const priorAttempts = await prisma.webhookDelivery.count({ where: { webhookEventId } });
  const attemptNumber = priorAttempts + 1;

  const rawBody = JSON.stringify({
    id: event.id,
    type: event.eventType,
    created_at: event.createdAt,
    data: event.payload,
  });
  const signature = signPayload(rawBody, event.merchant.settings!.webhookSecret);

  let delivered = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Webhook-Id": event.id,
          "X-Webhook-Attempt": String(attemptNumber),
        },
        body: rawBody,
        signal: controller.signal,
      });
      delivered = res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn("Webhook delivery attempt failed", {
      webhookEventId,
      attemptNumber,
      error: (err as Error).message,
    });
  }

  const exhausted = attemptNumber >= MAX_DELIVERY_ATTEMPTS;

  await prisma.webhookDelivery.create({
    data: {
      webhookEventId,
      status: delivered
        ? WebhookDeliveryStatus.DELIVERED
        : exhausted
          ? WebhookDeliveryStatus.FAILED
          : WebhookDeliveryStatus.RETRYING,
      attemptCount: attemptNumber,
      deliveredAt: delivered ? new Date() : null,
      nextRetryAt:
        !delivered && !exhausted ? new Date(Date.now() + backoffMs(attemptNumber)) : null,
    },
  });
}

/**
 * Merchant-triggered re-delivery (dashboard "Retry" button) — makes another
 * attempt right now rather than waiting for `nextRetryAt` and Phase 6's
 * poller. Shares `attemptDelivery`'s exact logic, so a manual retry and an
 * eventual automatic one behave identically.
 */
export async function redeliverWebhookEvent(merchantId: string, webhookEventId: string) {
  const event = await prisma.webhookEvent.findFirst({ where: { id: webhookEventId, merchantId } });
  if (!event) throw new WebhookEventNotFoundError();

  await attemptDelivery(webhookEventId);
  return getDeliveriesForEvent(merchantId, webhookEventId);
}

// Bounded per poll — same reasoning as retry-service.ts's payment poller:
// one slow cron tick shouldn't be allowed to run unbounded work.
const POLL_BATCH_SIZE = 100;

export type WebhookRetryPollResult = {
  scanned: number;
  delivered: number;
  stillFailing: number;
};

/**
 * Phase 6 — the automatic counterpart to `redeliverWebhookEvent`. Finds
 * every WebhookEvent whose *most recent* delivery is still `RETRYING` with
 * an elapsed `nextRetryAt`, and makes another attempt via `attemptDelivery`.
 * Only the latest delivery row per event is consulted — an event with
 * deliveries #1 (FAILED-turned-RETRYING) and #2 (a later RETRYING) should
 * only be actioned once, not once per stale row.
 *
 * Meant to be invoked by an external scheduler hitting
 * `POST /api/internal/cron/webhook-retry` (see that route and
 * `vercel.json`). Safe to call repeatedly/concurrently: `attemptDelivery`
 * always appends a new row rather than mutating an existing one, so two
 * overlapping poller ticks just produce two delivery attempts instead of
 * corrupting state — at worst a harmless duplicate POST to the merchant's
 * endpoint, same as any at-least-once delivery guarantee (NFR:
 * Reliability).
 */
/* export async function pollDueWebhookDeliveries(now: Date = new Date()): Promise<WebhookRetryPollResult> {
  const candidates = await prisma.webhookDelivery.findMany({
    where: {
      status: WebhookDeliveryStatus.RETRYING,
      nextRetryAt: { lte: now },
    },
    orderBy: { createdAt: "desc" },
    take: POLL_BATCH_SIZE,
  });

  // Dedupe to the latest RETRYING row per event, in case an event has
  // several historical RETRYING rows that would otherwise all match.
  const dueEventIds = new Map<string, boolean>();
  for (const delivery of candidates) {
    if (!dueEventIds.has(delivery.webhookEventId)) {
      dueEventIds.set(delivery.webhookEventId, true);
    }
  }

  const result: WebhookRetryPollResult = {
    scanned: dueEventIds.size,
    delivered: 0,
    stillFailing: 0,
  };

  for (const webhookEventId of dueEventIds.keys()) {
    try {
      const beforeCount = await prisma.webhookDelivery.count({ where: { webhookEventId } });
      await attemptDelivery(webhookEventId);
      const afterCount = await prisma.webhookDelivery.count({ where: { webhookEventId } });

      // attemptDelivery is a no-op (writes nothing) if the merchant's
      // webhookUrl was cleared since this row was created — the count
      // comparison guards against mistakenly reporting that as a delivery.
      if (afterCount > beforeCount) {
        const latest = await prisma.webhookDelivery.findFirst({
          where: { webhookEventId },
          orderBy: { createdAt: "desc" },
        });
        if (latest?.status === WebhookDeliveryStatus.DELIVERED) result.delivered += 1;
        else result.stillFailing += 1;
      }
    } catch (err) {
      logger.error("Webhook retry poll failed for one event", {
        webhookEventId,
        error: (err as Error).message,
      });
    }
  }

  return result;
} */

export async function pollDueWebhookDeliveries(now: Date = new Date()): Promise<WebhookRetryPollResult> {
  // Get latest delivery for every webhook event
  const latestDeliveries = await prisma.webhookDelivery.findMany({
    orderBy: [
      { webhookEventId: "asc" },
      { createdAt: "desc" },
    ],
  });

  // Keep only the newest delivery row for each event
  const latestPerEvent = new Map<string, typeof latestDeliveries[number]>();

  for (const delivery of latestDeliveries) {
    if (!latestPerEvent.has(delivery.webhookEventId)) {
      latestPerEvent.set(delivery.webhookEventId, delivery);
    }
  }

  const due = [...latestPerEvent.values()].filter(
    (d) =>
      d.status === WebhookDeliveryStatus.RETRYING &&
      d.nextRetryAt !== null &&
      d.nextRetryAt <= now
  );

  const result: WebhookRetryPollResult = {
    scanned: due.length,
    delivered: 0,
    stillFailing: 0,
  };

  for (const delivery of due) {
    try {
      const beforeCount = await prisma.webhookDelivery.count({
        where: { webhookEventId: delivery.webhookEventId },
      });

      await attemptDelivery(delivery.webhookEventId);

      const afterCount = await prisma.webhookDelivery.count({
        where: { webhookEventId: delivery.webhookEventId },
      });

      if (afterCount > beforeCount) {
        const latest = await prisma.webhookDelivery.findFirst({
          where: { webhookEventId: delivery.webhookEventId },
          orderBy: { createdAt: "desc" },
        });

        if (latest?.status === WebhookDeliveryStatus.DELIVERED) {
          result.delivered++;
        } else {
          result.stillFailing++;
        }
      }
    } catch (err) {
      logger.error("Webhook retry poll failed for one event", {
        webhookEventId: delivery.webhookEventId,
        error: (err as Error).message,
      });
    }
  }

  return result;
}

export async function getDeliveriesForEvent(merchantId: string, webhookEventId: string) {
  const event = await prisma.webhookEvent.findFirst({ where: { id: webhookEventId, merchantId } });
  if (!event) throw new WebhookEventNotFoundError();

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookEventId },
    orderBy: { createdAt: "asc" },
  });
  return deliveries.map(serializeDelivery);
}

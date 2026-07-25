/**
 * Webhook Event Service (Phase 0 §4/§8.3; FR15).
 *
 * One row per **logical business event** (e.g. `payment.captured`), created
 * once — the "what happened" half of Phase 0 §4's WebhookEvent/
 * WebhookDelivery split. Delivery attempts (the "did it reach the merchant"
 * half) live in webhook-delivery-service.ts.
 *
 * `dispatchWebhookEvent` is the one function every other service calls.
 * It's intentionally called *after* the caller's own DB transaction has
 * committed (see payment-service.ts's performCapture, refund-service.ts's
 * createRefund, settlement-service.ts's createSettlement) — a webhook is a
 * network call to a third party, and holding a DB transaction open across
 * one would turn a slow/unreachable merchant endpoint into a lock held on
 * the Payment row. It also never throws: a webhook failing to dispatch must
 * never turn a successful payment/refund/settlement into an error response.
 */
import { prisma } from "@/lib/db";
import { attemptDelivery } from "./webhook-delivery-service";
import { logger } from "@/lib/logger";
import type { WebhookEventType } from "@/constants/status";
import type { Prisma, WebhookEvent } from "@/generated/prisma";

function serializeEvent(event: WebhookEvent) {
  return {
    id: event.id,
    event_type: event.eventType,
    payload: event.payload,
    created_at: event.createdAt,
  };
}

/**
 * Creates the WebhookEvent row and makes the first delivery attempt.
 * Fire-and-forget from the caller's point of view: any failure (including
 * the merchant having no webhookUrl configured at all) is logged, never
 * propagated.
 */
export async function dispatchWebhookEvent(
  merchantId: string,
  eventType: WebhookEventType,
  payload: Prisma.InputJsonValue
): Promise<void> {
  try {
    const event = await prisma.webhookEvent.create({
      data: { merchantId, eventType, payload },
    });
    await attemptDelivery(event.id);
  } catch (err) {
    logger.error("Webhook event dispatch failed", {
      merchantId,
      eventType,
      error: (err as Error).message,
    });
  }
}

/** Recent webhook activity for the dashboard (event + its delivery attempts). */
export async function listWebhookEventsForMerchant(merchantId: string, limit = 25) {
  const events = await prisma.webhookEvent.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { deliveries: { orderBy: { createdAt: "asc" } } },
  });

  return events.map((event) => ({
    ...serializeEvent(event),
    deliveries: event.deliveries.map((d) => ({
      id: d.id,
      status: d.status,
      attempt_count: d.attemptCount,
      next_retry_at: d.nextRetryAt,
      delivered_at: d.deliveredAt,
      created_at: d.createdAt,
    })),
  }));
}

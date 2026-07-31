/**
 * Retry Service (Phase 6, Open Design Decision #1; FR12).
 *
 * The cross-request half of payment retries: payment-service.ts's inline,
 * same-request retries (3 attempts, 50/100/200ms) are exhausted before a
 * Payment ever lands in TIMEOUT or RETRY with `nextRetryAt` set (see
 * `runAuthorizationPipeline`). This service is the polling job that Open
 * Design Decision #1 always intended to pair with that DB column.
 *
 * Rather than blindly re-authorizing — which, against the deterministic
 * Mock Bank, would just reproduce the exact same timeout/network-error
 * forever, since the outcome is derived from the unchanged payment amount —
 * `pollPaymentRetries` asks the provider what actually happened via
 * `ProviderAdapter.checkStatus`, exactly the method Phase 3 reserved for
 * this (see mock-bank-adapter.ts's `checkStatus` comment). A transient
 * failure means the *original* request didn't get a definitive answer, not
 * that the payment definitely failed; checking status later is the correct
 * recovery, not re-submitting a fresh authorization attempt.
 *
 * `pollPaymentRetries` is meant to be invoked by an external scheduler
 * (cron) hitting `POST /api/internal/cron/payment-retry` — see that route
 * and `vercel.json`. It's safe to call repeatedly or concurrently: every
 * state change here goes through `transitionPayment`'s guarded
 * compare-and-swap (same helper every other service already uses), so two
 * overlapping poller runs — or a poller run racing a merchant's own
 * GET/capture call — can never double-process the same Payment.
 */
import { prisma } from "@/lib/db";
import { PaymentStatus, PaymentEventType, WebhookEventType } from "@/constants/status";
import { recordEvent, transitionPayment, performCapture } from "@/core/payment/payment-service";
import { getAdapter } from "@/core/routing/routing-service";
import { TRANSIENT_MOCK_BANK_STATUSES } from "@/providers/mock-bank/mock-bank-adapter";
import { getMerchantSettings } from "@/core/merchant/merchant-service";
import { dispatchWebhookEvent } from "@/core/webhook/webhook-event-service";
import { computeNextRetryAt, isRetryExhausted } from "./retry-rules";
import { logger } from "@/lib/logger";
import type { Payment } from "@/generated/prisma";

const RETRYABLE_STATUSES: PaymentStatus[] = [PaymentStatus.TIMEOUT, PaymentStatus.RETRY];

// Bounded per poll so one slow cron tick can't run unbounded work — same
// spirit as webhook-delivery-service.ts capping attempts per event.
const BATCH_SIZE = 100;

export type PaymentRetryPollResult = {
  scanned: number;
  authorized: number;
  failed: number;
  rescheduled: number;
};

/**
 * Picks up every Payment whose `nextRetryAt` has elapsed and asks the
 * provider what happened.
 */
export async function pollPaymentRetries(now: Date = new Date()): Promise<PaymentRetryPollResult> {
  const due = await prisma.payment.findMany({
    where: {
      status: { in: RETRYABLE_STATUSES },
      nextRetryAt: { lte: now },
    },
    take: BATCH_SIZE,
    orderBy: { nextRetryAt: "asc" },
  });

  const result: PaymentRetryPollResult = {
    scanned: due.length,
    authorized: 0,
    failed: 0,
    rescheduled: 0,
  };

  for (const payment of due) {
    try {
      await processDuePayment(payment, result);
    } catch (err) {
      // One payment's poll failing must never abort the rest of the batch.
      logger.error("Payment retry poll failed for one payment", {
        paymentId: payment.id,
        error: (err as Error).message,
      });
    }
  }

  return result;
}

async function processDuePayment(payment: Payment, result: PaymentRetryPollResult): Promise<void> {
  const from = payment.status as PaymentStatus;
  // Phase 7 — check status against whichever provider this payment was
  // actually last routed to (`Payment.provider`, set by the authorization
  // pipeline's Dynamic Routing Engine / failover chain), not a fresh
  // routing decision. Prior to Phase 7 only mock-bank was ever registered,
  // so this was a no-op difference; it matters as soon as a second
  // provider exists.
  const providerName = payment.provider ?? "mock-bank";
  const adapter = getAdapter(providerName);

  const priorAttempts = await prisma.paymentAttempt.count({ where: { paymentId: payment.id } });
  const attemptNumber = priorAttempts + 1;

  // Ask what actually happened rather than re-submitting a fresh
  // authorization (see module doc comment). The Mock Bank's checkStatus
  // doesn't need a real providerRef to answer, since authorize() never
  // returned one for a timeout/network-error outcome in the first place.
  const checkResult = await adapter.checkStatus(payment.id);

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      provider: providerName,
      status: checkResult.status,
      attemptNumber,
      providerRef: checkResult.providerRef,
      errorCode: checkResult.errorCode,
    },
  });

  if (checkResult.success) {
    const moved = await prisma.$transaction(async (tx) => {
      const ok = await transitionPayment(tx, payment.id, from, PaymentStatus.AUTHORIZED, {
        nextRetryAt: null,
      });
      if (ok) {
        await recordEvent(tx, payment.id, PaymentEventType.AUTHORIZATION_SUCCESS, {
          provider: providerName,
          providerRef: checkResult.providerRef,
          viaRetryPoll: true,
          retryCount: payment.retryCount,
        });
      }
      return ok;
    });

    // Lost the race (e.g. a concurrent poll run, or the merchant's own
    // capture call already moved it) — nothing left to do here.
    if (!moved) return;

    result.authorized += 1;

    const settings = await getMerchantSettings(payment.merchantId);
    if (settings?.autoCapture ?? true) {
      await performCapture(payment.id, providerName, checkResult.providerRef);
    }
    return;
  }

  const stillTransient = TRANSIENT_MOCK_BANK_STATUSES.has(checkResult.status);
  const nextRetryCount = payment.retryCount + 1;

  if (!stillTransient || isRetryExhausted(nextRetryCount)) {
    const moved = await prisma.$transaction(async (tx) => {
      const ok = await transitionPayment(tx, payment.id, from, PaymentStatus.FAILED, {
        retryCount: nextRetryCount,
        nextRetryAt: null,
      });
      if (ok) {
        await recordEvent(tx, payment.id, PaymentEventType.RETRY_EXHAUSTED, {
          provider: providerName,
          errorCode: checkResult.errorCode,
          retryCount: nextRetryCount,
        });
      }
      return ok;
    });

    if (!moved) return;
    result.failed += 1;

    // FR15 — now genuinely terminal; the Order stays open (Phase 0 §7) so
    // the merchant can still create a new Payment against it (FR7).
    await dispatchWebhookEvent(payment.merchantId, WebhookEventType.PAYMENT_FAILED, {
      payment_id: payment.id,
      order_id: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      error_code: checkResult.errorCode ?? null,
    });
    return;
  }

  // Still transient, still within budget — reschedule rather than give up.
  const moved = await prisma.$transaction(async (tx) => {
    const ok = await transitionPayment(tx, payment.id, from, PaymentStatus.RETRY, {
      retryCount: nextRetryCount,
      nextRetryAt: computeNextRetryAt(nextRetryCount),
    });
    if (ok) {
      await recordEvent(tx, payment.id, PaymentEventType.RETRY_ATTEMPTED, {
        provider: providerName,
        errorCode: checkResult.errorCode,
        retryCount: nextRetryCount,
      });
    }
    return ok;
  });

  if (moved) result.rescheduled += 1;
}

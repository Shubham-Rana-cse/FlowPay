/**
 * Refund Service (Phase 0 §7, FR13).
 *
 * A refund is only valid against a Payment that's `CAPTURED` or already
 * `PARTIALLY_REFUNDED` (there's nothing to give back otherwise). Full and
 * partial refunds are the same code path — omit `amount` for "refund
 * whatever's left", or pass an explicit amount for a partial one; either
 * way the resulting Payment status (`PARTIALLY_REFUNDED` vs `REFUNDED`) is
 * derived from whether anything remains afterward, never chosen by the
 * caller.
 *
 * Money changes hands here, so every successful refund writes both halves
 * of FR14: a `PaymentEvent` (via the shared `recordEvent`) and a
 * `LedgerEntry` debit (via ledger-service.ts) — inside the same transaction
 * as the guarded status transition, in that order, so the ledger write is
 * race-free (see ledger-service.ts's `appendLedgerEntry` doc comment).
 */
import { prisma } from "@/lib/db";
import { PaymentStatus, PaymentEventType, RefundStatus } from "@/constants/status";
import {
  PaymentNotFoundError,
  getPaymentForMerchant,
  transitionPayment,
  recordEvent,
} from "@/core/payment/payment-service";
import { selectProvider } from "@/core/routing/routing-service";
import { appendLedgerEntry, getHeldAmount } from "@/core/ledger/ledger-service";
import { Money } from "@/shared/money";
import { resolveRefundAmount, nextStatusAfterRefund, RefundAmountExceedsRemainingError } from "./refund-rules";
import { dispatchWebhookEvent } from "@/core/webhook/webhook-event-service";
import { WebhookEventType } from "@/constants/status";
import type { Refund } from "@/generated/prisma";

export { PaymentNotFoundError, RefundAmountExceedsRemainingError };

export class PaymentNotRefundableError extends Error {
  constructor(currentStatus: string) {
    super(`Payment must be CAPTURED or PARTIALLY_REFUNDED to refund (current status: ${currentStatus})`);
    this.name = "PaymentNotRefundableError";
  }
}

export class RefundNotFoundError extends Error {
  constructor() {
    super("Refund not found");
    this.name = "RefundNotFoundError";
  }
}

function serializeRefund(refund: Refund) {
  return {
    id: refund.id,
    payment_id: refund.paymentId,
    amount: refund.amount,
    status: refund.status,
    reason: refund.reason,
    created_at: refund.createdAt,
  };
}

const REFUNDABLE_STATUSES: readonly string[] = [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED];

/**
 * A refund is a provider call in its own right (real gateways return a
 * refund reference, can decline it, etc.), so it gets its own
 * `PaymentAttempt` row, exactly like authorize/capture — see
 * payment-service.ts's `performCapture` for the same pattern.
 */
async function findProviderRefForRefund(paymentId: string): Promise<string | undefined> {
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId, status: { in: ["authorized", "captured"] } },
    orderBy: { createdAt: "desc" },
  });
  return attempt?.providerRef ?? undefined;
}

export async function createRefund(
  merchantId: string,
  input: { paymentId: string; amount?: number; reason?: string }
) {
  const payment = await prisma.payment.findFirst({ where: { id: input.paymentId, merchantId } });
  if (!payment) throw new PaymentNotFoundError();
  if (!REFUNDABLE_STATUSES.includes(payment.status)) {
    throw new PaymentNotRefundableError(payment.status);
  }

  const heldAmount = await getHeldAmount(payment.id); // remaining refundable amount (FR14 ledger, not re-derived from Refund rows)
  const remaining = Money.fromMinorUnits(heldAmount, payment.currency);
  const refundMoney = resolveRefundAmount(heldAmount, input.amount, payment.currency);

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount: refundMoney.getMinorUnits(),
      status: RefundStatus.PENDING,
      reason: input.reason,
    },
  });

  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      eventType: PaymentEventType.REFUND_REQUESTED,
      metadata: { refundId: refund.id, amount: refundMoney.getMinorUnits() },
    },
  });

  const { providerName, adapter } = selectProvider({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
  });
  const providerRef = await findProviderRefForRefund(payment.id);

  const result = await adapter.refund(
    { id: payment.id, amount: payment.amount, currency: payment.currency },
    refundMoney.getMinorUnits(),
    providerRef ?? ""
  );

  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      provider: providerName,
      status: result.status,
      attemptNumber: 1, // scoped to the refund call, same convention as capture's PaymentAttempt rows
      providerRef: result.providerRef ?? providerRef,
      errorCode: result.errorCode,
    },
  });

  if (!result.success) {
    await prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refund.id }, data: { status: RefundStatus.FAILED } });
      await recordEvent(tx, payment.id, PaymentEventType.FAILED, {
        stage: "refund",
        refundId: refund.id,
        provider: providerName,
        errorCode: result.errorCode,
      });
    });
    return { refund: serializeRefund({ ...refund, status: RefundStatus.FAILED }), payment: null };
  }

  const remainingAfter = remaining.subtract(refundMoney);
  const nextPaymentStatus = nextStatusAfterRefund(remainingAfter.getMinorUnits());

  await prisma.$transaction(async (tx) => {
    // Guarded transition first — it takes the row lock the ledger append
    // below relies on to stay race-free against a concurrent refund/settlement.
    await transitionPayment(tx, payment.id, payment.status as PaymentStatus, nextPaymentStatus);
    await tx.refund.update({ where: { id: refund.id }, data: { status: RefundStatus.COMPLETED } });
    await appendLedgerEntry(tx, payment.id, "debit", refundMoney.getMinorUnits());
    await recordEvent(tx, payment.id, PaymentEventType.REFUND_COMPLETED, {
      refundId: refund.id,
      amount: refundMoney.getMinorUnits(),
      provider: providerName,
      providerRef: result.providerRef ?? providerRef,
    });
  });

  // FR15 — dispatched after the transaction commits, same reasoning as
  // payment-service.ts's performCapture: a webhook is a third-party network
  // call and must never hold the DB transaction open.
  await dispatchWebhookEvent(merchantId, WebhookEventType.REFUND_COMPLETED, {
    refund_id: refund.id,
    payment_id: payment.id,
    order_id: payment.orderId,
    amount: refundMoney.getMinorUnits(),
    currency: payment.currency,
    resulting_payment_status: nextPaymentStatus,
  });

  return {
    refund: serializeRefund({ ...refund, status: RefundStatus.COMPLETED }),
    payment: await getPaymentForMerchant(merchantId, payment.id),
  };
}

export async function getRefundForMerchant(merchantId: string, refundId: string) {
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, payment: { merchantId } },
  });
  if (!refund) throw new RefundNotFoundError();
  return serializeRefund(refund);
}

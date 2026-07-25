/**
 * Settlement Service (Phase 4 addition — see the `Settlement` model's
 * comment in prisma/schema.prisma for why this wasn't in the original
 * Phase 0 §4 ERD).
 *
 * Simulates a payment processor's payout cycle: eligible payments
 * (`CAPTURED` or `PARTIALLY_REFUNDED`, not already in a settlement, in one
 * currency) are grouped into a `Settlement` batch and their remaining held
 * balance — read straight from the ledger, never re-derived from `Refund`
 * rows — is paid out immediately. There's no real bank transfer and no
 * schedule here in Phase 4; Phase 6 adds `runScheduledSettlements`, which
 * runs `createSettlement` for every merchant/currency pair that currently
 * has anything eligible, meant to be invoked by an external scheduler
 * (cron) hitting `POST /api/internal/cron/settlement` — see that route and
 * `vercel.json`. `createSettlement`/`POST /api/v1/settlements` remains
 * available for a merchant who wants to trigger one on demand between
 * cron ticks.
 */
import { prisma } from "@/lib/db";
import { PaymentStatus, PaymentEventType, SettlementStatus } from "@/constants/status";
import { recordEvent } from "@/core/payment/payment-service";
import { appendLedgerEntry } from "@/core/ledger/ledger-service";
import { dispatchWebhookEvent } from "@/core/webhook/webhook-event-service";
import { WebhookEventType } from "@/constants/status";
import type { Settlement } from "@/generated/prisma";

export class SettlementNotFoundError extends Error {
  constructor() {
    super("Settlement not found");
    this.name = "SettlementNotFoundError";
  }
}

const SETTLEABLE_STATUSES = [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED];

function serializeSettlement(settlement: Settlement) {
  return {
    id: settlement.id,
    amount: settlement.amount,
    currency: settlement.currency,
    status: settlement.status,
    period_start: settlement.periodStart,
    period_end: settlement.periodEnd,
    settled_at: settlement.settledAt,
    created_at: settlement.createdAt,
  };
}

/**
 * Runs one settlement batch for a merchant/currency pair. Returns
 * `{ settled: false }` rather than throwing when there's nothing eligible —
 * "nothing to settle right now" isn't an error, it's the normal steady state
 * between payout cycles.
 */
export async function createSettlement(merchantId: string, currency: string) {
  const upperCurrency = currency.toUpperCase();

  const candidates = await prisma.payment.findMany({
    where: {
      merchantId,
      currency: upperCurrency,
      settlementId: null,
      status: { in: SETTLEABLE_STATUSES },
    },
    include: { ledgerEntries: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const settleable = candidates
    .map((payment) => ({
      payment,
      heldAmount: payment.ledgerEntries[0]?.balanceAfter ?? 0,
    }))
    // A PARTIALLY_REFUNDED payment can still have a positive held balance;
    // one that's been fully refunded down to 0 has nothing left to pay out
    // (and would normally already be REFUNDED, not in this status list, but
    // this guards the boundary case defensively).
    .filter(({ heldAmount }) => heldAmount > 0);

  if (settleable.length === 0) {
    return { settled: false as const, settlement: null };
  }

  const totalAmount = settleable.reduce((sum, { heldAmount }) => sum + heldAmount, 0);
  const periodStart = settleable.reduce(
    (earliest, { payment }) => (payment.createdAt < earliest ? payment.createdAt : earliest),
    settleable[0].payment.createdAt
  );
  const periodEnd = new Date();

  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.settlement.create({
      data: {
        merchantId,
        amount: totalAmount,
        currency: upperCurrency,
        status: SettlementStatus.COMPLETED,
        periodStart,
        periodEnd,
      },
    });

    for (const { payment, heldAmount } of settleable) {
      // Claiming the payment into this batch first (a guarded update, same
      // spirit as transitionPayment's compare-and-swap) is what keeps a
      // concurrent settlement run from double-paying the same payment; the
      // ledger append below relies on that lock the same way refund-service
      // relies on transitionPayment's.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, settlementId: null },
        data: { settlementId: created.id },
      });
      if (claimed.count !== 1) continue; // lost the race to another concurrent settlement run

      await appendLedgerEntry(tx, payment.id, "debit", heldAmount);
      await recordEvent(tx, payment.id, PaymentEventType.SETTLED, {
        settlementId: created.id,
        amount: heldAmount,
      });
    }

    return created;
  });

  // FR15 — dispatched after the transaction commits, same reasoning as
  // payment-service.ts / refund-service.ts.
  await dispatchWebhookEvent(merchantId, WebhookEventType.SETTLEMENT_COMPLETED, {
    settlement_id: settlement.id,
    amount: settlement.amount,
    currency: settlement.currency,
    payment_count: settleable.length,
  });

  return { settled: true as const, settlement: serializeSettlement(settlement) };
}

export type ScheduledSettlementResult = {
  pairsScanned: number;
  settlementsCreated: number;
};

/**
 * Phase 6 — the cron-driven counterpart to the merchant-triggered
 * `POST /api/v1/settlements`. Finds every distinct (merchant, currency)
 * pair with at least one eligible payment right now and runs
 * `createSettlement` for each — the exact same batching/locking logic as
 * the manual path, just discovered automatically instead of requiring the
 * merchant to know to call it.
 */
export async function runScheduledSettlements(): Promise<ScheduledSettlementResult> {
  const eligible = await prisma.payment.findMany({
    where: { settlementId: null, status: { in: SETTLEABLE_STATUSES } },
    select: { merchantId: true, currency: true },
    distinct: ["merchantId", "currency"],
  });

  let settlementsCreated = 0;
  for (const { merchantId, currency } of eligible) {
    const { settled } = await createSettlement(merchantId, currency);
    if (settled) settlementsCreated += 1;
  }

  return { pairsScanned: eligible.length, settlementsCreated };
}

export async function getSettlementForMerchant(merchantId: string, settlementId: string) {
  const settlement = await prisma.settlement.findFirst({ where: { id: settlementId, merchantId } });
  if (!settlement) throw new SettlementNotFoundError();

  const payments = await prisma.payment.findMany({
    where: { settlementId },
    select: { id: true, amount: true, currency: true, status: true, orderId: true },
  });

  return {
    ...serializeSettlement(settlement),
    payments: payments.map((p) => ({
      id: p.id,
      order_id: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
    })),
  };
}

export async function listSettlementsForMerchant(merchantId: string) {
  const settlements = await prisma.settlement.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });
  return settlements.map(serializeSettlement);
}

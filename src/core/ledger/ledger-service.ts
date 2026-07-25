/**
 * Ledger Service (Phase 0 §4, §11 Decision #5; FR14 money-movement half).
 *
 * Append-only, per-payment money-movement ledger — deliberately separate
 * from `PaymentEvent` (the process timeline). Every entry is a `credit`
 * (money coming in — a capture) or a `debit` (money going out — a refund
 * or a settlement payout), and `balanceAfter` is the running amount still
 * *held* by the orchestrator for that payment, not yet paid out to the
 * merchant:
 *
 *   capture   -> credit +amount   (we now hold the customer's payment)
 *   refund    -> debit  -amount   (part of it goes back to the customer)
 *   settle    -> debit  -amount   (the remainder goes out to the merchant)
 *
 * A fully-settled, never-refunded payment's balance ends at exactly 0.
 * Never derive this balance from `PaymentEvent` — recompute it only from
 * this table, and never update/delete a row once written.
 */
import { prisma } from "@/lib/db";
import { PaymentNotFoundError } from "@/core/payment/payment-service";
import { computeBalanceAfter } from "./ledger-rules";
import type { LedgerEntryType } from "./ledger-rules";
import type { Prisma, LedgerEntry } from "@/generated/prisma";

export type { LedgerEntryType };

/**
 * Appends one entry and returns it. Must be called from inside a
 * transaction whose *other* writes have already taken a lock on the
 * Payment row (e.g. via `transitionPayment`'s guarded `updateMany`) —
 * that's what keeps two concurrent writers for the same payment (a refund
 * racing a settlement, say) from both reading the same "last balance" and
 * computing two conflicting entries. This function itself does not lock
 * anything; ordering it after the guarded Payment update is what makes it
 * safe (see refund-service.ts / settlement-service.ts for that ordering).
 */
export async function appendLedgerEntry(
  tx: Prisma.TransactionClient,
  paymentId: string,
  type: LedgerEntryType,
  amount: number
): Promise<LedgerEntry> {
  const last = await tx.ledgerEntry.findFirst({
    where: { paymentId },
    orderBy: { createdAt: "desc" },
  });
  const balanceAfter = computeBalanceAfter(last?.balanceAfter ?? 0, type, amount);

  return tx.ledgerEntry.create({
    data: { paymentId, type, amount, balanceAfter },
  });
}

/** The amount currently held for a payment (0 if nothing captured yet, or fully refunded/settled). */
export async function getHeldAmount(paymentId: string): Promise<number> {
  const last = await prisma.ledgerEntry.findFirst({
    where: { paymentId },
    orderBy: { createdAt: "desc" },
  });
  return last?.balanceAfter ?? 0;
}

/**
 * The full ledger — "transaction history" (Phase 4 roadmap deliverable) —
 * for one payment, merchant-scoped like every other /v1 read.
 */
export async function getLedgerForPayment(merchantId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, merchantId } });
  if (!payment) throw new PaymentNotFoundError();

  const entries = await prisma.ledgerEntry.findMany({
    where: { paymentId },
    orderBy: { createdAt: "asc" },
  });

  return {
    payment_id: paymentId,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      balance_after: e.balanceAfter,
      created_at: e.createdAt,
    })),
    current_balance: entries.at(-1)?.balanceAfter ?? 0,
  };
}

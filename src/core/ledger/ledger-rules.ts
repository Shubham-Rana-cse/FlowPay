/**
 * Pure ledger arithmetic — no DB imports, mirroring state-machine.ts and
 * money.ts, so this is trivially unit-testable and importing it never
 * triggers Prisma client instantiation.
 */
export type LedgerEntryType = "credit" | "debit";

export function computeBalanceAfter(
  previousBalance: number,
  type: LedgerEntryType,
  amount: number
): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Ledger entry amount must be a positive integer, got ${amount}`);
  }
  return type === "credit" ? previousBalance + amount : previousBalance - amount;
}

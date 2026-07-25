/**
 * Pure refund rules (FR13) — no DB imports, mirroring state-machine.ts and
 * money.ts, so these are trivially unit-testable and so importing them (for
 * tests) never triggers Prisma client instantiation.
 */
import { Money } from "@/shared/money";
import { PaymentStatus } from "@/constants/status";

export class RefundAmountExceedsRemainingError extends Error {
  constructor(remaining: string, requested: string) {
    super(`Refund amount ${requested} exceeds the remaining refundable amount ${remaining}`);
    this.name = "RefundAmountExceedsRemainingError";
  }
}

/**
 * Given what's still held for a payment and what was requested, returns the
 * Money to actually refund or throws. Omitting `requestedAmountMinorUnits`
 * means "refund whatever's left" (a full refund of the remaining balance).
 */
export function resolveRefundAmount(
  heldAmountMinorUnits: number,
  requestedAmountMinorUnits: number | undefined,
  currency: string
): Money {
  const remaining = Money.fromMinorUnits(heldAmountMinorUnits, currency);
  const refundMoney =
    requestedAmountMinorUnits != null
      ? Money.fromMinorUnits(requestedAmountMinorUnits, currency)
      : remaining;

  const zero = Money.fromMinorUnits(0, currency);
  if (refundMoney.isNegative() || refundMoney.equals(zero)) {
    throw new RefundAmountExceedsRemainingError(remaining.toString(), refundMoney.toString());
  }
  if (remaining.subtract(refundMoney).isNegative()) {
    throw new RefundAmountExceedsRemainingError(remaining.toString(), refundMoney.toString());
  }

  return refundMoney;
}

/** The Payment status a successful refund leaves behind, given what's left held afterward. */
export function nextStatusAfterRefund(remainingAfterMinorUnits: number): PaymentStatus {
  return remainingAfterMinorUnits === 0 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
}

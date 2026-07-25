/**
 * Payment State Machine (Phase 0 §7).
 *
 * Pure transition rules only — no DB access here, mirroring how `Money` is a
 * pure value object. `payment-service.ts` is responsible for wrapping a
 * transition in a DB transaction + writing the corresponding `PaymentEvent`.
 *
 * Phase 2 only ever drives CREATED -> PENDING -> FAILED (a Payment is created,
 * optionally marked FAILED on validation problems). PENDING -> AUTHORIZED and
 * beyond requires an actual provider call, which starts in Phase 3 once the
 * Mock Bank adapter exists. The full graph is defined now so later phases
 * extend behavior, not the rules themselves.
 */
import { PaymentStatus } from "@/constants/status";

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid payment state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [PaymentStatus.PENDING, PaymentStatus.FAILED],
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
    PaymentStatus.RETRY,
    PaymentStatus.TIMEOUT,
  ],
  // Phase 6 — retry-service.ts's poller resolves a stuck payment directly:
  // RETRY/TIMEOUT -> AUTHORIZED once the provider confirms it actually went
  // through (via ProviderAdapter.checkStatus, not a fresh authorize), or
  // -> FAILED once cross-request retries are exhausted (Open Design
  // Decision #1). RETRY also self-loops: a poll that's still transient just
  // reschedules `nextRetryAt` without changing status.
  [PaymentStatus.RETRY]: [
    PaymentStatus.RETRY,
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.TIMEOUT]: [PaymentStatus.RETRY, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED],
  [PaymentStatus.AUTHORIZED]: [PaymentStatus.CAPTURED, PaymentStatus.FAILED],
  [PaymentStatus.CAPTURED]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  // Self-loop added in Phase 4: a payment can be partially refunded more
  // than once (e.g. $10 of $100, then $20 more of the remaining $90) before
  // finally reaching REFUNDED — it doesn't leave PARTIALLY_REFUNDED between
  // those steps. The original Phase 0 §7 diagram only showed the first
  // partial refund and the eventual full one; every intermediate one is
  // this same edge.
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
};

/** Terminal states a Payment can never leave once reached. */
export const TERMINAL_STATES: readonly PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.REFUNDED,
];

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

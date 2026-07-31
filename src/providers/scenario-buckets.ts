/**
 * Phase 7 — shared "no test key configured" fallback simulation.
 *
 * Stripe and Razorpay adapters both call out to a real Test Mode API when
 * their env-var credentials are present (see each adapter's own doc
 * comment for exactly what's real vs. simulated). When no credentials are
 * configured, they fall back to the same deterministic, amount-bucket
 * convention Phase 3's Mock Bank established (FR16) — so the whole system
 * stays fully testable out of the box, with zero external accounts, exactly
 * like every prior phase.
 *
 * Each provider gets its *own* bucket table (rather than reusing Mock
 * Bank's) so that, once PaymentAttempt history accumulates across
 * providers, HighestSuccessRateStrategy has genuinely different track
 * records to choose between in a demo — the whole point of "smart provider
 * selection" is moot if every provider behaves identically.
 */

export type ProviderScenario =
  | "success"
  | "insufficient_funds"
  | "failure"
  | "timeout"
  | "network_error";

function bucketOf(amount: number): number {
  return ((amount % 100) + 100) % 100; // guard against negative amounts
}

/** Stripe fallback: higher success rate, no insufficient_funds bucket
 * (Stripe's test tokens model funds/decline distinctly — see stripe-adapter.ts). */
export function stripeScenarioForAmount(amount: number): ProviderScenario {
  const bucket = bucketOf(amount);
  if (bucket >= 94 && bucket <= 96) return "failure";
  if (bucket >= 97 && bucket <= 98) return "timeout";
  if (bucket === 99) return "network_error";
  return "success"; // 00-93
}

/** Razorpay fallback: deliberately the weakest performer of the three, so
 * success-rate-based routing has an obvious "avoid this one" signal in demos. */
export function razorpayScenarioForAmount(amount: number): ProviderScenario {
  const bucket = bucketOf(amount);
  if (bucket >= 85 && bucket <= 90) return "failure";
  if (bucket >= 91 && bucket <= 95) return "timeout";
  if (bucket >= 96) return "network_error";
  return "success"; // 00-84
}

export const TRANSIENT_PROVIDER_STATUSES = new Set<string>(["timeout", "network_error"]);

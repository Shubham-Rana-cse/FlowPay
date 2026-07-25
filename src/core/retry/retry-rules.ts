/**
 * Retry Rules (Phase 6, Open Design Decision #1; FR12).
 *
 * Pure cross-request retry policy — no DB access here, same pattern as
 * state-machine.ts/ledger-rules.ts/money.ts. `retry-service.ts` wraps this
 * with the actual polling query, provider call, and DB writes.
 *
 * This is a *separate* counter from payment-service.ts's in-request retry
 * loop (MAX_AUTHORIZE_ATTEMPTS = 3, 50/100/200ms backoff, same HTTP call).
 * That loop already ran and gave up before a Payment ever lands in
 * TIMEOUT/RETRY; `retryCount` here only starts counting from that point —
 * cross-request attempts, spaced minutes apart, giving a flaky
 * provider/network real time to recover instead of hammering it inline.
 */

/** Cross-request attempts before a stuck Payment is given up on and marked FAILED. */
export const MAX_CROSS_REQUEST_RETRIES = 5;

// 1m, 5m, 15m, 30m, 60m — deliberately much wider apart than the in-request
// backoff (50ms/100ms/200ms): these represent waiting out a real outage
// window, not a same-request blip.
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];

/**
 * When the next poll attempt is due, given how many cross-request retries
 * have already been made. `retryCount = 0` is the first time a Payment
 * lands in TIMEOUT/RETRY (no cross-request attempt made yet).
 */
export function computeNextRetryAt(retryCount: number, now: Date = new Date()): Date {
  const idx = Math.min(Math.max(retryCount, 0), BACKOFF_MS.length - 1);
  return new Date(now.getTime() + BACKOFF_MS[idx]);
}

/** True once a Payment has used up every cross-request retry it's allowed. */
export function isRetryExhausted(retryCount: number): boolean {
  return retryCount >= MAX_CROSS_REQUEST_RETRIES;
}

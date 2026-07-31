/**
 * PHASE 7 — Automatic Provider Failover policy (pure, unit-tested, no DB —
 * same pure-logic/DB-logic separation as retry-rules.ts). Decides which
 * provider-level outcomes are worth retrying against a *different* provider
 * within the same request, versus outcomes that are a genuine decline and
 * would fail identically anywhere else.
 *
 * `insufficient_funds` is deliberately excluded: it describes the
 * customer's funds, not a problem with the provider, so trying a different
 * provider wouldn't change the outcome (this mirrors how a real payment
 * orchestrator would classify decline reasons before deciding to reroute —
 * see Phase 0's linked "what is payment orchestration" explainer on smart
 * retries). `timeout` / `network_error` / a generic provider `failed` are
 * all shaped like "this provider had a problem," which is exactly the case
 * failover exists for.
 */

export const FAILOVER_ELIGIBLE_STATUSES = new Set<string>(["timeout", "network_error", "failed"]);

export function isFailoverEligible(status: string): boolean {
  return FAILOVER_ELIGIBLE_STATUSES.has(status);
}

/**
 * PHASE 7 — pure rule-matching logic for the Dynamic Routing Engine
 * (RULE_BASED strategy + rule-override-before-strategy in every strategy,
 * see dynamic-routing-engine.ts). Kept import-free/DB-free, same
 * pure-logic/DB-logic separation established by state-machine.ts,
 * ledger-rules.ts, refund-rules.ts, and retry-rules.ts — so this is
 * unit-testable with plain objects, no Prisma involved.
 */

export type RuleCondition = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  currency: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  provider: string;
};

export type RuleMatchInput = {
  amount: number;
  currency: string;
};

/**
 * Evaluates rules in ascending `priority` order (lower = evaluated first)
 * and returns the first enabled rule whose conditions all match — an unset
 * condition field means "don't filter on this dimension". Returns `null`
 * if nothing matches, letting the caller fall back to the merchant's
 * configured strategy.
 */
export function matchRoutingRule(payment: RuleMatchInput, rules: RuleCondition[]): RuleCondition | null {
  const candidates = rules
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id.localeCompare(b.id)));

  for (const rule of candidates) {
    if (rule.currency && rule.currency !== payment.currency) continue;
    if (rule.minAmount !== null && payment.amount < rule.minAmount) continue;
    if (rule.maxAmount !== null && payment.amount > rule.maxAmount) continue;
    return rule;
  }

  return null;
}

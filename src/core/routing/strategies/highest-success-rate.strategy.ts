// PHASE 7 — HighestSuccessRateStrategy: "smart provider selection". Picks
// the enabled provider with the best recent authorize success rate. Stats
// are computed from PaymentAttempt history by dynamic-routing-engine.ts
// (same aggregation style as analytics-service.ts, FR18) and passed in here
// as plain data, keeping this class itself pure/synchronous like every
// other RoutingStrategy.
import type { RoutingStrategy } from "../routing-strategy.interface";
import type { ProviderRegistry } from "../provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export type ProviderSuccessStat = {
  provider: string;
  priority: number;
  attempts: number;
  successes: number;
};

// Below this many observed attempts, a provider's rate is too noisy to
// trust (e.g. 1/1 = 100% shouldn't beat a provider with 500/520 = 96%) —
// fall back to `priority` order instead for anything under-sampled.
const MIN_SAMPLE_SIZE = 5;

export function successRate(stat: ProviderSuccessStat): number {
  if (stat.attempts === 0) return 0;
  return stat.successes / stat.attempts;
}

export class HighestSuccessRateStrategy implements RoutingStrategy {
  constructor(private readonly stats: ProviderSuccessStat[]) {}

  selectProvider(_payment: ProviderPaymentInput, _registry: ProviderRegistry): string {
    if (this.stats.length === 0) return "mock-bank";

    const sorted = [...this.stats].sort((a, b) => {
      const aTrusted = a.attempts >= MIN_SAMPLE_SIZE;
      const bTrusted = b.attempts >= MIN_SAMPLE_SIZE;

      // Under-sampled providers rank by priority among themselves and
      // always after any trusted provider, so a brand-new integration
      // doesn't jump the queue on a lucky first attempt.
      if (aTrusted !== bTrusted) return aTrusted ? -1 : 1;
      if (!aTrusted && !bTrusted) return a.priority - b.priority;

      const rateDiff = successRate(b) - successRate(a);
      if (Math.abs(rateDiff) > 1e-9) return rateDiff;
      return a.priority - b.priority;
    });

    return sorted[0].provider;
  }
}

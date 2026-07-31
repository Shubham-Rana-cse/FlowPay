// PHASE 7 — CheapestProviderStrategy: picks the enabled provider with the
// lowest configured cost (basis points, ProviderConfig.costBps). Ties break
// on `priority` (lower wins), then alphabetically for full determinism —
// this class is still pure per the RoutingStrategy interface; the actual
// cost figures are fetched by dynamic-routing-engine.ts and passed in.
import type { RoutingStrategy } from "../routing-strategy.interface";
import type { ProviderRegistry } from "../provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export type ProviderCost = { provider: string; costBps: number; priority: number };

export class CheapestProviderStrategy implements RoutingStrategy {
  constructor(private readonly costs: ProviderCost[]) {}

  selectProvider(_payment: ProviderPaymentInput, _registry: ProviderRegistry): string {
    if (this.costs.length === 0) return "mock-bank";

    const sorted = [...this.costs].sort((a, b) => {
      if (a.costBps !== b.costBps) return a.costBps - b.costBps;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.provider.localeCompare(b.provider);
    });

    return sorted[0].provider;
  }
}

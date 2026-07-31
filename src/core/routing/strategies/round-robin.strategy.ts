// PHASE 7 — RoundRobinStrategy: cycles through a merchant's enabled
// providers in priority order. Pure/stateless per the RoutingStrategy
// interface (Phase 0 §6) — the "which attempt number is this" state lives
// outside the strategy (dynamic-routing-engine.ts passes in a counter),
// so this class itself needs no persistence of its own.
import type { RoutingStrategy } from "../routing-strategy.interface";
import type { ProviderRegistry } from "../provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export class RoundRobinStrategy implements RoutingStrategy {
  // `candidates` is the enabled-provider list (already sorted by priority)
  // and `counter` is a monotonically increasing value (e.g. total prior
  // payment count for the merchant) used to pick the next one in rotation.
  constructor(
    private readonly candidates: string[],
    private readonly counter: number
  ) {}

  selectProvider(_payment: ProviderPaymentInput, _registry: ProviderRegistry): string {
    if (this.candidates.length === 0) return "mock-bank";
    const index = ((this.counter % this.candidates.length) + this.candidates.length) % this.candidates.length;
    return this.candidates[index];
  }
}

// PHASE 3 — FixedProviderStrategy: always routes to "mock-bank".
// Later: CheapestProviderStrategy, HighestSuccessRateStrategy, MerchantPreferredStrategy.
import type { RoutingStrategy } from "../routing-strategy.interface";
import type { ProviderRegistry } from "../provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export class FixedProviderStrategy implements RoutingStrategy {
  selectProvider(_payment: ProviderPaymentInput, _registry: ProviderRegistry): string {
    return "mock-bank";
  }
}

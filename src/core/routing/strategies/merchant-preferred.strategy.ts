// PHASE 7 — MerchantPreferredStrategy: always routes to a merchant-chosen
// provider (MerchantSettings.preferredProvider), falling back to the first
// enabled provider by priority if none was configured or it's disabled.
import type { RoutingStrategy } from "../routing-strategy.interface";
import type { ProviderRegistry } from "../provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export class MerchantPreferredStrategy implements RoutingStrategy {
  constructor(
    private readonly preferredProvider: string | null | undefined,
    private readonly enabledByPriority: string[]
  ) {}

  selectProvider(_payment: ProviderPaymentInput, _registry: ProviderRegistry): string {
    if (this.preferredProvider && this.enabledByPriority.includes(this.preferredProvider)) {
      return this.preferredProvider;
    }
    return this.enabledByPriority[0] ?? "mock-bank";
  }
}

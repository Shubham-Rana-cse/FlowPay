/**
 * Routing Service (Phase 0 §6, FR9, FR21).
 *
 * Composition root for provider selection: owns the one ProviderRegistry
 * instance, bootstraps every known adapter into it, and picks a
 * RoutingStrategy to delegate the actual "which provider" decision to.
 * payment-service.ts calls `selectProvider()` and never touches the
 * registry or a strategy directly.
 */
import { ProviderRegistry, ProviderNotRegisteredError } from "./provider-registry";
import { FixedProviderStrategy } from "./strategies/fixed-provider.strategy";
import { MockBankAdapter } from "@/providers/mock-bank/mock-bank-adapter";
import type { RoutingStrategy } from "./routing-strategy.interface";
import type { ProviderAdapter, ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export { ProviderNotRegisteredError };

const registry = new ProviderRegistry();
registry.register("mock-bank", new MockBankAdapter());
// Phase 7: registry.register("stripe", new StripeAdapter());
// Phase 7: registry.register("razorpay", new RazorpayAdapter());

// Fixed for now (FR21) — swap this line for a smarter strategy later,
// e.g. CheapestProviderStrategy or a MerchantSettings-driven preference.
// No other part of the codebase needs to change when that happens.
const activeStrategy: RoutingStrategy = new FixedProviderStrategy();

export function selectProvider(payment: ProviderPaymentInput): {
  providerName: string;
  adapter: ProviderAdapter;
} {
  const providerName = activeStrategy.selectProvider(payment, registry);
  const adapter = registry.get(providerName);
  return { providerName, adapter };
}

/** Exposed for tests that want to register a fake adapter without touching the real registry. */
export function _createTestRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

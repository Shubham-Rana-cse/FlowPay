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
import { StripeAdapter } from "@/providers/stripe/stripe-adapter";
import { RazorpayAdapter } from "@/providers/razorpay/razorpay-adapter";
import { buildProviderChain, type ProviderChainLink } from "./dynamic-routing-engine";
import type { RoutingStrategy } from "./routing-strategy.interface";
import type { ProviderAdapter, ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export { ProviderNotRegisteredError };
export type { ProviderChainLink };

const registry = new ProviderRegistry();
registry.register("mock-bank", new MockBankAdapter());
// Phase 7 — Stripe/Razorpay Test Mode adapters. Registering them here is
// purely additive and doesn't change what selectProvider() below returns
// for anyone: FixedProviderStrategy still always picks "mock-bank", so a
// merchant who hasn't configured Phase 7 routing (see
// dynamic-routing-engine.ts) is completely unaffected by these two lines.
registry.register("stripe", new StripeAdapter());
registry.register("razorpay", new RazorpayAdapter());

// Fixed for now (FR21) — this is the ORIGINAL Phase 3 default and stays
// untouched: `selectProvider` below always resolves through this strategy,
// exactly like Phase 3-6. Phase 7's dynamic routing lives entirely in
// `selectProviderChain`, a new function, so every existing caller/test of
// `selectProvider` keeps its Phase 3-6 behavior unchanged.
const activeStrategy: RoutingStrategy = new FixedProviderStrategy();

export function selectProvider(payment: ProviderPaymentInput): {
  providerName: string;
  adapter: ProviderAdapter;
} {
  const providerName = activeStrategy.selectProvider(payment, registry);
  const adapter = registry.get(providerName);
  return { providerName, adapter };
}

/**
 * Phase 7 — the Dynamic Routing Engine's entry point (FR9/FR21). Returns an
 * ordered chain of candidate providers for Automatic Provider Failover: the
 * caller tries `chain[0]` first and, if that outcome looks like a provider
 * outage (see `failover-policy.ts`), moves on to `chain[1]`, etc.
 *
 * Falls back to the exact same single-provider result `selectProvider()`
 * always returned whenever:
 *  - no `merchantId` is supplied (keeps every non-merchant-aware caller,
 *    e.g. existing unit tests, working exactly as before), or
 *  - the merchant hasn't configured any `ProviderConfig` rows yet (Phase
 *    3-6 behavior for every merchant created before Phase 7).
 */
export async function selectProviderChain(payment: ProviderPaymentInput): Promise<ProviderChainLink[]> {
  if (payment.merchantId) {
    const chain = await buildProviderChain(payment, payment.merchantId, registry);
    if (chain && chain.length > 0) return chain;
  }
  const fallback = selectProvider(payment);
  return [fallback];
}

/** Exposed for tests that want to register a fake adapter without touching the real registry. */
export function _createTestRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

/** Phase 7 — exposed so provider-config-service.ts can validate that a
 * merchant's requested provider name actually has a registered adapter. */
export function isProviderRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Phase 7 — looks up the adapter for an *already-known* provider name,
 * without re-running routing. `performCapture` and `retry-service.ts`'s
 * poller both need this: they must keep talking to whichever provider a
 * Payment was actually authorized against (`Payment.provider`), not
 * whatever a fresh routing decision would pick now — which, once more
 * than one provider is registered, is not guaranteed to be the same one.
 */
export function getAdapter(providerName: string): ProviderAdapter {
  return registry.get(providerName);
}

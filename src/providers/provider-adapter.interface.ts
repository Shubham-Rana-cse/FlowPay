// Common interface every payment provider adapter must implement.
// Phase 3 adds providers/mock-bank/mock-bank-adapter.ts implementing this.
// Phase 7 will add providers/stripe/ and providers/razorpay/.
// See Phase 0 §6 — no changes to core payment logic are needed to add a new provider.
//
// Deviation from the Phase 0 §6 sketch, made when Phase 3 actually implemented
// this interface: `payment: Payment` became `payment: ProviderPaymentInput`
// (a small plain-data shape) so the provider layer never depends on Prisma
// types, and `capture`/`refund` now take an explicit `providerRef` — real
// gateways key follow-up calls off the reference they handed back at
// authorization time, not off our internal Payment id. `Money` amounts are
// passed as plain minor-unit integers for the same decoupling reason;
// `payment-service.ts` is still the only place that unwraps a `Money`.

export interface ProviderPaymentInput {
  id: string;
  amount: number; // minor units
  currency: string;
  // Phase 7 — optional so every existing call site/test that builds a
  // ProviderPaymentInput without it keeps compiling and behaving exactly
  // as before. Only the Dynamic Routing Engine (routing-service.ts's
  // selectProviderChain) reads this, to load a merchant's ProviderConfig/
  // RoutingRule rows; the legacy selectProvider()/FixedProviderStrategy
  // path never looks at it.
  merchantId?: string;
}

export interface AttemptResult {
  success: boolean;
  providerRef?: string;
  /** Provider-specific outcome, e.g. "authorized" | "captured" | "insufficient_funds" | "timeout" | "network_error" | "failed". */
  status: string;
  errorCode?: string;
  raw?: unknown;
}

export interface ProviderAdapter {
  authorize(payment: ProviderPaymentInput): Promise<AttemptResult>;
  capture(payment: ProviderPaymentInput, providerRef: string): Promise<AttemptResult>;
  refund(payment: ProviderPaymentInput, amount: number, providerRef: string): Promise<AttemptResult>;
  checkStatus(providerRef: string): Promise<AttemptResult>;
}

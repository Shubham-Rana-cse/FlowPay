// PHASE 3 — the WHICH-adapter-to-use half of Phase 0 §6 (ProviderRegistry is the WHERE half).
// FixedProviderStrategy is the only implementation for now; CheapestProviderStrategy,
// HighestSuccessRateStrategy, and MerchantPreferredStrategy are later-phase additions
// that implement this same interface — routing-service.ts won't need to change.
import type { ProviderRegistry } from "./provider-registry";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";

export interface RoutingStrategy {
  selectProvider(payment: ProviderPaymentInput, registry: ProviderRegistry): string;
}

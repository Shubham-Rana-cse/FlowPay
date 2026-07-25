/**
 * Mock Bank Adapter (Phase 3, FR16, FR20).
 *
 * Simulates a real bank/PSP: success, failure, timeout, insufficient funds,
 * and network errors. Scenario selection is *deterministic*, derived from the
 * payment amount's last two minor-unit digits, so merchants (and Postman/curl
 * tests) can trigger every outcome on demand without any special test-mode
 * flag — the same trick real sandboxes use with "magic" card numbers, applied
 * here to amount instead since this system has no card field yet.
 *
 *   amount % 100 == 0-89  -> success
 *   amount % 100 == 90-93 -> insufficient funds      (hard decline)
 *   amount % 100 == 94-96 -> generic failure          (hard decline)
 *   amount % 100 == 97-98 -> timeout                  (transient)
 *   amount % 100 == 99    -> network error             (transient)
 *
 * "Transient" here means payment-service.ts's inline retry policy (FR12)
 * will retry it; hard declines are returned to the merchant immediately.
 */
import { randomUUID } from "crypto";
import type { AttemptResult, ProviderAdapter, ProviderPaymentInput } from "../provider-adapter.interface";

export type MockBankScenario =
  | "success"
  | "insufficient_funds"
  | "failure"
  | "timeout"
  | "network_error";

/** Pure and exported so the scenario mapping itself can be unit-tested without I/O. */
export function scenarioForAmount(amount: number): MockBankScenario {
  const bucket = ((amount % 100) + 100) % 100; // guard against negative amounts
  if (bucket >= 90 && bucket <= 93) return "insufficient_funds";
  if (bucket >= 94 && bucket <= 96) return "failure";
  if (bucket >= 97 && bucket <= 98) return "timeout";
  if (bucket === 99) return "network_error";
  return "success";
}

/** Statuses payment-service.ts's retry loop treats as worth retrying. */
export const TRANSIENT_MOCK_BANK_STATUSES = new Set<string>(["timeout", "network_error"]);

function simulatedNetworkDelay(): Promise<void> {
  const ms = 20 + Math.random() * 40;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockBankAdapter implements ProviderAdapter {
  async authorize(payment: ProviderPaymentInput): Promise<AttemptResult> {
    await simulatedNetworkDelay();
    const scenario = scenarioForAmount(payment.amount);

    switch (scenario) {
      case "success":
        return { success: true, status: "authorized", providerRef: `mockbank_${randomUUID()}` };
      case "insufficient_funds":
        return { success: false, status: "insufficient_funds", errorCode: "INSUFFICIENT_FUNDS" };
      case "failure":
        return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED" };
      case "timeout":
        return { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" };
      case "network_error":
        return { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }
  }

  async capture(_payment: ProviderPaymentInput, providerRef: string): Promise<AttemptResult> {
    await simulatedNetworkDelay();
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }
    return { success: true, status: "captured", providerRef };
  }

  async refund(_payment: ProviderPaymentInput, _amount: number, providerRef: string): Promise<AttemptResult> {
    await simulatedNetworkDelay();
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }
    // Full Refund Service logic (partial refunds, ledger entries) lands in Phase 4 —
    // the adapter call itself is ready now so that service has nothing left to build here.
    return { success: true, status: "refunded", providerRef };
  }

  async checkStatus(providerRef: string): Promise<AttemptResult> {
    await simulatedNetworkDelay();
    // Reserved for Phase 6's polling retry job: after a timeout, ask the bank
    // what actually happened instead of blindly re-authorizing.
    return { success: true, status: "authorized", providerRef };
  }
}

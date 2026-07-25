import { describe, it, expect } from "vitest";
import { selectProvider } from "./routing-service";
import { FixedProviderStrategy } from "./strategies/fixed-provider.strategy";
import { ProviderRegistry } from "./provider-registry";

describe("routing-service.selectProvider", () => {
  it("routes every payment to the mock-bank adapter (FixedProviderStrategy)", () => {
    const { providerName, adapter } = selectProvider({ id: "pay_1", amount: 50000, currency: "INR" });
    expect(providerName).toBe("mock-bank");
    expect(adapter).toBeDefined();
    expect(typeof adapter.authorize).toBe("function");
  });

  it("is stable across different payments (FR21: fixed for now)", () => {
    const a = selectProvider({ id: "pay_1", amount: 100, currency: "INR" });
    const b = selectProvider({ id: "pay_2", amount: 999999, currency: "USD" });
    expect(a.providerName).toBe(b.providerName);
  });
});

describe("FixedProviderStrategy", () => {
  it("always returns 'mock-bank' regardless of payment or registry contents", () => {
    const strategy = new FixedProviderStrategy();
    const registry = new ProviderRegistry();
    expect(strategy.selectProvider({ id: "x", amount: 1, currency: "INR" }, registry)).toBe("mock-bank");
  });
});

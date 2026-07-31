import { describe, it, expect } from "vitest";
import { RoundRobinStrategy } from "./round-robin.strategy";
import { CheapestProviderStrategy } from "./cheapest-provider.strategy";
import { HighestSuccessRateStrategy, successRate } from "./highest-success-rate.strategy";
import { MerchantPreferredStrategy } from "./merchant-preferred.strategy";
import type { ProviderPaymentInput } from "@/providers/provider-adapter.interface";
import type { ProviderRegistry } from "../provider-registry";

const dummyPayment: ProviderPaymentInput = { id: "pay_1", amount: 1000, currency: "INR" };
const dummyRegistry = undefined as unknown as ProviderRegistry;

describe("RoundRobinStrategy", () => {
  it("falls back to mock-bank with no candidates", () => {
    const s = new RoundRobinStrategy([], 0);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("cycles deterministically through candidates by counter", () => {
    const candidates = ["mock-bank", "stripe", "razorpay"];
    expect(new RoundRobinStrategy(candidates, 0).selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
    expect(new RoundRobinStrategy(candidates, 1).selectProvider(dummyPayment, dummyRegistry)).toBe("stripe");
    expect(new RoundRobinStrategy(candidates, 2).selectProvider(dummyPayment, dummyRegistry)).toBe("razorpay");
    expect(new RoundRobinStrategy(candidates, 3).selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });
});

describe("CheapestProviderStrategy", () => {
  it("falls back to mock-bank with no costs", () => {
    const s = new CheapestProviderStrategy([]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("picks the lowest costBps", () => {
    const s = new CheapestProviderStrategy([
      { provider: "stripe", costBps: 290, priority: 100 },
      { provider: "razorpay", costBps: 200, priority: 100 },
      { provider: "mock-bank", costBps: 0, priority: 100 },
    ]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("breaks a cost tie using priority", () => {
    const s = new CheapestProviderStrategy([
      { provider: "stripe", costBps: 200, priority: 5 },
      { provider: "razorpay", costBps: 200, priority: 1 },
    ]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("razorpay");
  });
});

describe("HighestSuccessRateStrategy", () => {
  it("falls back to mock-bank with no stats", () => {
    const s = new HighestSuccessRateStrategy([]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("prefers a well-sampled higher success rate over a smaller sample", () => {
    const s = new HighestSuccessRateStrategy([
      { provider: "stripe", priority: 100, attempts: 500, successes: 480 }, // 96%
      { provider: "razorpay", priority: 100, attempts: 500, successes: 400 }, // 80%
    ]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("stripe");
  });

  it("ranks trusted (well-sampled) providers ahead of under-sampled ones regardless of rate", () => {
    const s = new HighestSuccessRateStrategy([
      { provider: "new-provider", priority: 1, attempts: 1, successes: 1 }, // 100% but n=1
      { provider: "stripe", priority: 100, attempts: 200, successes: 180 }, // 90%, well-sampled
    ]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("stripe");
  });

  it("falls back to priority order among equally under-sampled providers", () => {
    const s = new HighestSuccessRateStrategy([
      { provider: "stripe", priority: 50, attempts: 1, successes: 1 },
      { provider: "razorpay", priority: 10, attempts: 1, successes: 1 },
    ]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("razorpay");
  });

  it("computes a 0 success rate safely for zero attempts", () => {
    expect(successRate({ provider: "x", priority: 1, attempts: 0, successes: 0 })).toBe(0);
  });
});

describe("MerchantPreferredStrategy", () => {
  it("uses the preferred provider when it's enabled", () => {
    const s = new MerchantPreferredStrategy("razorpay", ["mock-bank", "razorpay"]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("razorpay");
  });

  it("falls back to the first enabled provider when no preference is set", () => {
    const s = new MerchantPreferredStrategy(null, ["mock-bank", "stripe"]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("falls back to the first enabled provider when the preferred one is disabled/unlisted", () => {
    const s = new MerchantPreferredStrategy("stripe", ["mock-bank", "razorpay"]);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });

  it("falls back to mock-bank when nothing is enabled at all", () => {
    const s = new MerchantPreferredStrategy(null, []);
    expect(s.selectProvider(dummyPayment, dummyRegistry)).toBe("mock-bank");
  });
});

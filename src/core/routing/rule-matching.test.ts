import { describe, it, expect } from "vitest";
import { matchRoutingRule, type RuleCondition } from "./rule-matching";

function rule(overrides: Partial<RuleCondition>): RuleCondition {
  return {
    id: "rule_1",
    name: "test rule",
    priority: 100,
    enabled: true,
    currency: null,
    minAmount: null,
    maxAmount: null,
    provider: "stripe",
    ...overrides,
  };
}

describe("matchRoutingRule", () => {
  it("returns null when there are no rules", () => {
    expect(matchRoutingRule({ amount: 1000, currency: "INR" }, [])).toBeNull();
  });

  it("matches a rule with no conditions set (wildcard)", () => {
    const r = rule({ id: "r1" });
    expect(matchRoutingRule({ amount: 1000, currency: "INR" }, [r])).toEqual(r);
  });

  it("filters out a disabled rule even if it would otherwise match", () => {
    const r = rule({ id: "r1", enabled: false });
    expect(matchRoutingRule({ amount: 1000, currency: "INR" }, [r])).toBeNull();
  });

  it("respects a currency condition", () => {
    const r = rule({ id: "r1", currency: "USD" });
    expect(matchRoutingRule({ amount: 1000, currency: "INR" }, [r])).toBeNull();
    expect(matchRoutingRule({ amount: 1000, currency: "USD" }, [r])).toEqual(r);
  });

  it("respects minAmount/maxAmount bounds (inclusive)", () => {
    const r = rule({ id: "r1", minAmount: 5000, maxAmount: 10000 });
    expect(matchRoutingRule({ amount: 4999, currency: "INR" }, [r])).toBeNull();
    expect(matchRoutingRule({ amount: 5000, currency: "INR" }, [r])).toEqual(r);
    expect(matchRoutingRule({ amount: 10000, currency: "INR" }, [r])).toEqual(r);
    expect(matchRoutingRule({ amount: 10001, currency: "INR" }, [r])).toBeNull();
  });

  it("evaluates rules in ascending priority order and returns the first match", () => {
    const low = rule({ id: "r_low", priority: 50, provider: "razorpay" });
    const high = rule({ id: "r_high", priority: 10, provider: "stripe" });
    const result = matchRoutingRule({ amount: 1000, currency: "INR" }, [low, high]);
    expect(result?.provider).toBe("stripe");
  });

  it("skips a non-matching high-priority rule in favor of a matching lower-priority one", () => {
    const noMatch = rule({ id: "r1", priority: 10, currency: "USD", provider: "stripe" });
    const matches = rule({ id: "r2", priority: 50, currency: "INR", provider: "razorpay" });
    const result = matchRoutingRule({ amount: 1000, currency: "INR" }, [noMatch, matches]);
    expect(result?.provider).toBe("razorpay");
  });

  it("returns null when nothing matches", () => {
    const r = rule({ id: "r1", currency: "USD" });
    expect(matchRoutingRule({ amount: 1000, currency: "INR" }, [r])).toBeNull();
  });
});

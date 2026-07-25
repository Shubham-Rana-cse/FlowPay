import { describe, it, expect } from "vitest";
import { computeBalanceAfter } from "./ledger-rules";

describe("computeBalanceAfter", () => {
  it("adds a credit to the previous balance (capture)", () => {
    expect(computeBalanceAfter(0, "credit", 50000)).toBe(50000);
  });

  it("subtracts a debit from the previous balance (refund/settlement)", () => {
    expect(computeBalanceAfter(50000, "debit", 20000)).toBe(30000);
  });

  it("supports multiple sequential partial debits down to zero", () => {
    let balance = computeBalanceAfter(0, "credit", 100);
    balance = computeBalanceAfter(balance, "debit", 40);
    balance = computeBalanceAfter(balance, "debit", 60);
    expect(balance).toBe(0);
  });

  it("rejects a zero or negative amount", () => {
    expect(() => computeBalanceAfter(100, "credit", 0)).toThrow();
    expect(() => computeBalanceAfter(100, "debit", -5)).toThrow();
  });

  it("rejects a non-integer amount", () => {
    expect(() => computeBalanceAfter(100, "credit", 10.5)).toThrow();
  });
});

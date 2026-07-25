import { describe, it, expect } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("creates from major units correctly", () => {
    const m = Money.fromMajor(500, "INR");
    expect(m.getMinorUnits()).toBe(50000);
    expect(m.getCurrency()).toBe("INR");
    expect(m.toString()).toBe("500.00 INR");
  });

  it("creates from minor units directly", () => {
    const m = Money.fromMinorUnits(12345, "usd");
    expect(m.getCurrency()).toBe("USD");
    expect(m.toString()).toBe("123.45 USD");
  });

  it("adds two amounts of the same currency", () => {
    const a = Money.fromMajor(100, "INR");
    const b = Money.fromMajor(50.5, "INR");
    expect(a.add(b).toString()).toBe("150.50 INR");
  });

  it("subtracts two amounts of the same currency", () => {
    const a = Money.fromMajor(100, "INR");
    const b = Money.fromMajor(30, "INR");
    expect(a.subtract(b).toString()).toBe("70.00 INR");
  });

  it("throws on currency mismatch when adding", () => {
    const a = Money.fromMajor(100, "INR");
    const b = Money.fromMajor(100, "USD");
    expect(() => a.add(b)).toThrow(/Currency mismatch/);
  });

  it("throws on currency mismatch when subtracting", () => {
    const a = Money.fromMajor(100, "INR");
    const b = Money.fromMajor(100, "USD");
    expect(() => a.subtract(b)).toThrow(/Currency mismatch/);
  });

  it("throws on invalid currency code", () => {
    expect(() => Money.fromMajor(100, "IN")).toThrow(/Invalid currency code/);
  });

  it("detects negative amounts (e.g. after subtraction)", () => {
    const a = Money.fromMajor(10, "INR");
    const b = Money.fromMajor(20, "INR");
    expect(a.subtract(b).isNegative()).toBe(true);
  });

  it("never produces float drift for common decimal amounts", () => {
    const a = Money.fromMajor(19.99, "INR");
    const b = Money.fromMajor(0.01, "INR");
    expect(a.add(b).toString()).toBe("20.00 INR");
  });

  it("equals compares currency and amount", () => {
    const a = Money.fromMajor(50, "INR");
    const b = Money.fromMinorUnits(5000, "INR");
    expect(a.equals(b)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { resolveRefundAmount, nextStatusAfterRefund, RefundAmountExceedsRemainingError } from "./refund-rules";
import { PaymentStatus } from "@/constants/status";

describe("resolveRefundAmount", () => {
  it("defaults to the full held amount when no amount is requested (full refund)", () => {
    const refund = resolveRefundAmount(50000, undefined, "INR");
    expect(refund.getMinorUnits()).toBe(50000);
  });

  it("honors a smaller explicit amount (partial refund)", () => {
    const refund = resolveRefundAmount(50000, 10000, "INR");
    expect(refund.getMinorUnits()).toBe(10000);
  });

  it("allows refunding exactly the remaining amount", () => {
    const refund = resolveRefundAmount(50000, 50000, "INR");
    expect(refund.getMinorUnits()).toBe(50000);
  });

  it("throws when the requested amount exceeds what's held", () => {
    expect(() => resolveRefundAmount(50000, 50001, "INR")).toThrow(
      RefundAmountExceedsRemainingError
    );
  });

  it("throws when nothing is held (already fully refunded/settled)", () => {
    expect(() => resolveRefundAmount(0, undefined, "INR")).toThrow(
      RefundAmountExceedsRemainingError
    );
  });

  it("throws on a zero or negative explicit amount", () => {
    expect(() => resolveRefundAmount(50000, 0, "INR")).toThrow(RefundAmountExceedsRemainingError);
  });
});

describe("nextStatusAfterRefund", () => {
  it("returns REFUNDED when nothing remains held", () => {
    expect(nextStatusAfterRefund(0)).toBe(PaymentStatus.REFUNDED);
  });

  it("returns PARTIALLY_REFUNDED when some amount is still held", () => {
    expect(nextStatusAfterRefund(40000)).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });
});

import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, isTerminal, InvalidTransitionError } from "./state-machine";
import { PaymentStatus } from "@/constants/status";

describe("payment state machine", () => {
  it("allows CREATED -> PENDING", () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.PENDING)).toBe(true);
  });

  it("allows CREATED -> FAILED (validation failure before routing)", () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.FAILED)).toBe(true);
  });

  it("rejects CREATED -> CAPTURED (cannot skip authorization)", () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.CAPTURED)).toBe(false);
  });

  it("rejects any transition out of a terminal FAILED state", () => {
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PENDING)).toBe(false);
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.CREATED)).toBe(false);
  });

  it("rejects any transition out of a terminal REFUNDED state", () => {
    expect(canTransition(PaymentStatus.REFUNDED, PaymentStatus.CAPTURED)).toBe(false);
  });

  it("allows the retry loop PENDING -> RETRY -> PENDING", () => {
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.RETRY)).toBe(true);
    expect(canTransition(PaymentStatus.RETRY, PaymentStatus.PENDING)).toBe(true);
  });

  it("allows partial then full refund", () => {
    expect(canTransition(PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
    expect(canTransition(PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED)).toBe(true);
  });

  it("allows a second (and subsequent) partial refund without leaving PARTIALLY_REFUNDED (Phase 4)", () => {
    expect(canTransition(PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
  });

  it("assertTransition throws InvalidTransitionError on an illegal edge", () => {
    expect(() => assertTransition(PaymentStatus.CAPTURED, PaymentStatus.CREATED)).toThrow(
      InvalidTransitionError
    );
  });

  it("assertTransition does not throw on a legal edge", () => {
    expect(() => assertTransition(PaymentStatus.CREATED, PaymentStatus.PENDING)).not.toThrow();
  });

  it("allows retry-service.ts's poller to resolve RETRY/TIMEOUT straight to AUTHORIZED (Phase 6)", () => {
    expect(canTransition(PaymentStatus.RETRY, PaymentStatus.AUTHORIZED)).toBe(true);
    expect(canTransition(PaymentStatus.TIMEOUT, PaymentStatus.AUTHORIZED)).toBe(true);
  });

  it("allows RETRY to self-loop when a poll is still transient (Phase 6)", () => {
    expect(canTransition(PaymentStatus.RETRY, PaymentStatus.RETRY)).toBe(true);
  });

  it("allows RETRY/TIMEOUT to resolve to FAILED once cross-request retries are exhausted (Phase 6)", () => {
    expect(canTransition(PaymentStatus.RETRY, PaymentStatus.FAILED)).toBe(true);
    expect(canTransition(PaymentStatus.TIMEOUT, PaymentStatus.FAILED)).toBe(true);
  });

  it("identifies terminal states correctly", () => {
    expect(isTerminal(PaymentStatus.FAILED)).toBe(true);
    expect(isTerminal(PaymentStatus.REFUNDED)).toBe(true);
    expect(isTerminal(PaymentStatus.CREATED)).toBe(false);
    expect(isTerminal(PaymentStatus.CAPTURED)).toBe(false);
  });
});

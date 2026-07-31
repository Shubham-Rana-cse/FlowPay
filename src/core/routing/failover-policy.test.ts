import { describe, it, expect } from "vitest";
import { isFailoverEligible, FAILOVER_ELIGIBLE_STATUSES } from "./failover-policy";

describe("isFailoverEligible", () => {
  it("treats timeout as failover-eligible", () => {
    expect(isFailoverEligible("timeout")).toBe(true);
  });

  it("treats network_error as failover-eligible", () => {
    expect(isFailoverEligible("network_error")).toBe(true);
  });

  it("treats a generic provider-level failure as failover-eligible", () => {
    expect(isFailoverEligible("failed")).toBe(true);
  });

  it("does NOT treat insufficient_funds as failover-eligible (a genuine decline, not an outage)", () => {
    expect(isFailoverEligible("insufficient_funds")).toBe(false);
  });

  it("does NOT treat a successful status as failover-eligible", () => {
    expect(isFailoverEligible("authorized")).toBe(false);
    expect(isFailoverEligible("captured")).toBe(false);
  });

  it("exposes the exact same set the function checks against", () => {
    expect(FAILOVER_ELIGIBLE_STATUSES.has("timeout")).toBe(true);
    expect(FAILOVER_ELIGIBLE_STATUSES.has("insufficient_funds")).toBe(false);
  });
});

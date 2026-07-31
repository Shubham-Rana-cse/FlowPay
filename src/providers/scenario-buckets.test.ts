import { describe, it, expect } from "vitest";
import { stripeScenarioForAmount, razorpayScenarioForAmount } from "./scenario-buckets";

describe("stripeScenarioForAmount", () => {
  it("succeeds for 00-93", () => {
    expect(stripeScenarioForAmount(10000)).toBe("success"); // ends 00
    expect(stripeScenarioForAmount(10093)).toBe("success"); // ends 93
  });
  it("fails for 94-96", () => {
    expect(stripeScenarioForAmount(10094)).toBe("failure");
    expect(stripeScenarioForAmount(10096)).toBe("failure");
  });
  it("times out for 97-98", () => {
    expect(stripeScenarioForAmount(10097)).toBe("timeout");
    expect(stripeScenarioForAmount(10098)).toBe("timeout");
  });
  it("network errors for 99", () => {
    expect(stripeScenarioForAmount(10099)).toBe("network_error");
  });
});

describe("razorpayScenarioForAmount", () => {
  it("succeeds for 00-84", () => {
    expect(razorpayScenarioForAmount(10000)).toBe("success");
    expect(razorpayScenarioForAmount(10084)).toBe("success");
  });
  it("fails for 85-90", () => {
    expect(razorpayScenarioForAmount(10085)).toBe("failure");
    expect(razorpayScenarioForAmount(10090)).toBe("failure");
  });
  it("times out for 91-95", () => {
    expect(razorpayScenarioForAmount(10091)).toBe("timeout");
    expect(razorpayScenarioForAmount(10095)).toBe("timeout");
  });
  it("network errors for 96-99", () => {
    expect(razorpayScenarioForAmount(10096)).toBe("network_error");
    expect(razorpayScenarioForAmount(10099)).toBe("network_error");
  });
});

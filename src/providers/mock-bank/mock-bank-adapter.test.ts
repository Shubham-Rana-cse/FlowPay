import { describe, it, expect } from "vitest";
import { MockBankAdapter, scenarioForAmount, TRANSIENT_MOCK_BANK_STATUSES } from "./mock-bank-adapter";

describe("scenarioForAmount", () => {
  it("maps 0-89 to success", () => {
    expect(scenarioForAmount(50000)).toBe("success"); // 50000 % 100 = 0
    expect(scenarioForAmount(12345)).toBe("success"); // 45
  });

  it("maps 90-93 to insufficient_funds", () => {
    expect(scenarioForAmount(10090)).toBe("insufficient_funds");
    expect(scenarioForAmount(10093)).toBe("insufficient_funds");
  });

  it("maps 94-96 to failure", () => {
    expect(scenarioForAmount(10094)).toBe("failure");
    expect(scenarioForAmount(10096)).toBe("failure");
  });

  it("maps 97-98 to timeout", () => {
    expect(scenarioForAmount(10097)).toBe("timeout");
    expect(scenarioForAmount(10098)).toBe("timeout");
  });

  it("maps 99 to network_error", () => {
    expect(scenarioForAmount(10099)).toBe("network_error");
  });

  it("is stable for negative or zero amounts (defensive only, never expected in practice)", () => {
    expect(() => scenarioForAmount(0)).not.toThrow();
    expect(scenarioForAmount(0)).toBe("success");
  });
});

describe("MockBankAdapter.authorize", () => {
  const adapter = new MockBankAdapter();

  it("succeeds and returns a providerRef for a 'success' amount", async () => {
    const result = await adapter.authorize({ id: "pay_1", amount: 50000, currency: "INR" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("authorized");
    expect(result.providerRef).toMatch(/^mockbank_/);
  });

  it("declines with INSUFFICIENT_FUNDS for a 90-93 amount", async () => {
    const result = await adapter.authorize({ id: "pay_2", amount: 10090, currency: "INR" });
    expect(result.success).toBe(false);
    expect(result.status).toBe("insufficient_funds");
    expect(result.errorCode).toBe("INSUFFICIENT_FUNDS");
  });

  it("returns a transient timeout for a 97-98 amount", async () => {
    const result = await adapter.authorize({ id: "pay_3", amount: 10097, currency: "INR" });
    expect(result.success).toBe(false);
    expect(result.status).toBe("timeout");
    expect(TRANSIENT_MOCK_BANK_STATUSES.has(result.status)).toBe(true);
  });

  it("returns a transient network_error for a 99 amount", async () => {
    const result = await adapter.authorize({ id: "pay_4", amount: 10099, currency: "INR" });
    expect(result.success).toBe(false);
    expect(result.status).toBe("network_error");
    expect(TRANSIENT_MOCK_BANK_STATUSES.has(result.status)).toBe(true);
  });
});

describe("MockBankAdapter.capture", () => {
  const adapter = new MockBankAdapter();

  it("succeeds when given a providerRef", async () => {
    const result = await adapter.capture({ id: "pay_1", amount: 50000, currency: "INR" }, "mockbank_abc");
    expect(result.success).toBe(true);
    expect(result.status).toBe("captured");
    expect(result.providerRef).toBe("mockbank_abc");
  });

  it("fails when providerRef is missing", async () => {
    const result = await adapter.capture({ id: "pay_1", amount: 50000, currency: "INR" }, "");
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("MISSING_PROVIDER_REF");
  });
});

describe("MockBankAdapter.refund and checkStatus", () => {
  const adapter = new MockBankAdapter();

  it("refund succeeds when given a providerRef", async () => {
    const result = await adapter.refund({ id: "pay_1", amount: 50000, currency: "INR" }, 50000, "mockbank_abc");
    expect(result.success).toBe(true);
    expect(result.status).toBe("refunded");
  });

  it("checkStatus reports the authorization as still valid", async () => {
    const result = await adapter.checkStatus("mockbank_abc");
    expect(result.success).toBe(true);
    expect(result.providerRef).toBe("mockbank_abc");
  });
});

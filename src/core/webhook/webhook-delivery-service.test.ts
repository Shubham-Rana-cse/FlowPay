import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { signPayload } from "./webhook-delivery-service";

describe("signPayload", () => {
  it("produces the same signature a merchant would compute independently with HMAC-SHA256", () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment.captured" });
    const secret = "test-secret";

    const expected = createHmac("sha256", secret).update(body).digest("hex");
    expect(signPayload(body, secret)).toBe(expected);
  });

  it("is deterministic for the same body and secret", () => {
    const body = JSON.stringify({ id: "evt_2" });
    expect(signPayload(body, "s")).toBe(signPayload(body, "s"));
  });

  it("changes when the body changes", () => {
    const sigA = signPayload(JSON.stringify({ a: 1 }), "s");
    const sigB = signPayload(JSON.stringify({ a: 2 }), "s");
    expect(sigA).not.toBe(sigB);
  });

  it("changes when the secret changes", () => {
    const body = JSON.stringify({ a: 1 });
    expect(signPayload(body, "s1")).not.toBe(signPayload(body, "s2"));
  });
});

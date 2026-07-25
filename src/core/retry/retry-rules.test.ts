import { describe, it, expect } from "vitest";
import { computeNextRetryAt, isRetryExhausted, MAX_CROSS_REQUEST_RETRIES } from "./retry-rules";

describe("computeNextRetryAt", () => {
  it("schedules the first retry 1 minute out", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextRetryAt(0, now).getTime() - now.getTime()).toBe(60_000);
  });

  it("backs off further with each successive retry", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = computeNextRetryAt(0, now).getTime() - now.getTime();
    const second = computeNextRetryAt(1, now).getTime() - now.getTime();
    const third = computeNextRetryAt(2, now).getTime() - now.getTime();
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("caps backoff at the last configured step instead of growing forever", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const atCap = computeNextRetryAt(MAX_CROSS_REQUEST_RETRIES - 1, now).getTime();
    const beyondCap = computeNextRetryAt(MAX_CROSS_REQUEST_RETRIES + 10, now).getTime();
    expect(beyondCap).toBe(atCap);
  });

  it("treats a negative retryCount the same as 0 (defensive)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextRetryAt(-3, now).getTime()).toBe(computeNextRetryAt(0, now).getTime());
  });
});

describe("isRetryExhausted", () => {
  it("is not exhausted below the max", () => {
    expect(isRetryExhausted(0)).toBe(false);
    expect(isRetryExhausted(MAX_CROSS_REQUEST_RETRIES - 1)).toBe(false);
  });

  it("is exhausted at and beyond the max", () => {
    expect(isRetryExhausted(MAX_CROSS_REQUEST_RETRIES)).toBe(true);
    expect(isRetryExhausted(MAX_CROSS_REQUEST_RETRIES + 5)).toBe(true);
  });
});

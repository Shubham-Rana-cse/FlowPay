import { describe, it, expect } from "vitest";
import { ProviderRegistry, ProviderNotRegisteredError } from "./provider-registry";
import type { ProviderAdapter } from "@/providers/provider-adapter.interface";

function fakeAdapter(): ProviderAdapter {
  return {
    authorize: async () => ({ success: true, status: "authorized" }),
    capture: async () => ({ success: true, status: "captured" }),
    refund: async () => ({ success: true, status: "refunded" }),
    checkStatus: async () => ({ success: true, status: "authorized" }),
  };
}

describe("ProviderRegistry", () => {
  it("returns a registered adapter by name", () => {
    const registry = new ProviderRegistry();
    const adapter = fakeAdapter();
    registry.register("mock-bank", adapter);
    expect(registry.get("mock-bank")).toBe(adapter);
  });

  it("reports whether a name is registered", () => {
    const registry = new ProviderRegistry();
    expect(registry.has("mock-bank")).toBe(false);
    registry.register("mock-bank", fakeAdapter());
    expect(registry.has("mock-bank")).toBe(true);
  });

  it("throws ProviderNotRegisteredError for an unknown provider", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get("stripe")).toThrow(ProviderNotRegisteredError);
  });

  it("allows a later registration to replace an earlier one for the same name", () => {
    const registry = new ProviderRegistry();
    const first = fakeAdapter();
    const second = fakeAdapter();
    registry.register("mock-bank", first);
    registry.register("mock-bank", second);
    expect(registry.get("mock-bank")).toBe(second);
  });
});

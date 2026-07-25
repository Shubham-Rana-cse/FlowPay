// PHASE 3 — Provider Registry: where ProviderAdapters are registered & looked up.
// See Phase 0 §6, FR20. Adding a new provider later (Phase 7) is purely additive:
// write the adapter, `register()` it, done — no changes to this class.
import type { ProviderAdapter } from "@/providers/provider-adapter.interface";

export class ProviderNotRegisteredError extends Error {
  constructor(name: string) {
    super(`No provider adapter registered for "${name}"`);
    this.name = "ProviderNotRegisteredError";
  }
}

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  register(name: string, adapter: ProviderAdapter): void {
    this.adapters.set(name, adapter);
  }

  get(name: string): ProviderAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new ProviderNotRegisteredError(name);
    return adapter;
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }
}

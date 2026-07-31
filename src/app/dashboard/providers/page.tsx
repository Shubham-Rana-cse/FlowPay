"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api-client";

type ProviderConfig = {
  id: string;
  provider: string;
  enabled: boolean;
  priority: number;
  costBps: number;
};

type RoutingRule = {
  id: string;
  name: string;
  provider: string;
  priority: number;
  enabled: boolean;
  currency: string | null;
  minAmount: number | null;
  maxAmount: number | null;
};

type Settings = {
  routingStrategy: string;
  preferredProvider: string | null;
  failoverEnabled: boolean;
};

const KNOWN_PROVIDERS = ["mock-bank", "stripe", "razorpay"];
const STRATEGIES = ["FIXED", "ROUND_ROBIN", "CHEAPEST", "HIGHEST_SUCCESS_RATE", "MERCHANT_PREFERRED", "RULE_BASED"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newRule, setNewRule] = useState({
    name: "",
    provider: "mock-bank",
    priority: 100,
    currency: "",
    minAmount: "",
    maxAmount: "",
  });

  const load = useCallback(async () => {
    const [providersRes, rulesRes, settingsRes] = await Promise.all([
      apiFetch<{ providers: ProviderConfig[] }>("/api/merchant/providers"),
      apiFetch<{ rules: RoutingRule[] }>("/api/merchant/routing-rules"),
      apiFetch<Settings>("/api/merchant/settings"),
    ]);
    if (providersRes.ok) setProviders(providersRes.data.providers ?? []);
    if (rulesRes.ok) setRules(rulesRes.data.rules ?? []);
    if (settingsRes.ok) setSettings(settingsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function configFor(provider: string): ProviderConfig | undefined {
    return providers.find((p) => p.provider === provider);
  }

  async function toggleProvider(provider: string, enabled: boolean) {
    setError(null);
    const existing = configFor(provider);
    const { ok, data } = await apiFetch<ProviderConfig & { error?: { message: string } }>(
      "/api/merchant/providers",
      {
        method: "POST",
        body: JSON.stringify({
          provider,
          enabled,
          priority: existing?.priority ?? 100,
          costBps: existing?.costBps ?? 0,
        }),
      }
    );
    if (!ok) {
      setError(data.error?.message ?? "Could not update provider.");
      return;
    }
    load();
  }

  async function updateProviderField(provider: string, field: "priority" | "costBps", value: number) {
    const existing = configFor(provider);
    await apiFetch("/api/merchant/providers", {
      method: "POST",
      body: JSON.stringify({
        provider,
        enabled: existing?.enabled ?? true,
        priority: field === "priority" ? value : (existing?.priority ?? 100),
        costBps: field === "costBps" ? value : (existing?.costBps ?? 0),
      }),
    });
    load();
  }

  async function handleStrategyChange(field: keyof Settings, value: string | boolean) {
    if (!settings) return;
    setSavingStrategy(true);
    setError(null);
    const next = { ...settings, [field]: value };
    setSettings(next);

    const { ok, data } = await apiFetch<Settings & { error?: { message: string } }>(
      "/api/merchant/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          routingStrategy: next.routingStrategy,
          preferredProvider: next.preferredProvider ?? "",
          failoverEnabled: next.failoverEnabled,
        }),
      }
    );
    setSavingStrategy(false);
    if (!ok) setError(data.error?.message ?? "Could not save routing strategy.");
  }

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { ok, data } = await apiFetch<RoutingRule & { error?: { message: string } }>(
      "/api/merchant/routing-rules",
      {
        method: "POST",
        body: JSON.stringify({
          name: newRule.name || `Rule for ${newRule.provider}`,
          provider: newRule.provider,
          priority: Number(newRule.priority) || 100,
          currency: newRule.currency || undefined,
          minAmount: newRule.minAmount ? Number(newRule.minAmount) : undefined,
          maxAmount: newRule.maxAmount ? Number(newRule.maxAmount) : undefined,
        }),
      }
    );
    if (!ok) {
      setError(data.error?.message ?? "Could not create rule.");
      return;
    }
    setNewRule({ name: "", provider: "mock-bank", priority: 100, currency: "", minAmount: "", maxAmount: "" });
    load();
  }

  async function handleDeleteRule(id: string) {
    await apiFetch(`/api/merchant/routing-rules/${id}`, { method: "DELETE" });
    load();
  }

  async function handleToggleRule(rule: RoutingRule) {
    await apiFetch(`/api/merchant/routing-rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    load();
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Providers &amp; Routing</h1>
        <p className="mt-1 text-sm text-muted">
          Enable/Disable payment providers, choose how the Dynamic Routing
          Engine picks between them, and set up automatic failover and rule-based overrides.
          Leaving every provider below untouched keeps routing through mock-bank only.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Provider switching */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Providers</h2>
        <p className="mt-1 text-xs text-muted">
          Enable a provider to include it in routing. Priority breaks ties between
          strategies and sets failover order (lower = tried first); cost (basis points)
          is used by the &quot;Cheapest&quot; strategy.
        </p>

        <div className="mt-4 divide-y divide-border">
          {KNOWN_PROVIDERS.map((provider) => {
            const cfg = configFor(provider);
            const enabled = cfg?.enabled ?? false;
            return (
              <div key={provider} className="flex items-center gap-4 py-3">
                <label className="flex w-40 items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleProvider(provider, e.target.checked)}
                  />
                  {provider}
                </label>
                <label className="flex items-center gap-1 text-xs text-muted">
                  Priority
                  <input
                    type="number"
                    className="w-16 rounded border border-border bg-background px-1 py-0.5"
                    defaultValue={cfg?.priority ?? 100}
                    onBlur={(e) => updateProviderField(provider, "priority", Number(e.target.value))}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-muted">
                  Cost (bps)
                  <input
                    type="number"
                    className="w-16 rounded border border-border bg-background px-1 py-0.5"
                    defaultValue={cfg?.costBps ?? 0}
                    onBlur={(e) => updateProviderField(provider, "costBps", Number(e.target.value))}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </section>

      {/* Strategy */}
      {settings && (
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Routing strategy</h2>
          <p className="mt-1 text-xs text-muted">
            Applies whenever no routing rule below matches a payment.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <select
              className="rounded border border-border bg-background px-2 py-1 text-sm"
              value={settings.routingStrategy}
              onChange={(e) => handleStrategyChange("routingStrategy", e.target.value)}
              disabled={savingStrategy}
            >
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>

            {settings.routingStrategy === "MERCHANT_PREFERRED" && (
              <select
                className="rounded border border-border bg-background px-2 py-1 text-sm"
                value={settings.preferredProvider ?? ""}
                onChange={(e) => handleStrategyChange("preferredProvider", e.target.value)}
              >
                <option value="">— pick a provider —</option>
                {KNOWN_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={settings.failoverEnabled}
                onChange={(e) => handleStrategyChange("failoverEnabled", e.target.checked)}
              />
              Automatic failover
            </label>
          </div>
        </section>
      )}

      {/* Rules */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Routing rules</h2>
        <p className="mt-1 text-xs text-muted">
          Evaluated in ascending priority order; the first enabled match wins and
          overrides the strategy above for that payment.
        </p>

        <div className="mt-4 space-y-2">
          {rules.length === 0 && <p className="text-xs text-muted">No rules configured.</p>}
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className={rule.enabled ? "text-foreground" : "text-muted line-through"}>
                {rule.name}
              </span>
              <span className="text-xs text-muted">
                {rule.currency ?? "any currency"} · {rule.minAmount ?? "0"}–{rule.maxAmount ?? "∞"} → {rule.provider}
                {" "}(priority {rule.priority})
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => handleToggleRule(rule)}
                  className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleCreateRule} className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label className="block text-xs text-muted">Name</label>
            <input
              className="mt-1 w-40 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              placeholder="High value USD"
            />
          </div>
          <div>
            <label className="block text-xs text-muted">Provider</label>
            <select
              className="mt-1 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.provider}
              onChange={(e) => setNewRule({ ...newRule, provider: e.target.value })}
            >
              {KNOWN_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted">Currency</label>
            <select
              className="mt-1 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.currency}
              onChange={(e) => setNewRule({ ...newRule, currency: e.target.value })}
            >
              <option value="">any</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted">Min amount</label>
            <input
              type="number"
              className="mt-1 w-24 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.minAmount}
              onChange={(e) => setNewRule({ ...newRule, minAmount: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-muted">Max amount</label>
            <input
              type="number"
              className="mt-1 w-24 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.maxAmount}
              onChange={(e) => setNewRule({ ...newRule, maxAmount: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-muted">Priority</label>
            <input
              type="number"
              className="mt-1 w-20 rounded border border-border bg-background px-2 py-1 text-sm"
              value={newRule.priority}
              onChange={(e) => setNewRule({ ...newRule, priority: Number(e.target.value) })}
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
          >
            Add rule
          </button>
        </form>
      </section>
    </div>
  );
}

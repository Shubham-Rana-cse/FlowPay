"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api-client";

type Settings = {
  autoCapture: boolean;
  defaultCurrency: string;
  timezone: string;
  webhookUrl: string | null;
  webhookSecret: string;
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);

  useEffect(() => {
    apiFetch<Settings>("/api/merchant/settings").then(({ ok, data }) => {
      if (ok) setSettings(data);
      setLoading(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const { ok, data } = await apiFetch<Settings & { error?: { message: string } }>(
      "/api/merchant/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          autoCapture: settings.autoCapture,
          defaultCurrency: settings.defaultCurrency,
          timezone: settings.timezone,
          webhookUrl: settings.webhookUrl ?? "",
        }),
      }
    );

    setSaving(false);

    if (!ok) {
      setError(data.error?.message ?? "Could not save settings.");
      return;
    }

    setSettings(data);
    setSaved(true);
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!settings) return <p className="text-sm text-danger">Could not load settings.</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Account-level configuration — auto-capture, default currency, timezone, and
        your webhook endpoint.
      </p>

      <form
        onSubmit={handleSave}
        className="mt-6 space-y-5 rounded-lg border border-border bg-surface p-6"
      >
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Settings saved.
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Auto-capture</p>
            <p className="text-xs text-muted">
              Capture a payment immediately after it&apos;s authorized.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, autoCapture: !settings.autoCapture })}
            className={`h-6 w-11 rounded-full transition-colors ${
              settings.autoCapture ? "bg-accent" : "bg-surface-raised"
            }`}
          >
            <span
              className={`block h-5 w-5 translate-x-0.5 rounded-full bg-foreground transition-transform ${
                settings.autoCapture ? "translate-x-[22px]" : ""
              }`}
            />
          </button>
        </div>

        <div className="space-y-1">
          <label className="block text-sm text-muted">Default currency</label>
          <select
            value={settings.defaultCurrency}
            onChange={(e) => setSettings({ ...settings, defaultCurrency: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-sm text-muted">Timezone</label>
          <input
            value={settings.timezone}
            onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm text-muted">Webhook URL</label>
          <input
            type="url"
            placeholder="https://your-app.example.com/webhooks/flowpay"
            value={settings.webhookUrl ?? ""}
            onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
          <p className="text-xs text-muted">
            payment.captured, payment.failed, refund.completed, and settlement.completed are
            POSTed here, signed with the secret below.
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm text-muted">Webhook signing secret</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-surface-raised px-3 py-2 font-mono text-xs text-foreground">
              {revealSecret ? settings.webhookSecret : "•".repeat(32)}
            </code>
            <button
              type="button"
              onClick={() => setRevealSecret((v) => !v)}
              className="shrink-0 text-xs text-muted hover:text-foreground"
            >
              {revealSecret ? "Hide" : "Reveal"}
            </button>
          </div>
          <p className="text-xs text-muted">
            HMAC-SHA256 over the raw request body — verify it against the{" "}
            <code>X-Signature</code> header.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}

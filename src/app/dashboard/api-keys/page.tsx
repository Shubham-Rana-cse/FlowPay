"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api-client";

type ApiKey = {
  id: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    const { ok, data } = await apiFetch<{ keys?: ApiKey[] }>(
      "/api/merchant/api-keys"
    );
    if (ok && data.keys) setKeys(data.keys);
    setLoading(false);
  }

  useEffect(() => {
    // Standard "set loading, then fetch" pattern; setLoading(true) firing
    // synchronously here is intentional, not a bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadKeys();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    const { ok, data } = await apiFetch<{ rawKey?: string; error?: { message: string } }>(
      "/api/merchant/api-keys",
      { method: "POST", body: JSON.stringify({ label: label || undefined }) }
    );

    setCreating(false);

    if (!ok || !data.rawKey) {
      setError(data.error?.message ?? "Could not generate key.");
      return;
    }

    setRevealedKey(data.rawKey);
    setLabel("");
    loadKeys();
  }

  async function handleRevoke(id: string) {
    await apiFetch(`/api/merchant/api-keys/${id}/revoke`, { method: "POST" });
    loadKeys();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">API keys</h1>
      <p className="mt-1 text-sm text-muted">
        Used to authenticate server-to-server requests to the Payment API.
      </p>

      {revealedKey && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm text-warning">
            Save this key now — it won&apos;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-surface-raised px-3 py-2 font-mono text-sm text-foreground">
            {revealedKey}
          </code>
          <button
            onClick={() => setRevealedKey(null)}
            className="mt-3 text-xs text-muted hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="mt-6 flex items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex-1 space-y-1">
          <label htmlFor="label" className="block text-sm text-muted">
            Label (optional)
          </label>
          <input
            id="label"
            type="text"
            placeholder="e.g. Production backend"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Generating…" : "Generate key"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-muted">
              <th className="px-4 py-2 font-normal">Label</th>
              <th className="px-4 py-2 font-normal">Created</th>
              <th className="px-4 py-2 font-normal">Status</th>
              <th className="px-4 py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No API keys yet. Generate one above.
                </td>
              </tr>
            )}
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">
                  {key.label || <span className="text-muted">Untitled</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {new Date(key.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      key.isActive
                        ? "bg-success/10 text-success"
                        : "bg-muted/10 text-muted"
                    }`}
                  >
                    {key.isActive ? "Active" : "Revoked"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {key.isActive && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="text-xs text-danger hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

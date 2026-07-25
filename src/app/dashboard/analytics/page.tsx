"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api-client";

type Analytics = {
  total_payments: number;
  terminal_payments: number;
  success_count: number;
  failure_count: number;
  success_rate: number | null;
  status_breakdown: Record<string, number>;
  volume_by_currency: Record<string, number>;
  failure_breakdown_by_error_code: { error_code: string; count: number }[];
};

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Analytics>("/api/merchant/analytics").then(({ ok, data }) => {
      if (ok) setAnalytics(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (!analytics) return <p className="text-sm text-danger">Could not load analytics.</p>;

  const maxStatusCount = Math.max(1, ...Object.values(analytics.status_breakdown));

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
      <p className="mt-1 text-sm text-muted">
        Aggregate success rate, volume, and failure breakdown (FR18).
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-muted">Total payments</p>
          <p className="mt-2 font-mono text-2xl text-foreground">{analytics.total_payments}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-muted">Success rate</p>
          <p className="mt-2 font-mono text-2xl text-foreground">
            {analytics.success_rate == null ? "—" : `${(analytics.success_rate * 100).toFixed(1)}%`}
          </p>
          <p className="mt-2 text-xs text-muted">
            {analytics.success_count} succeeded / {analytics.terminal_payments} terminal
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-muted">Captured volume</p>
          <p className="mt-2 font-mono text-lg text-foreground">
            {Object.entries(analytics.volume_by_currency).length === 0
              ? "—"
              : Object.entries(analytics.volume_by_currency)
                  .map(([c, v]) => `${(v / 100).toLocaleString()} ${c}`)
                  .join(", ")}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">
        Status breakdown
      </h2>
      <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface p-5">
        {Object.entries(analytics.status_breakdown).map(([status, count]) => (
          <div key={status} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-sm text-muted">{status}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(count / maxStatusCount) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-sm text-foreground">
              {count}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">
        Failure breakdown by error code
      </h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-muted">
              <th className="px-4 py-2 font-normal">Error code</th>
              <th className="px-4 py-2 font-normal">Count</th>
            </tr>
          </thead>
          <tbody>
            {analytics.failure_breakdown_by_error_code.map((f) => (
              <tr key={f.error_code} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-foreground">{f.error_code}</td>
                <td className="px-4 py-3 text-foreground">{f.count}</td>
              </tr>
            ))}
            {analytics.failure_breakdown_by_error_code.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-muted">
                  No failures recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-client";

type Payment = {
  id: string;
  order_id: string;
  order_reference: string | null;
  status: string;
  amount: number;
  currency: string;
  provider: string | null;
  created_at: string;
};

const STATUS_OPTIONS = [
  "",
  "CREATED",
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "RETRY",
  "TIMEOUT",
];

const STATUS_STYLES: Record<string, string> = {
  CAPTURED: "bg-success/10 text-success",
  REFUNDED: "bg-accent/10 text-accent",
  PARTIALLY_REFUNDED: "bg-warning/10 text-warning",
  FAILED: "bg-danger/10 text-danger",
  TIMEOUT: "bg-danger/10 text-danger",
  RETRY: "bg-warning/10 text-warning",
  AUTHORIZED: "bg-accent/10 text-accent",
  PENDING: "bg-muted/10 text-muted",
  CREATED: "bg-muted/10 text-muted",
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    const { ok, data } = await apiFetch<{ payments: Payment[] }>(
      `/api/merchant/payments?${params.toString()}`
    );
    if (ok) setPayments(data.payments ?? []);
    setLoading(false);
  }, [status, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-foreground">Payments</h1>
      <p className="mt-1 text-sm text-muted">
        Every payment attempt, with its full event and ledger history (FR17, FR19).
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="space-y-1">
          <label className="block text-sm text-muted">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "All"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <label className="block text-sm text-muted">Search (payment ID or order reference)</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="pay_... or cart_998"
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-muted">
              <th className="px-4 py-2 font-normal">ID</th>
              <th className="px-4 py-2 font-normal">Order ref</th>
              <th className="px-4 py-2 font-normal">Amount</th>
              <th className="px-4 py-2 font-normal">Provider</th>
              <th className="px-4 py-2 font-normal">Status</th>
              <th className="px-4 py-2 font-normal">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No payments match these filters.
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/payments/${p.id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {p.id}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{p.order_reference ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-foreground">
                  {(p.amount / 100).toLocaleString()} {p.currency}
                </td>
                <td className="px-4 py-3 text-muted">{p.provider ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[p.status] ?? "bg-muted/10 text-muted"}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(p.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/app/lib/api-client";

type Order = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  reference: string | null;
  created_at: string;
};

const STATUS_OPTIONS = ["", "CREATED", "PAID", "FAILED", "EXPIRED"];

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-success/10 text-success",
  CREATED: "bg-accent/10 text-accent",
  FAILED: "bg-danger/10 text-danger",
  EXPIRED: "bg-muted/10 text-muted",
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    const { ok, data } = await apiFetch<{ orders: Order[] }>(
      `/api/merchant/orders?${params.toString()}`
    );
    if (ok) setOrders(data.orders ?? []);
    setLoading(false);
  }, [status, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground">Orders</h1>
      <p className="mt-1 text-sm text-muted">
        Everything a customer is being asked to pay for.
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
          <label className="block text-sm text-muted">Search (ID or reference)</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ord_... or cart_998"
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-muted">
              <th className="px-4 py-2 font-normal">ID</th>
              <th className="px-4 py-2 font-normal">Reference</th>
              <th className="px-4 py-2 font-normal">Amount</th>
              <th className="px-4 py-2 font-normal">Status</th>
              <th className="px-4 py-2 font-normal">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  No orders match these filters.
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-foreground">{o.id}</td>
                <td className="px-4 py-3 text-muted">{o.reference ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-foreground">
                  {(o.amount / 100).toLocaleString()} {o.currency}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[o.status] ?? "bg-muted/10 text-muted"}`}
                  >
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(o.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

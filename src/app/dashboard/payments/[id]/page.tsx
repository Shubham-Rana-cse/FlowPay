"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/app/lib/api-client";

type PaymentDetail = {
  payment: {
    id: string;
    order_id: string;
    status: string;
    amount: number;
    currency: string;
    provider: string | null;
    created_at: string;
    updated_at: string;
    retry_count: number;
    next_retry_at: string | null;
  };
  events: { id: string; event_type: string; metadata: unknown; created_at: string }[];
  ledger: {
    entries: { id: string; type: string; amount: number; balance_after: number; created_at: string }[];
    current_balance: number;
  };
};

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PaymentDetail & { error?: { message: string } }>(
      `/api/merchant/payments/${params.id}`
    ).then(({ ok, data }) => {
      if (ok) setDetail(data);
      else setError(data.error?.message ?? "Could not load this payment.");
      setLoading(false);
    });
  }, [params.id]);

  if (loading) return <p className="text-sm text-muted">Loading…</p>;
  if (error || !detail) return <p className="text-sm text-danger">{error ?? "Not found."}</p>;

  const { payment, events, ledger } = detail;

  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs text-muted">{payment.id}</p>
      <h1 className="mt-1 text-xl font-semibold text-foreground">
        {(payment.amount / 100).toLocaleString()} {payment.currency}
      </h1>
      <p className="mt-1 text-sm text-muted">
        Order <span className="font-mono">{payment.order_id}</span> · {payment.provider ?? "no provider"} ·{" "}
        {payment.status}
      </p>

      {(payment.status === "TIMEOUT" || payment.status === "RETRY") && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Awaiting automatic retry (Phase 6)</p>
          <p className="mt-1 text-muted">
            Cross-request retry {payment.retry_count} of 5
            {payment.next_retry_at && (
              <>
                {" "}
                · next attempt due {new Date(payment.next_retry_at).toLocaleString()}
              </>
            )}
            . Picked up automatically by the retry poller — no action needed.
          </p>
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">
        Event timeline
      </h2>
      <div className="mt-3 rounded-lg border border-border bg-surface">
        {events.map((e, i) => (
          <div
            key={e.id}
            className={`px-4 py-3 text-sm ${i !== events.length - 1 ? "border-b border-border" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-foreground">{e.event_type}</span>
              <span className="text-xs text-muted">{new Date(e.created_at).toLocaleString()}</span>
            </div>
            {!!e.metadata && (
              <pre className="mt-1 overflow-x-auto text-xs text-muted">
                {JSON.stringify(e.metadata, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {events.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No events yet.</p>}
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-muted">
        Ledger (held balance: {(ledger.current_balance / 100).toLocaleString()} {payment.currency})
      </h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-muted">
              <th className="px-4 py-2 font-normal">Type</th>
              <th className="px-4 py-2 font-normal">Amount</th>
              <th className="px-4 py-2 font-normal">Balance after</th>
              <th className="px-4 py-2 font-normal">When</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 capitalize text-foreground">{entry.type}</td>
                <td className="px-4 py-3 font-mono text-foreground">
                  {entry.type === "debit" ? "-" : "+"}
                  {(entry.amount / 100).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-muted">
                  {(entry.balance_after / 100).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(entry.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {ledger.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No ledger entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

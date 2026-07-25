"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/app/lib/api-client";

type Delivery = {
  id: string;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

type WebhookEvent = {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
  deliveries: Delivery[];
};

const DELIVERY_STYLES: Record<string, string> = {
  DELIVERED: "bg-success/10 text-success",
  RETRYING: "bg-warning/10 text-warning",
  FAILED: "bg-danger/10 text-danger",
  PENDING: "bg-muted/10 text-muted",
};

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [redelivering, setRedelivering] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { ok, data } = await apiFetch<{ events: WebhookEvent[] }>("/api/merchant/webhooks");
    if (ok) setEvents(data.events ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleRedeliver(id: string) {
    setRedelivering(id);
    await apiFetch(`/api/merchant/webhooks/${id}/redeliver`, { method: "POST" });
    setRedelivering(null);
    load();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-foreground">Webhooks</h1>
      <p className="mt-1 text-sm text-muted">
        Recent business events and their delivery attempts to your webhook URL (FR15). Configure
        the URL under Settings.
      </p>

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && events.length === 0 && (
          <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
            No webhook events yet. They&apos;re created on payment captures, refunds, and
            settlements.
          </div>
        )}
        {events.map((event) => (
          <div key={event.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-sm text-foreground">{event.event_type}</span>
                <span className="ml-2 text-xs text-muted">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => handleRedeliver(event.id)}
                disabled={redelivering === event.id}
                className="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-surface-raised disabled:opacity-50"
              >
                {redelivering === event.id ? "Retrying…" : "Retry delivery"}
              </button>
            </div>

            <div className="mt-3 space-y-1">
              {event.deliveries.length === 0 && (
                <p className="text-xs text-muted">
                  No delivery attempts — is a webhook URL configured?
                </p>
              )}
              {event.deliveries.map((d) => (
                <div key={d.id} className="flex items-center gap-3 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 ${DELIVERY_STYLES[d.status] ?? "bg-muted/10 text-muted"}`}
                  >
                    {d.status}
                  </span>
                  <span className="text-muted">attempt #{d.attempt_count}</span>
                  <span className="text-muted">{new Date(d.created_at).toLocaleString()}</span>
                  {d.next_retry_at && (
                    <span className="text-muted">
                      next retry {new Date(d.next_retry_at).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

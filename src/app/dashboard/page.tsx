"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-client";

type Analytics = {
  total_payments: number;
  success_rate: number | null;
  volume_by_currency: Record<string, number>;
  status_breakdown: Record<string, number>;
};

function formatMinorUnits(amount: number, currency: string): string {
  return `${(amount / 100).toLocaleString()} ${currency}`;
}

export default function DashboardHomePage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Analytics>("/api/merchant/analytics").then(({ ok, data }) => {
      if (ok) setAnalytics(data);
      setLoading(false);
    });
  }, []);

  const volumeEntries = analytics ? Object.entries(analytics.volume_by_currency) : [];
  const cards = [
    {
      title: "Payments",
      value: loading ? "—" : String(analytics?.total_payments ?? 0),
      note: "Total payments recorded.",
      href: "/dashboard/payments",
    },
    {
      title: "Success rate",
      value:
        loading || analytics?.success_rate == null
          ? "—"
          : `${(analytics.success_rate * 100).toFixed(1)}%`,
      note: "Share of terminal payments that were captured.",
      href: "/dashboard/analytics",
    },
    {
      title: "Captured volume",
      value: loading
        ? "—"
        : volumeEntries.length === 0
          ? "—"
          : volumeEntries.map(([c, v]) => formatMinorUnits(v, c)).join(", "),
      note: "Sum of captured payments, by currency.",
      href: "/dashboard/analytics",
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        A quick look at your orders, payments, and analytics.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/50"
          >
            <p className="text-sm text-muted">{card.title}</p>
            <p className="mt-2 font-mono text-2xl text-foreground">{card.value}</p>
            <p className="mt-2 text-xs text-muted">{card.note}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/orders"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/50"
        >
          <p className="text-sm font-medium text-foreground">Orders</p>
          <p className="mt-1 text-xs text-muted">Search and filter every order.</p>
        </Link>
        <Link
          href="/dashboard/webhooks"
          className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/50"
        >
          <p className="text-sm font-medium text-foreground">Webhooks</p>
          <p className="mt-1 text-xs text-muted">Recent event deliveries to your endpoint.</p>
        </Link>
      </div>
    </div>
  );
}

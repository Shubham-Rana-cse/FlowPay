"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-client";

type Profile = {
  businessName: string;
  email: string;
  createdAt: string;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    apiFetch<Profile>("/api/merchant/me").then(({ ok, data }) => {
      if (ok) setProfile(data);
    });
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        Account details. Auto-capture, currency, timezone, and your webhook URL now live under{" "}
        <Link href="/dashboard/settings" className="text-accent hover:underline">
          Settings
        </Link>
        .
      </p>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <dt className="text-muted">Business name</dt>
          <dd className="text-foreground">{profile?.businessName ?? "—"}</dd>

          <dt className="text-muted">Email</dt>
          <dd className="text-foreground">{profile?.email ?? "—"}</dd>

          <dt className="text-muted">Member since</dt>
          <dd className="text-foreground">
            {profile ? new Date(profile.createdAt).toLocaleDateString() : "—"}
          </dd>
        </dl>
      </div>
    </div>
  );
}

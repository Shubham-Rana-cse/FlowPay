"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/app/lib/api-client";

export default function RegisterPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { ok, data } = await apiFetch<{ error?: { message: string } }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ businessName, email, password }),
      }
    );

    setLoading(false);

    if (!ok) {
      setError(data.error?.message ?? "Something went wrong. Try again.");
      return;
    }

    router.push("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-xs tracking-widest text-muted uppercase">
            FlowPay
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Create your merchant account
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-border bg-surface p-6 space-y-4"
        >
          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="businessName" className="block text-sm text-muted">
              Business name
            </label>
            <input
              id="businessName"
              type="text"
              required
              minLength={2}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm text-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            <p className="text-xs text-muted">At least 8 characters.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Already registered?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

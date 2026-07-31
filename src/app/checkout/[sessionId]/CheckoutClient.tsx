"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Branding note: the design doc that specced this phase called the hosted
 * checkout "PayFlow". The product actually built across Phases 1-7 (this
 * dashboard, the metadata title, TasteBud's `FLOWPAY_*` env vars, the
 * "Secured by FlowPay" badge already on TasteBud's own PaymentPage) is
 * named FlowPay throughout. Rather than ship a portfolio project with two
 * different brand names for the same product, this page uses "FlowPay
 * Checkout" — everything below is a single `BRAND` constant, so renaming
 * to "PayFlow" later is a one-line change, not a find-and-replace.
 */
const BRAND = "FlowPay";

type PublicPayment = {
  id: string;
  status: string;
  provider: string | null;
  error_code: string | null;
} | null;

type PublicSession = {
  id: string;
  status: "OPEN" | "COMPLETED" | "FAILED" | "EXPIRED";
  amount: number;
  currency: string;
  payment_id: string | null;
  provider_chosen: string | null;
  payment_method: string | null;
  attempt_count: number;
  expires_at: string;
  return_url: string;
  merchant_name: string;
  order_reference: string | null;
  payment: PublicPayment;
};

const RESOLVING_PAYMENT_STATUSES = new Set(["CREATED", "PENDING", "AUTHORIZED", "TIMEOUT", "RETRY"]);
// TIMEOUT/RETRY are resolved by FlowPay's own background cron poller (Phase
// 6), which backs off from 1 minute up to 60 minutes between attempts —
// genuinely up to ~111 minutes worst case across all 5 cross-request
// retries. A customer cannot be made to sit on this page for that; after
// LONG_WAIT_THRESHOLD_MS the UI stops implying "any second now" and gives an
// honest "this can take a while, we'll keep working on it" escape hatch.
const LONG_WAIT_STATUSES = new Set(["TIMEOUT", "RETRY"]);
const LONG_WAIT_THRESHOLD_MS = 15_000;
const POLL_INTERVAL_MS = 2500;
const REDIRECT_COUNTDOWN_SECONDS = 3;

function formatAmount(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

function buildReturnUrl(returnUrl: string, session: PublicSession): string {
  try {
    const url = new URL(returnUrl);
    url.searchParams.set("session_id", session.id);
    url.searchParams.set("status", session.status);
    if (session.payment_id) url.searchParams.set("payment_id", session.payment_id);
    if (session.payment?.status) url.searchParams.set("payment_status", session.payment.status);
    return url.toString();
  } catch {
    return returnUrl;
  }
}

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

const METHODS: { id: "card" | "upi" | "netbanking"; label: string }[] = [
  { id: "card", label: "Card" },
  { id: "upi", label: "UPI" },
  { id: "netbanking", label: "Net Banking" },
];

export default function CheckoutClient({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: PublicSession;
}) {
  const [session, setSession] = useState<PublicSession>(initial);
  const [method, setMethod] = useState<"card" | "upi" | "netbanking">(
    (initial.payment_method as "card" | "upi" | "netbanking") ?? "card"
  );
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REDIRECT_COUNTDOWN_SECONDS);

  // Cosmetic-only card fields — never sent anywhere. See the note in the
  // card panel below for why: sending raw PAN data to our own server would
  // put FlowPay itself in PCI DSS scope, which the Phase 8 design
  // explicitly rejected in favor of "FlowPay owns checkout UX, the actual
  // card data never has to leave the browser meaningfully because Mock
  // Bank/Stripe/Razorpay resolve the attempt from the Order/Payment
  // record alone, not from a card number."
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectedRef = useRef(false);

  const paymentStatus = session.payment?.status ?? null;
  const isResolving = paymentStatus !== null && RESOLVING_PAYMENT_STATUSES.has(paymentStatus);
  const isLongWaitStatus = paymentStatus !== null && LONG_WAIT_STATUSES.has(paymentStatus);

  const refresh = useCallback(async () => {
    const updated = await apiCall<PublicSession>(`/api/public/checkout/${sessionId}`);
    setSession(updated);
  }, [sessionId]);

  // Tracks when we entered a long-wait status (TIMEOUT/RETRY) and, once
  // LONG_WAIT_THRESHOLD_MS has genuinely elapsed since then, flips the UI
  // into "this is taking a while" mode. Both `Date.now()` calls below are
  // deliberately inside a timer callback (never in the render body or
  // synchronously in an effect's own execution) — this project's ESLint
  // rules require impure calls and setState to happen from an external
  // subscription's callback, not directly during render or an effect body.
  const [longWaitSince, setLongWaitSince] = useState<number | null>(null);
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    if (!isLongWaitStatus) {
      const id = setTimeout(() => {
        setLongWaitSince(null);
        setLongWait(false);
      }, 0);
      return () => clearTimeout(id);
    }
    const startId = setTimeout(() => setLongWaitSince(Date.now()), 0);
    return () => clearTimeout(startId);
  }, [isLongWaitStatus]);

  useEffect(() => {
    if (longWaitSince === null) return undefined;
    const id = setInterval(() => {
      if (Date.now() - longWaitSince >= LONG_WAIT_THRESHOLD_MS) setLongWait(true);
    }, 1000);
    return () => clearInterval(id);
  }, [longWaitSince]);

  // Poll while a payment attempt is still resolving. Once we've decided
  // this is a long wait (Phase 6's cron poller territory, potentially many
  // minutes between attempts), back off to a slower cadence — there's no
  // benefit to hammering the API every 2.5s for something that may not
  // change again for minutes, and the customer has an explicit escape
  // hatch below instead of a spinner implying imminent resolution.
  useEffect(() => {
    if (!isResolving) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const interval = longWait ? 8000 : POLL_INTERVAL_MS;
    pollRef.current = setInterval(() => {
      refresh().catch(() => {});
    }, interval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isResolving, longWait, refresh]);

  // Auto-redirect back to the merchant once the session reaches a terminal
  // state, with a short, visible countdown and a manual "Continue now"
  // escape hatch rather than an instant, disorienting redirect.
  useEffect(() => {
    if (session.status !== "COMPLETED" && session.status !== "FAILED") return;
    if (redirectedRef.current) return;

    setCountdown(REDIRECT_COUNTDOWN_SECONDS);
    const tick = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    const timeout = setTimeout(() => {
      redirectedRef.current = true;
      window.location.href = buildReturnUrl(session.return_url, session);
    }, REDIRECT_COUNTDOWN_SECONDS * 1000);

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [session.status, session.return_url, session]);

  async function handlePay() {
    setSubmitting(true);
    setActionError(null);
    try {
      const updated = await apiCall<PublicSession>(`/api/public/checkout/${sessionId}/pay`, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      setSession(updated);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    setSubmitting(true);
    setActionError(null);
    try {
      const updated = await apiCall<PublicSession>(`/api/public/checkout/${sessionId}/retry`, {
        method: "POST",
      });
      setSession(updated);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function continueNow() {
    redirectedRef.current = true;
    window.location.href = buildReturnUrl(session.return_url, session);
  }

  function leaveWhileResolving() {
    // Not a "cancel" — the session stays OPEN and FlowPay's Phase 6 poller
    // keeps working on it server-side regardless of whether anyone's
    // watching this page. This just stops making the customer wait.
    redirectedRef.current = true;
    window.location.href = buildReturnUrl(session.return_url, session);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
            F
          </span>
          <p className="font-mono text-sm tracking-widest text-foreground uppercase">{BRAND}</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {/* Order summary header — every state shows this */}
          <div className="border-b border-border bg-surface-raised px-6 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Merchant</span>
              <span className="font-medium text-foreground">{session.merchant_name}</span>
            </div>
            {session.order_reference && (
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted">Order</span>
                <span className="font-mono text-xs text-muted">{session.order_reference}</span>
              </div>
            )}
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-sm text-muted">Amount</span>
              <span className="text-2xl font-semibold text-foreground">
                {formatAmount(session.amount, session.currency)}
              </span>
            </div>
          </div>

          <div className="px-6 py-6">
            {session.status === "EXPIRED" && (
              <div className="space-y-4 text-center">
                <p className="text-warning text-sm">This checkout session has expired.</p>
                <p className="text-xs text-muted">
                  Return to {session.merchant_name} to start a new checkout.
                </p>
                <a
                  href={session.return_url}
                  className="inline-block rounded-md border border-border px-4 py-2 text-sm text-foreground hover:border-accent"
                >
                  Return to {session.merchant_name}
                </a>
              </div>
            )}

            {session.status === "COMPLETED" && (
              <div className="space-y-3 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
                  <CheckIcon />
                </span>
                <p className="text-base font-semibold text-foreground">Payment successful</p>
                <p className="text-xs text-muted">
                  Redirecting to {session.merchant_name} in {countdown}s…
                </p>
                <button
                  onClick={continueNow}
                  className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
                >
                  Continue now
                </button>
              </div>
            )}

            {session.status === "FAILED" && (
              <div className="space-y-4">
                <div className="text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger/15 text-danger">
                    <XIcon />
                  </span>
                  <p className="mt-3 text-base font-semibold text-foreground">Payment failed</p>
                  <p className="mt-1 text-xs text-muted">
                    {session.payment?.error_code
                      ? `Reason: ${session.payment.error_code}`
                      : "Your bank declined this payment."}
                  </p>
                </div>
                {actionError && <p className="text-center text-xs text-danger">{actionError}</p>}
                <button
                  onClick={handleRetry}
                  disabled={submitting}
                  className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Retrying…" : "Try again"}
                </button>
                <button
                  onClick={continueNow}
                  className="w-full text-center text-xs text-muted hover:text-foreground"
                >
                  Cancel and return to {session.merchant_name}
                </button>
                <p className="text-center text-[11px] text-muted">
                  Redirecting automatically in {countdown}s if you don&apos;t retry…
                </p>
              </div>
            )}

            {session.status === "OPEN" && isResolving && !longWait && (
              <div className="space-y-3 text-center">
                <Spinner />
                <p className="text-sm font-medium text-foreground">Processing your payment…</p>
                <p className="text-xs text-muted">
                  {paymentStatus === "TIMEOUT" || paymentStatus === "RETRY"
                    ? "Your bank is taking a little longer than usual. This page updates itself automatically."
                    : "Talking to your bank — this usually takes a few seconds."}
                </p>
              </div>
            )}

            {session.status === "OPEN" && isResolving && longWait && (
              <div className="space-y-4 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/15 text-warning">
                  <Clock24Icon />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Still confirming with your bank</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    This is taking longer than usual — your bank hasn&apos;t confirmed the payment yet.
                    This can occasionally take several minutes. You don&apos;t need to keep this page open:
                    we&apos;ll keep checking in the background and notify {session.merchant_name} the moment
                    it resolves.
                  </p>
                </div>
                <button
                  onClick={leaveWhileResolving}
                  className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
                >
                  Return to {session.merchant_name}
                </button>
                <p className="text-[11px] text-muted">This page will keep updating on its own if you stay.</p>
              </div>
            )}

            {session.status === "OPEN" && !isResolving && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-2">
                  {METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        method === m.id
                          ? "border-accent bg-accent/10 text-foreground"
                          : "border-border text-muted hover:border-accent/50"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {method === "card" && (
                  <div className="space-y-3">
                    <Field label="Card number">
                      <input
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="4242 4242 4242 4242"
                        maxLength={19}
                        className={inputClass}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Expiry">
                        <input
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          placeholder="MM/YY"
                          maxLength={5}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="CVV">
                        <input
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          placeholder="123"
                          maxLength={4}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Field label="Name on card">
                      <input
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="A. Merchant"
                        className={inputClass}
                      />
                    </Field>
                    <p className="text-[11px] leading-relaxed text-muted">
                      Demo checkout: card details are never sent to {BRAND} or the merchant — they
                      exist only in this form. The payment result below comes from{" "}
                      {BRAND}&apos;s routing engine and provider adapters, exactly like a real
                      transaction would resolve.
                    </p>
                  </div>
                )}

                {method === "upi" && (
                  <div className="space-y-3">
                    <Field label="UPI ID">
                      <input placeholder="name@bank" className={inputClass} disabled />
                    </Field>
                    <p className="text-[11px] leading-relaxed text-muted">
                      Demo checkout: no UPI app hand-off happens here — pressing Pay resolves the
                      payment through {BRAND}&apos;s existing provider routing, the same as Card.
                    </p>
                  </div>
                )}

                {method === "netbanking" && (
                  <div className="space-y-3">
                    <Field label="Bank">
                      <select className={inputClass} disabled>
                        <option>Select your bank</option>
                      </select>
                    </Field>
                    <p className="text-[11px] leading-relaxed text-muted">
                      Demo checkout: no bank login redirect happens here — pressing Pay resolves the
                      payment through {BRAND}&apos;s existing provider routing, the same as Card.
                    </p>
                  </div>
                )}

                {actionError && <p className="text-xs text-danger">{actionError}</p>}

                <button
                  onClick={handlePay}
                  disabled={submitting}
                  className="w-full rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Processing…" : `Pay ${formatAmount(session.amount, session.currency)}`}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
          <LockIcon /> Payments secured and routed by {BRAND}
        </p>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function Spinner() {
  return (
    <svg
      className="mx-auto h-8 w-8 animate-spin text-accent"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="11" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Clock24Icon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Stripe Adapter (Phase 7, FR20).
 *
 * Implements the same `ProviderAdapter` contract Mock Bank (Phase 3) does —
 * zero changes to `payment-service.ts`, the state machine, or the retry/
 * routing logic were needed to add this provider (Phase 0 §6's whole point).
 *
 * ## What's real vs. simulated
 *
 * If `STRIPE_SECRET_KEY` (a Stripe **Test Mode** secret key, `sk_test_...`)
 * is configured, every `success`/`failure` outcome below is a genuine call
 * to Stripe's real Test Mode API (`api.stripe.com`), using Stripe's own
 * documented test PaymentMethod tokens (`pm_card_visa` for a successful
 * charge, `pm_card_chargeDeclined` for a hard decline) — these are real,
 * Stripe-provided, server-callable test tokens designed for exactly this
 * kind of headless integration testing, so no checkout UI is needed. Any
 * successful/declined PaymentIntent this creates is visible in the
 * merchant's real Stripe Test Mode dashboard.
 *
 * `timeout` and `network_error` outcomes are **always simulated locally**
 * (never a real network call) — there's no supported way to make Stripe's
 * API reliably reproduce a network-layer failure on demand, and simulating
 * those two scenarios keeps behavior deterministic for tests either way.
 *
 * With no `STRIPE_SECRET_KEY` configured, the adapter never calls the
 * network at all and returns the same deterministic, amount-bucket outcome
 * every scenario would have produced (see `scenario-buckets.ts`) — the
 * system stays fully testable with zero external accounts, exactly like
 * Mock Bank.
 */
import type { AttemptResult, ProviderAdapter, ProviderPaymentInput } from "../provider-adapter.interface";
import { stripeScenarioForAmount, TRANSIENT_PROVIDER_STATUSES } from "../scenario-buckets";

export { TRANSIENT_PROVIDER_STATUSES as TRANSIENT_STRIPE_STATUSES };

const STRIPE_API = "https://api.stripe.com/v1";
const REQUEST_TIMEOUT_MS = 8000;

// Stripe's own published server-callable test PaymentMethod tokens
// (docs.stripe.com/testing#cards) — real tokens, not something invented
// here. `off_session: true` + `confirm: true` lets a headless server
// confirm a charge with no customer-facing checkout step.
const TEST_PAYMENT_METHOD = {
  success: "pm_card_visa",
  decline: "pm_card_chargeDeclined",
} as const;

function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function authHeader(): string {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

type StripeCallOutcome = { ok: true; json: Record<string, unknown> } | { ok: false; networkFailure: "timeout" | "network_error" } | { ok: false; declined: Record<string, unknown> };

async function stripeCall(
  path: string,
  method: "GET" | "POST",
  params?: Record<string, string>
): Promise<StripeCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = method === "GET" && params
      ? `${STRIPE_API}${path}?${new URLSearchParams(params).toString()}`
      : `${STRIPE_API}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: method === "POST" && params ? new URLSearchParams(params).toString() : undefined,
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      // A card decline surfaces as a 402 with an `error` object — that's a
      // legitimate business outcome, not a provider-layer failure.
      return { ok: false, declined: json };
    }
    return { ok: true, json };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { ok: false, networkFailure: timedOut ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function simulatedResult(
  scenario: ReturnType<typeof stripeScenarioForAmount>,
  providerRefPrefix: string
): AttemptResult {
  switch (scenario) {
    case "success":
      return { success: true, status: "authorized", providerRef: `${providerRefPrefix}_${cryptoRandomId()}` };
    case "failure":
      return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED" };
    case "timeout":
      return { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" };
    case "network_error":
      return { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    default:
      return { success: false, status: "failed", errorCode: "UNKNOWN" };
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

export class StripeAdapter implements ProviderAdapter {
  async authorize(payment: ProviderPaymentInput): Promise<AttemptResult> {
    const scenario = stripeScenarioForAmount(payment.amount);
    console.log("Stripe configured:", stripeConfigured());
console.log("Scenario:", scenario);

    // Timeout/network-error scenarios are always simulated (see doc comment)
    // and no config, or no key at all, means fully simulated too.
    if (!stripeConfigured() || scenario === "timeout" || scenario === "network_error") {
      return simulatedResult(scenario, "stripe_sim");
    }

    const paymentMethod = scenario === "success" ? TEST_PAYMENT_METHOD.success : TEST_PAYMENT_METHOD.decline;

    console.log("Calling Stripe API...");

    const outcome = await stripeCall("/payment_intents", "POST", {
      amount: String(payment.amount),
      currency: payment.currency.toLowerCase(),
      payment_method: paymentMethod,
      confirm: "true",
      capture_method: "manual",
      "payment_method_types[]": "card",
      off_session: "true",
    });

    console.log(outcome);

    if (!outcome.ok && "networkFailure" in outcome) {
      return outcome.networkFailure === "timeout"
        ? { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" }
        : { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }

    if (!outcome.ok && "declined" in outcome) {
      const error = (outcome.declined.error ?? {}) as Record<string, unknown>;
      const intent = (error.payment_intent ?? {}) as Record<string, unknown>;
      return {
        success: false,
        status: "failed",
        errorCode: String(error.decline_code ?? error.code ?? "PROVIDER_DECLINED").toUpperCase(),
        providerRef: (intent.id as string) ?? undefined,
        raw: outcome.declined,
      };
    }

    const intent = (outcome as { ok: true; json: Record<string, unknown> }).json;
    const status = String(intent.status);

    if (status === "requires_capture" || status === "succeeded") {
      return { success: true, status: "authorized", providerRef: String(intent.id), raw: intent };
    }

    return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED", providerRef: String(intent.id ?? ""), raw: intent };
  }

  async capture(_payment: ProviderPaymentInput, providerRef: string): Promise<AttemptResult> {
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }

    // A simulated authorize() never hit Stripe, so its providerRef won't
    // resolve to a real PaymentIntent — capture the same way, locally.
    if (!stripeConfigured() || !providerRef.startsWith("pi_")) {
      return { success: true, status: "captured", providerRef };
    }

    const outcome = await stripeCall(`/payment_intents/${providerRef}/capture`, "POST");

    if (!outcome.ok && "networkFailure" in outcome) {
      return outcome.networkFailure === "timeout"
        ? { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" }
        : { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }
    if (!outcome.ok && "declined" in outcome) {
      const error = (outcome.declined.error ?? {}) as Record<string, unknown>;
      return { success: false, status: "failed", errorCode: String(error.code ?? "CAPTURE_FAILED").toUpperCase() };
    }

    const intent = (outcome as { ok: true; json: Record<string, unknown> }).json;
    return { success: true, status: "captured", providerRef: String(intent.id ?? providerRef), raw: intent };
  }

  async refund(_payment: ProviderPaymentInput, amount: number, providerRef: string): Promise<AttemptResult> {
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }

    if (!stripeConfigured() || !providerRef.startsWith("pi_")) {
      return { success: true, status: "refunded", providerRef };
    }

    const outcome = await stripeCall("/refunds", "POST", {
      payment_intent: providerRef,
      amount: String(amount),
    });

    if (!outcome.ok && "networkFailure" in outcome) {
      return outcome.networkFailure === "timeout"
        ? { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" }
        : { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }
    if (!outcome.ok && "declined" in outcome) {
      const error = (outcome.declined.error ?? {}) as Record<string, unknown>;
      return { success: false, status: "failed", errorCode: String(error.code ?? "REFUND_FAILED").toUpperCase() };
    }

    const refund = (outcome as { ok: true; json: Record<string, unknown> }).json;
    return { success: true, status: "refunded", providerRef: String(refund.id ?? providerRef), raw: refund };
  }

  async checkStatus(providerRef: string): Promise<AttemptResult> {
    if (!stripeConfigured() || !providerRef || !providerRef.startsWith("pi_")) {
      // Same uncertain-outcome simulation shape Mock Bank's checkStatus
      // uses for Phase 6's poller: a transient failure earlier didn't get a
      // definitive answer, so this asks "what really happened" rather than
      // blindly re-authorizing.
      const roll = Math.random();
      if (roll < 0.75) return { success: true, status: "authorized", providerRef: providerRef || `stripe_sim_${cryptoRandomId()}` };
      if (roll < 0.9) {
        const timeout = Math.random() < 0.5;
        return { success: false, status: timeout ? "timeout" : "network_error", errorCode: timeout ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR" };
      }
      return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED" };
    }

    const outcome = await stripeCall(`/payment_intents/${providerRef}`, "GET");

    if (!outcome.ok && "networkFailure" in outcome) {
      return outcome.networkFailure === "timeout"
        ? { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" }
        : { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }
    if (!outcome.ok) {
      return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED" };
    }

    const intent = (outcome as { ok: true; json: Record<string, unknown> }).json;
    const status = String(intent.status);
    if (status === "requires_capture" || status === "succeeded") {
      return { success: true, status: "authorized", providerRef: String(intent.id), raw: intent };
    }
    return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED", raw: intent };
  }
}

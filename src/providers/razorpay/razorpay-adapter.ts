/**
 * Razorpay Adapter (Phase 7, FR20).
 *
 * Same `ProviderAdapter` contract as Mock Bank/Stripe — purely additive,
 * zero changes needed anywhere else in the codebase.
 *
 * ## What's real vs. simulated (read this before assuming parity with Stripe)
 *
 * Razorpay's public REST API is genuinely server-callable for **creating an
 * Order** (`POST /v1/orders`) — when `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`
 * (Test Mode keys) are configured, `authorize()` really calls this endpoint,
 * and the Order is visible in the merchant's real Razorpay Test Mode
 * dashboard. Unlike Stripe, though, Razorpay has **no server-callable test
 * token that completes an actual card charge without their hosted
 * Checkout** — collecting a real `payment` entity requires a browser
 * redirecting through Razorpay Checkout.js, which this headless
 * orchestrator doesn't have. That's a genuine constraint of Razorpay's
 * platform, not a shortcut taken here.
 *
 * So: Order creation is real when keys are configured; the "did the
 * customer's card go through" outcome that would normally come from
 * Checkout is simulated via the same deterministic amount-bucket
 * convention Mock Bank/Stripe use (see `scenario-buckets.ts`), scoped to
 * Razorpay's own (deliberately weaker) success-rate table so
 * HighestSuccessRateStrategy has a real signal to route around in demos.
 * `capture`/`refund`/`checkStatus` all operate on that same simulated
 * outcome, since a real capture/refund call needs a genuine `payment_id`
 * this flow never produces. A production integration would swap the
 * simulated half for Razorpay Checkout + webhooks — nothing about the
 * `ProviderAdapter` contract would need to change to do that.
 *
 * With no keys configured, the adapter never touches the network at all.
 */
import type { AttemptResult, ProviderAdapter, ProviderPaymentInput } from "../provider-adapter.interface";
import { razorpayScenarioForAmount, TRANSIENT_PROVIDER_STATUSES } from "../scenario-buckets";

export { TRANSIENT_PROVIDER_STATUSES as TRANSIENT_RAZORPAY_STATUSES };

const RAZORPAY_API = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 8000;

function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID ?? "";
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

type RazorpayCallOutcome =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; networkFailure: "timeout" | "network_error" }
  | { ok: false; apiError: Record<string, unknown> };

async function razorpayCall(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<RazorpayCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, apiError: json };
    return { ok: true, json };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { ok: false, networkFailure: timedOut ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function simulatedOutcome(
  scenario: ReturnType<typeof razorpayScenarioForAmount>,
  providerRefPrefix: string
): AttemptResult {
  switch (scenario) {
    case "success":
      return { success: true, status: "authorized", providerRef: `${providerRefPrefix}_${randomId()}` };
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

export class RazorpayAdapter implements ProviderAdapter {
  async authorize(payment: ProviderPaymentInput): Promise<AttemptResult> {
    //console.log("========== USING RAZORPAY ADAPTER ==========");
    const scenario = razorpayScenarioForAmount(payment.amount);

    /* console.log(process.env.RAZORPAY_KEY_ID);
    console.log(process.env.RAZORPAY_KEY_SECRET ? "SECRET FOUND" : "SECRET MISSING"); */

    if (!razorpayConfigured()) {
      return simulatedOutcome(scenario, "razorpay_sim");
    }

    // Real Order creation — this part genuinely hits Razorpay's Test Mode
    // API regardless of the simulated scenario below (see doc comment).
    const outcome = await razorpayCall("/orders", "POST", {
      amount: payment.amount,
      currency: payment.currency.toUpperCase(),
      receipt: payment.id,
      payment_capture: 1,
    });

    /* console.log("Razorpay Configured:", razorpayConfigured());
    console.log("Razorpay Response:", JSON.stringify(outcome, null, 2)); */

    if (!outcome.ok && "networkFailure" in outcome) {
      return outcome.networkFailure === "timeout"
        ? { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT" }
        : { success: false, status: "network_error", errorCode: "NETWORK_ERROR" };
    }

    if (!outcome.ok && "apiError" in outcome) {
      const error = (outcome.apiError.error ?? {}) as Record<string, unknown>;
      return {
        success: false,
        status: "failed",
        errorCode: String(error.code ?? "PROVIDER_DECLINED").toUpperCase(),
        raw: outcome.apiError,
      };
    }

    const order = (outcome as { ok: true; json: Record<string, unknown> }).json;
    const orderId = String(order.id ?? `order_${randomId()}`);

    // The Order exists for real now; whether the customer's card actually
    // went through is simulated (see doc comment) — encode the real
    // order id into the simulated providerRef so it's traceable back to
    // the real Razorpay dashboard even on a simulated decline.
    if (scenario === "success") {
      return { success: true, status: "authorized", providerRef: orderId, raw: order };
    }
    if (scenario === "failure") {
      return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED", providerRef: orderId, raw: order };
    }
    if (scenario === "timeout") {
      return { success: false, status: "timeout", errorCode: "PROVIDER_TIMEOUT", providerRef: orderId };
    }
    return { success: false, status: "network_error", errorCode: "NETWORK_ERROR", providerRef: orderId };
  }

  async capture(_payment: ProviderPaymentInput, providerRef: string): Promise<AttemptResult> {
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }
    // No genuine payment_id exists in this headless flow (see doc comment)
    // — capture is simulated the same way regardless of whether the
    // providerRef traces back to a real Razorpay order.
    return { success: true, status: "captured", providerRef };
  }

  async refund(_payment: ProviderPaymentInput, _amount: number, providerRef: string): Promise<AttemptResult> {
    if (!providerRef) {
      return { success: false, status: "failed", errorCode: "MISSING_PROVIDER_REF" };
    }
    return { success: true, status: "refunded", providerRef };
  }

  async checkStatus(providerRef: string): Promise<AttemptResult> {
    // Same uncertain-outcome simulation shape Mock Bank/Stripe use for
    // Phase 6's poller — see their checkStatus doc comments for why this
    // isn't a blind re-authorize.
    const roll = Math.random();
    if (roll < 0.65) {
      return { success: true, status: "authorized", providerRef: providerRef || `razorpay_sim_${randomId()}` };
    }
    if (roll < 0.88) {
      const timeout = Math.random() < 0.5;
      return { success: false, status: timeout ? "timeout" : "network_error", errorCode: timeout ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR" };
    }
    return { success: false, status: "failed", errorCode: "PROVIDER_DECLINED" };
  }
}

/**
 * Checkout Session Service (Phase 8 — Hosted Checkout).
 *
 * A CheckoutSession is a thin, expiring wrapper around an existing Order —
 * PayFlow's own branded page in front of the payment pipeline every earlier
 * phase already built. It deliberately does NOT reimplement anything:
 * creating a Payment still goes through `payment-service.ts`'s
 * `createPayment` (idempotency, state machine, Dynamic Routing Engine,
 * Automatic Failover, ledger, webhooks — all untouched). This service's
 * only job is:
 *   1. mint a session id the customer's browser can use as a bearer token
 *      for the public /checkout/{id} page (no merchant credentials ever
 *      reach the browser),
 *   2. track which Payment attempt(s) came from it, and
 *   3. map the underlying Payment status onto a small, page-friendly
 *      CheckoutSessionStatus (OPEN/COMPLETED/FAILED/EXPIRED).
 *
 * Expiry is checked lazily on read (same "no dedicated poller" choice
 * Phase 0's Order-expiry Open Design Decision made) — there's no cron job
 * for this, a session just stops being usable once `expiresAt` has passed.
 */
import { prisma } from "@/lib/db";
import { CheckoutSessionStatus, PaymentStatus } from "@/constants/status";
import { getOrderForMerchant, OrderNotFoundError, OrderNotPayableError } from "@/core/order/order-service";
import { createPayment, IdempotencyKeyConflictError } from "@/core/payment/payment-service";
import { getMerchantProfile } from "@/core/merchant/merchant-service";
import type { CheckoutSession } from "@/generated/prisma";

export { OrderNotFoundError, OrderNotPayableError };

const DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes

export class CheckoutSessionNotFoundError extends Error {
  constructor() {
    super("Checkout session not found");
    this.name = "CheckoutSessionNotFoundError";
  }
}

export class CheckoutSessionExpiredError extends Error {
  constructor() {
    super("This checkout session has expired");
    this.name = "CheckoutSessionExpiredError";
  }
}

export class CheckoutSessionAlreadyCompletedError extends Error {
  constructor() {
    super("This checkout session has already been paid");
    this.name = "CheckoutSessionAlreadyCompletedError";
  }
}

export class CheckoutSessionNotRetryableError extends Error {
  constructor(currentStatus: string) {
    super(`Checkout session is not in a retryable state (current status: ${currentStatus})`);
    this.name = "CheckoutSessionNotRetryableError";
  }
}

function isExpired(session: CheckoutSession): boolean {
  return session.status === CheckoutSessionStatus.OPEN && session.expiresAt.getTime() < Date.now();
}

/**
 * Lazily flips OPEN -> EXPIRED on read. Every public-facing read/write goes
 * through this first so an elapsed session can never be paid against, even
 * if nothing has proactively marked it EXPIRED yet.
 */
async function loadLiveSession(sessionId: string): Promise<CheckoutSession> {
  const session = await prisma.checkoutSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new CheckoutSessionNotFoundError();

  if (isExpired(session)) {
    return prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { status: CheckoutSessionStatus.EXPIRED },
    });
  }
  return session;
}

function serializeSession(session: CheckoutSession) {
  return {
    id: session.id,
    status: session.status,
    amount: session.amount,
    currency: session.currency,
    payment_id: session.paymentId,
    provider_chosen: session.providerChosen,
    payment_method: session.paymentMethod,
    attempt_count: session.attemptCount,
    expires_at: session.expiresAt.toISOString(),
    return_url: session.returnUrl,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
  };
}

/**
 * Merchant/API-key-authed (Phase 0 §9 "Payment API" category): mints a new
 * session against an Order the requesting merchant already owns. Mirrors
 * `createPayment`'s own Order validation (must exist, must still be
 * CREATED) rather than duplicating it differently.
 */
export async function createCheckoutSession(
  merchantId: string,
  input: { orderId: string; returnUrl: string; expiresInSeconds?: number },
  appOrigin: string
) {
  const order = await getOrderForMerchant(merchantId, input.orderId);
  if (order.status !== "CREATED") {
    throw new OrderNotPayableError(order.status);
  }

  const ttlSeconds = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
  const session = await prisma.checkoutSession.create({
    data: {
      merchantId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      returnUrl: input.returnUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });

  return {
    ...serializeSession(session),
    checkout_url: `${appOrigin}/checkout/${session.id}`,
  };
}

export async function getCheckoutSessionForMerchant(merchantId: string, sessionId: string) {
  const session = await prisma.checkoutSession.findFirst({ where: { id: sessionId, merchantId } });
  if (!session) throw new CheckoutSessionNotFoundError();
  return serializeSession(session);
}

/**
 * Public read (Phase 0 §9-style "Internal/System" sibling, but customer-
 * facing): everything the hosted /checkout/{id} page needs to render the
 * order summary and poll for a result, and nothing a merchant would
 * consider sensitive (no webhookSecret, no API keys, no other orders).
 */
export async function getPublicCheckoutSession(sessionId: string) {
  const session = await loadLiveSession(sessionId);

  const [merchant, order, payment] = await Promise.all([
    getMerchantProfile(session.merchantId),
    prisma.order.findUnique({ where: { id: session.orderId }, select: { reference: true } }),
    session.paymentId
      ? prisma.payment.findUnique({ where: { id: session.paymentId } })
      : Promise.resolve(null),
  ]);

  let errorCode: string | null = null;
  if (payment && (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.TIMEOUT)) {
    const lastAttempt = await prisma.paymentAttempt.findFirst({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "desc" },
    });
    errorCode = lastAttempt?.errorCode ?? null;
  }

  return {
    ...serializeSession(session),
    merchant_name: merchant?.businessName ?? "Merchant",
    order_reference: order?.reference ?? null,
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
          error_code: errorCode,
        }
      : null,
  };
}

function deriveSessionStatus(paymentStatus: PaymentStatus): CheckoutSessionStatus {
  if (paymentStatus === PaymentStatus.CAPTURED) return CheckoutSessionStatus.COMPLETED;
  if (paymentStatus === PaymentStatus.FAILED) return CheckoutSessionStatus.FAILED;
  // AUTHORIZED (auto-capture off), PENDING, TIMEOUT, RETRY, CREATED: the
  // session stays OPEN — the hosted page keeps polling
  // GET /api/public/checkout/{id} the same way TasteBud's own PaymentPage
  // already polls for TIMEOUT/RETRY, per Phase 6.
  return CheckoutSessionStatus.OPEN;
}

async function driveSessionPayment(session: CheckoutSession, method: string) {
  const attemptNumber = session.attemptCount + 1;
  const idempotencyKey = `checkout_${session.id}_attempt_${attemptNumber}`;

  let payment;
  try {
    payment = await createPayment(session.merchantId, { orderId: session.orderId }, idempotencyKey);
  } catch (err) {
    // Idempotency conflicts can't actually happen here — the key is
    // derived from this session's own id/attempt counter, unique per call
    // — but keep the surface honest rather than letting a generic 500 leak
    // out for an error class that's unreachable in practice.
    if (err instanceof IdempotencyKeyConflictError) throw err;
    throw err;
  }

  const updated = await prisma.checkoutSession.update({
    where: { id: session.id },
    data: {
      attemptCount: attemptNumber,
      paymentId: payment.id,
      providerChosen: payment.provider ?? undefined,
      paymentMethod: method,
      status: deriveSessionStatus(payment.status as PaymentStatus),
    },
  });

  return { session: updated, payment };
}

/**
 * First payment attempt from the hosted checkout page. One call per "Pay"
 * click — if the same session/method is submitted twice in a row without
 * the first attempt having failed, this is idempotent from the customer's
 * point of view (returns the current state) rather than creating a second
 * concurrent Payment.
 */
export async function submitCheckoutPayment(sessionId: string, method: string) {
  const session = await loadLiveSession(sessionId);

  if (session.status === CheckoutSessionStatus.COMPLETED) {
    throw new CheckoutSessionAlreadyCompletedError();
  }
  if (session.status === CheckoutSessionStatus.EXPIRED) {
    throw new CheckoutSessionExpiredError();
  }
  if (session.paymentId) {
    // A previous attempt already exists and is either still resolving or
    // failed — resubmitting the same session without going through
    // `retryCheckoutPayment` just returns the current state instead of
    // silently starting a second, concurrent Payment.
    return getPublicCheckoutSession(sessionId);
  }

  await driveSessionPayment(session, method);
  return getPublicCheckoutSession(sessionId);
}

/**
 * FR7-style retry, scoped to a checkout session: only reachable once the
 * previous attempt is a terminal FAILED (or still transient TIMEOUT/RETRY —
 * resubmitting there just asks for a fresh attempt rather than waiting on
 * Phase 6's poller). Not reachable once COMPLETED or EXPIRED.
 */
export async function retryCheckoutPayment(sessionId: string, method?: string) {
  const session = await loadLiveSession(sessionId);

  if (session.status === CheckoutSessionStatus.COMPLETED) {
    throw new CheckoutSessionAlreadyCompletedError();
  }
  if (session.status === CheckoutSessionStatus.EXPIRED) {
    throw new CheckoutSessionExpiredError();
  }
  if (session.status !== CheckoutSessionStatus.FAILED) {
    // OPEN covers two distinct cases neither of which "retry" is the right
    // verb for: no attempt yet (use submitCheckoutPayment) or a previous
    // attempt still resolving (TIMEOUT/RETRY — creating a second concurrent
    // Payment against the same Order while the first is still in flight is
    // exactly what this guard exists to prevent).
    throw new CheckoutSessionNotRetryableError(session.status);
  }

  // Re-check the Order itself is still payable (mirrors payment-service.ts's
  // own guard) — a merchant-side action elsewhere could theoretically have
  // moved it on, though nothing in this project does that today.
  const order = await prisma.order.findUnique({ where: { id: session.orderId } });
  if (!order) throw new OrderNotFoundError();
  if (order.status !== "CREATED") throw new OrderNotPayableError(order.status);

  await driveSessionPayment(session, method ?? session.paymentMethod ?? "card");
  return getPublicCheckoutSession(sessionId);
}

export async function getCheckoutSessionStatus(sessionId: string) {
  return getPublicCheckoutSession(sessionId);
}

export type { CheckoutSession };

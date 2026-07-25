/**
 * Payment Service (Phase 0 §7, FR6, FR9-FR12; Phase 3 wires FR9-FR12 for real).
 *
 * Owns Payment creation, idempotency, and the state machine transitions.
 * A Payment is always created against an existing Order (FR6) and inherits
 * that Order's amount/currency — partial payments are not supported, so
 * there's nothing to reconcile between the two.
 *
 * Phase 3: once a Payment is freshly created (not an idempotent replay),
 * `createPayment` synchronously drives it through routing + authorization +
 * (auto-)capture via `runAuthorizationPipeline`, mirroring Phase 0 §8.1's
 * sequence diagram — the merchant's single POST /payments call gets back a
 * final CAPTURED/FAILED/etc. status, not just CREATED. `capturePayment`
 * exposes the explicit POST /payments/:id/capture endpoint from Phase 0 §9,
 * which matters once MerchantSettings.autoCapture can be turned off (Phase 5).
 */
import { prisma } from "@/lib/db";
import { PaymentStatus, PaymentEventType } from "@/constants/status";
import {
  getOrderForMerchant,
  markOrderPaid,
  OrderNotFoundError,
  OrderNotPayableError,
} from "@/core/order/order-service";
import {
  findExistingPayment,
  isUniqueConstraintViolation,
  IdempotencyKeyConflictError,
} from "./idempotency";
import { assertTransition } from "./state-machine";
import { selectProvider } from "@/core/routing/routing-service";
import { TRANSIENT_MOCK_BANK_STATUSES } from "@/providers/mock-bank/mock-bank-adapter";
import { getMerchantSettings } from "@/core/merchant/merchant-service";
import { appendLedgerEntry } from "@/core/ledger/ledger-service";
import { dispatchWebhookEvent } from "@/core/webhook/webhook-event-service";
import { WebhookEventType } from "@/constants/status";
import { computeNextRetryAt } from "@/core/retry/retry-rules";
import { logger } from "@/lib/logger";
import type { AttemptResult } from "@/providers/provider-adapter.interface";
import type { Payment, Prisma } from "@/generated/prisma";

export { OrderNotFoundError, OrderNotPayableError, IdempotencyKeyConflictError };

export class IdempotencyKeyRequiredError extends Error {
  constructor() {
    super("Idempotency-Key header is required");
    this.name = "IdempotencyKeyRequiredError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Payment not found");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentNotAuthorizedError extends Error {
  constructor(currentStatus: string) {
    super(`Payment must be AUTHORIZED to capture (current status: ${currentStatus})`);
    this.name = "PaymentNotAuthorizedError";
  }
}

// FR12 — retry policy for transient provider failures (timeout / network error).
// This is the bounded, synchronous, same-request retry from Phase 3. The
// polling-based, cross-request retry job (Open Design Decision #1) that
// picks up where this leaves off is retry-service.ts (Phase 6).
const MAX_AUTHORIZE_ATTEMPTS = 3;

function backoffMs(attemptNumber: number): number {
  return 50 * 2 ** (attemptNumber - 1); // 50ms, 100ms, 200ms
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomic, guarded status transition: the WHERE clause only matches if the row
 * is still in the expected `from` state, so a concurrent writer can never
 * clobber another transition (NFR: Consistency / row locking, done here via
 * optimistic compare-and-swap instead of a raw `SELECT ... FOR UPDATE`, since
 * every caller already knows the state it's transitioning from).
 *
 * Exported as of Phase 4 so refund-service.ts and settlement-service.ts reuse
 * the exact same guard rather than re-implementing it.
 */
export async function transitionPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  from: PaymentStatus,
  to: PaymentStatus,
  extra?: Prisma.PaymentUpdateManyMutationInput
): Promise<boolean> {
  assertTransition(from, to);
  const result = await tx.payment.updateMany({
    where: { id: paymentId, status: from },
    data: { status: to, ...extra },
  });
  return result.count === 1;
}

/** Exported as of Phase 4 for the same reason as `transitionPayment` above. */
export function recordEvent(
  tx: Prisma.TransactionClient,
  paymentId: string,
  eventType: PaymentEventType,
  metadata?: Prisma.InputJsonValue
) {
  return tx.paymentEvent.create({ data: { paymentId, eventType, metadata } });
}

function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    order_id: payment.orderId,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    provider: payment.provider,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
    // Phase 6 — only meaningful while status is TIMEOUT/RETRY; null/0 once
    // a payment resolves to AUTHORIZED (or later) or FAILED.
    retry_count: payment.retryCount,
    next_retry_at: payment.nextRetryAt,
  };
}

/**
 * Creates a Payment attempt against an Order (FR6), or returns the existing
 * one if this Idempotency-Key has been used before (FR11). Order lookups
 * are scoped to the requesting merchant so one merchant can never create a
 * Payment against another merchant's Order.
 */
export async function createPayment(
  merchantId: string,
  input: { orderId: string },
  idempotencyKey: string
) {
  if (!idempotencyKey) {
    throw new IdempotencyKeyRequiredError();
  }

  const existing = await findExistingPayment(merchantId, idempotencyKey);
  if (existing) {
    if (existing.orderId !== input.orderId) {
      throw new IdempotencyKeyConflictError();
    }
    return serializePayment(existing);
  }

  const order = await getOrderForMerchant(merchantId, input.orderId);
  if (order.status !== "CREATED") {
    throw new OrderNotPayableError(order.status);
  }

  try {
    const payment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.payment.create({
        data: {
          orderId: order.id,
          merchantId,
          idempotencyKey,
          amount: order.amount,
          currency: order.currency,
          status: PaymentStatus.CREATED,
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: created.id,
          eventType: PaymentEventType.CREATED,
          metadata: { orderId: order.id, idempotencyKey },
        },
      });

      return created;
    });

    // Only the request that actually created the row drives it through
    // routing/authorization/capture — idempotent replays and the raced
    // branch below just return whatever state the original request left
    // behind (poll GET /payments/:id if it's still mid-flight).
    const finalState = await runAuthorizationPipeline(payment.id, merchantId);
    return serializePayment(finalState ?? payment);
  } catch (err) {
    // Two concurrent requests with the same key both passed the check above;
    // the DB's unique constraint is the real source of truth here (FR11).
    if (isUniqueConstraintViolation(err)) {
      const raced = await findExistingPayment(merchantId, idempotencyKey);
      if (raced) return serializePayment(raced);
    }
    throw err;
  }
}

/**
 * Phase 3 — drives a freshly-created Payment through routing, authorization,
 * and (if the merchant auto-captures) capture. Runs entirely inside
 * `createPayment`'s caller, synchronously, per Phase 0 §8.1 — the provider
 * round-trip is deliberately excluded from the "payment creation P95 < 300ms"
 * NFR budget, not from the response itself.
 *
 * Never throws: any unexpected error here is logged and swallowed so a
 * provider hiccup can't turn into a 500 for a Payment that was already
 * successfully created — the merchant can always recover via GET
 * /payments/:id or POST /payments/:id/capture.
 */
async function runAuthorizationPipeline(
  paymentId: string,
  merchantId: string
): Promise<Payment | null> {
  try {
    await prisma.$transaction(async (tx) => {
      const moved = await transitionPayment(tx, paymentId, PaymentStatus.CREATED, PaymentStatus.PENDING);
      if (moved) await recordEvent(tx, paymentId, PaymentEventType.VALIDATED);
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const { providerName, adapter } = selectProvider({
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
    });

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { provider: providerName } });
      await recordEvent(tx, paymentId, PaymentEventType.PROVIDER_SELECTED, { provider: providerName });
    });

    let attemptNumber = 0;
    let result: AttemptResult;

    do {
      attemptNumber += 1;
      await prisma.paymentEvent.create({
        data: {
          paymentId,
          eventType: PaymentEventType.AUTHORIZATION_STARTED,
          metadata: { attemptNumber, provider: providerName },
        },
      });

      result = await adapter.authorize({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
      });

      await prisma.paymentAttempt.create({
        data: {
          paymentId,
          provider: providerName,
          status: result.status,
          attemptNumber,
          providerRef: result.providerRef,
          errorCode: result.errorCode,
        },
      });

      if (result.success) break;
      const transient = TRANSIENT_MOCK_BANK_STATUSES.has(result.status);
      if (!transient || attemptNumber >= MAX_AUTHORIZE_ATTEMPTS) break;
      await sleep(backoffMs(attemptNumber));
    } while (true);

    if (result.success) {
      await prisma.$transaction(async (tx) => {
        await transitionPayment(tx, paymentId, PaymentStatus.PENDING, PaymentStatus.AUTHORIZED);
        await recordEvent(tx, paymentId, PaymentEventType.AUTHORIZATION_SUCCESS, {
          provider: providerName,
          providerRef: result.providerRef,
          attempts: attemptNumber,
        });
      });

      const settings = await getMerchantSettings(merchantId);
      const autoCapture = settings?.autoCapture ?? true; // FR4a default

      if (autoCapture) {
        await performCapture(paymentId, providerName, result.providerRef);
      }
    } else {
      // Map the terminal provider outcome onto a Payment status. Hard
      // declines (insufficient funds / generic failure) are FAILED right
      // away — the Order stays open (Phase 0 §7 note) so the merchant can
      // create a new Payment (FR7). Exhausted transient failures are left
      // in TIMEOUT or RETRY instead of FAILED: Phase 6's polling job is the
      // thing that gets to decide those are finally dead.
      const finalStatus: PaymentStatus =
        result.status === "timeout"
          ? PaymentStatus.TIMEOUT
          : result.status === "network_error"
            ? PaymentStatus.RETRY
            : PaymentStatus.FAILED;

      // Phase 6 — a transient outcome (TIMEOUT/RETRY) gets `nextRetryAt`
      // seeded here so retry-service.ts's poller can pick it up later;
      // retryCount starts at 0 since no cross-request retry has happened
      // yet (Phase 3's in-request attempts above are a separate counter,
      // never persisted). A hard decline (FAILED) gets neither — it's
      // already terminal, nothing left to schedule.
      const isTransientOutcome =
        finalStatus === PaymentStatus.TIMEOUT || finalStatus === PaymentStatus.RETRY;

      await prisma.$transaction(async (tx) => {
        await transitionPayment(
          tx,
          paymentId,
          PaymentStatus.PENDING,
          finalStatus,
          isTransientOutcome ? { retryCount: 0, nextRetryAt: computeNextRetryAt(0) } : undefined
        );
        await recordEvent(tx, paymentId, PaymentEventType.FAILED, {
          stage: "authorization",
          provider: providerName,
          errorCode: result.errorCode,
          attempts: attemptNumber,
        });
      });

      // FR15 — only dispatch on a genuinely terminal hard decline. TIMEOUT
      // and RETRY aren't "failed" yet from the merchant's point of view:
      // Phase 6's polling job (retry-service.ts) is what eventually
      // resolves those to a final state, and that's where their webhook
      // dispatch belongs too.
      if (finalStatus === PaymentStatus.FAILED) {
        await dispatchWebhookEvent(merchantId, WebhookEventType.PAYMENT_FAILED, {
          payment_id: paymentId,
          order_id: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          error_code: result.errorCode ?? null,
        });
      }
    }

    return prisma.payment.findUnique({ where: { id: paymentId } });
  } catch (err) {
    logger.error("Authorization pipeline failed unexpectedly", {
      paymentId,
      error: (err as Error).message,
    });
    return prisma.payment.findUnique({ where: { id: paymentId } });
  }
}

/**
 * AUTHORIZED -> CAPTURED (FR8, Phase 0 §7). Shared by the auto-capture path
 * inside `runAuthorizationPipeline` and the explicit `capturePayment` below,
 * so both routes to CAPTURED behave identically. Exported as of Phase 6 so
 * retry-service.ts's poller can drive a payment it just resolved to
 * AUTHORIZED through auto-capture the exact same way.
 */
export async function performCapture(
  paymentId: string,
  providerName: string,
  providerRef: string | undefined
): Promise<void> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const { adapter } = selectProvider({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
  });

  const result = await adapter.capture(
    { id: payment.id, amount: payment.amount, currency: payment.currency },
    providerRef ?? ""
  );

  await prisma.paymentAttempt.create({
    data: {
      paymentId,
      provider: providerName,
      status: result.status,
      // Capture is attempt #1 of its own lifecycle stage; PaymentAttempt
      // rows are scoped per-call, not shared across authorize/capture, so
      // this never collides with the authorize attempts recorded above.
      attemptNumber: 1,
      providerRef: result.providerRef ?? providerRef,
      errorCode: result.errorCode,
    },
  });

  if (!result.success) {
    // Leave the Payment AUTHORIZED — capture can be retried later via
    // POST /payments/:id/capture instead of losing the authorization.
    await recordEvent(prisma, paymentId, PaymentEventType.FAILED, {
      stage: "capture",
      provider: providerName,
      errorCode: result.errorCode,
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await transitionPayment(tx, paymentId, PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED);
    await recordEvent(tx, paymentId, PaymentEventType.CAPTURED, {
      provider: providerName,
      providerRef: result.providerRef ?? providerRef,
    });
    // FR14 money-movement half (Phase 4) — the guarded transitionPayment
    // call above has already taken the row lock this ledger write needs to
    // be race-free; see ledger-service.ts's appendLedgerEntry doc comment.
    await appendLedgerEntry(tx, paymentId, "credit", payment.amount);
    await markOrderPaid(payment.orderId, tx);
  });

  // FR15 — dispatched after the transaction commits, never inside it: this
  // is a network call to a third party, and holding a DB transaction open
  // across one turns a slow merchant endpoint into a lock held on the
  // Payment row. Covers both the auto-capture path and the explicit
  // POST /payments/:id/capture path, since both go through this function.
  await dispatchWebhookEvent(payment.merchantId, WebhookEventType.PAYMENT_CAPTURED, {
    payment_id: paymentId,
    order_id: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    provider: providerName,
  });
}

/**
 * Explicit capture endpoint (Phase 0 §9: POST /api/v1/payments/:id/capture).
 * Only reachable today for a Payment that ended up AUTHORIZED without
 * auto-capture (autoCapture=false, or a prior capture attempt that failed) —
 * with `autoCapture` defaulting to true (FR4a), most Payments never need it,
 * but the endpoint exists now so Phase 5 can flip that setting with zero
 * changes here.
 */
export async function capturePayment(merchantId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, merchantId } });
  if (!payment) throw new PaymentNotFoundError();
  if (payment.status !== PaymentStatus.AUTHORIZED) {
    throw new PaymentNotAuthorizedError(payment.status);
  }

  const lastAuthorizedAttempt = await prisma.paymentAttempt.findFirst({
    where: { paymentId, status: "authorized" },
    orderBy: { createdAt: "desc" },
  });

  await performCapture(paymentId, payment.provider ?? "mock-bank", lastAuthorizedAttempt?.providerRef ?? undefined);

  return getPaymentForMerchant(merchantId, paymentId);
}

export type PaymentListFilters = {
  status?: PaymentStatus;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string; // matches payment id (exact/prefix) or the parent order's reference
  limit?: number;
  cursor?: string;
};

/**
 * Dashboard listing/search (FR17: filters by status/date range/amount;
 * FR19: search by ID or reference). Cursor-paginated on `id` — simple
 * `createdAt DESC` ordering with a cursor is enough for this project's
 * scale and avoids the "page N" offset-pagination performance cliff.
 */
export async function listPaymentsForMerchant(merchantId: string, filters: PaymentListFilters) {
  const where: Prisma.PaymentWhereInput = { merchantId };

  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    where.amount = {
      ...(filters.minAmount !== undefined ? { gte: filters.minAmount } : {}),
      ...(filters.maxAmount !== undefined ? { lte: filters.maxAmount } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { id: { equals: filters.search } },
      { order: { reference: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const limit = filters.limit ?? 25;
  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: { order: { select: { reference: true } } },
  });

  const hasMore = payments.length > limit;
  const page = hasMore ? payments.slice(0, limit) : payments;

  return {
    payments: page.map((p) => ({ ...serializePayment(p), order_reference: p.order.reference })),
    next_cursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function getPaymentForMerchant(merchantId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, merchantId } });
  if (!payment) throw new PaymentNotFoundError();
  return serializePayment(payment);
}

/** Full PaymentEvent timeline for one payment — the "payment history" deliverable. */
export async function getPaymentHistory(merchantId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, merchantId } });
  if (!payment) throw new PaymentNotFoundError();

  const events = await prisma.paymentEvent.findMany({
    where: { paymentId },
    orderBy: { createdAt: "asc" },
  });

  return {
    payment: serializePayment(payment),
    events: events.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      metadata: e.metadata,
      created_at: e.createdAt,
    })),
  };
}

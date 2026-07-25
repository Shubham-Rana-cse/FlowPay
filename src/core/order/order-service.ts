/**
 * Order Service (Phase 0 §4, FR5-FR8).
 *
 * Owns "what is being paid for". An Order is created once per checkout;
 * failed Payments do not create a new Order — see payment-service.ts, which
 * creates a new Payment row against the same Order on retry (FR7).
 *
 * Order.status becomes PAID once a linked Payment reaches CAPTURED (FR8).
 * That transition is driven from payment-service.ts once Phase 3 wires in
 * an actual provider capture; this service just exposes the setter.
 */
import { prisma } from "@/lib/db";
import { OrderStatus } from "@/constants/status";
import type { Order, Payment, Prisma } from "@/generated/prisma";

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotPayableError extends Error {
  constructor(currentStatus: string) {
    super(`Order is not payable in its current status: ${currentStatus}`);
    this.name = "OrderNotPayableError";
  }
}

function serializeOrder(order: Order) {
  return {
    id: order.id,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    reference: order.reference,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
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
  };
}

export async function createOrder(
  merchantId: string,
  input: { amount: number; currency: string; reference?: string }
) {
  const order = await prisma.order.create({
    data: {
      merchantId,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      reference: input.reference,
      status: OrderStatus.CREATED,
    },
  });
  return serializeOrder(order);
}

/** Raw (unserialized) lookup for internal use by payment-service.ts. */
export async function getOrderForMerchant(merchantId: string, orderId: string): Promise<Order> {
  const order = await prisma.order.findFirst({ where: { id: orderId, merchantId } });
  if (!order) throw new OrderNotFoundError();
  return order;
}

export async function getOrderWithPayments(merchantId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, merchantId },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) throw new OrderNotFoundError();

  const { payments, ...rest } = order;
  return {
    ...serializeOrder(rest),
    payments: payments.map(serializePayment),
  };
}

export type OrderListFilters = {
  status?: OrderStatus;
  from?: string;
  to?: string;
  search?: string; // matches order id (exact) or reference (contains)
  limit?: number;
  cursor?: string;
};

/**
 * Dashboard listing/search (FR17: filters by status/date range; FR19:
 * search by ID or reference). Cursor-paginated the same way as
 * payment-service.ts's listPaymentsForMerchant.
 */
export async function listOrdersForMerchant(merchantId: string, filters: OrderListFilters) {
  const where: Prisma.OrderWhereInput = { merchantId };

  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { id: { equals: filters.search } },
      { reference: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const limit = filters.limit ?? 25;
  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;

  return {
    orders: page.map(serializeOrder),
    next_cursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Marks an Order PAID once a linked Payment reaches CAPTURED (FR8). Not yet
 * called anywhere in Phase 2 — wired up in Phase 3 once captures happen for
 * real — but the setter belongs here so payment-service.ts doesn't reach
 * into Order internals directly.
 */
export async function markOrderPaid(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  return client.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.PAID },
  });
}

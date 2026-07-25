/**
 * Analytics Service (FR18: aggregate success rate, volume, failure
 * breakdown). Pure read-side aggregation over Payment/PaymentAttempt — no
 * new tables; everything here is derivable from data Phase 2-4 already
 * write, same spirit as Phase 0 §4's note that PaymentEvent doesn't need a
 * separate status-history table.
 */
import { prisma } from "@/lib/db";
import { PaymentStatus } from "@/constants/status";

// A payment counts toward the success side once money was ever captured,
// even if it was later (partially) refunded — refunding doesn't retroactively
// make the capture "not a success" for conversion-rate purposes.
const SUCCESS_STATUSES: PaymentStatus[] = [
  PaymentStatus.CAPTURED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];
// Terminal failure statuses. RETRY is deliberately excluded — Phase 6's
// polling job hasn't resolved it to a final state yet, so counting it as a
// failure now would double-count once it does.
const FAILURE_STATUSES: PaymentStatus[] = [PaymentStatus.FAILED, PaymentStatus.TIMEOUT];
const TERMINAL_STATUSES: PaymentStatus[] = [...SUCCESS_STATUSES, ...FAILURE_STATUSES];

export type AnalyticsFilters = { from?: string; to?: string };

export async function getAnalyticsForMerchant(merchantId: string, filters: AnalyticsFilters = {}) {
  const dateFilter =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lte: new Date(filters.to) } : {}),
        }
      : undefined;

  const baseWhere = { merchantId, ...(dateFilter ? { createdAt: dateFilter } : {}) };

  const [totalPayments, statusCounts, volumeByStatusCurrency, failureBreakdown] =
    await Promise.all([
      prisma.payment.count({ where: baseWhere }),
      prisma.payment.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
      prisma.payment.groupBy({
        by: ["status", "currency"],
        where: { ...baseWhere, status: { in: SUCCESS_STATUSES } },
        _sum: { amount: true },
      }),
      prisma.paymentAttempt.groupBy({
        by: ["errorCode"],
        where: { payment: baseWhere, errorCode: { not: null } },
        _count: { _all: true },
      }),
    ]);

  const countByStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
  const successCount = SUCCESS_STATUSES.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0);
  const failureCount = FAILURE_STATUSES.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0);
  const terminalCount = successCount + failureCount;

  // Volume: successful (captured, at any point) amount, grouped by currency.
  // A given currency may appear across multiple SUCCESS_STATUSES rows, so
  // fold them together here.
  const volumeByCurrency = new Map<string, number>();
  for (const row of volumeByStatusCurrency) {
    volumeByCurrency.set(
      row.currency,
      (volumeByCurrency.get(row.currency) ?? 0) + (row._sum.amount ?? 0)
    );
  }

  return {
    total_payments: totalPayments,
    terminal_payments: terminalCount,
    success_count: successCount,
    failure_count: failureCount,
    success_rate: terminalCount > 0 ? Number((successCount / terminalCount).toFixed(4)) : null,
    status_breakdown: TERMINAL_STATUSES.reduce<Record<string, number>>((acc, s) => {
      acc[s] = countByStatus[s] ?? 0;
      return acc;
    }, {}),
    volume_by_currency: Object.fromEntries(volumeByCurrency),
    failure_breakdown_by_error_code: failureBreakdown
      .filter((f) => f.errorCode)
      .map((f) => ({ error_code: f.errorCode, count: f._count._all })),
  };
}

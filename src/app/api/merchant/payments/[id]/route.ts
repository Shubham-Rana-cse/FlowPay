import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { getPaymentHistory, PaymentNotFoundError } from "@/core/payment/payment-service";
import { getLedgerForPayment } from "@/core/ledger/ledger-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 5 — JWT-authed sibling to the API-key `/api/v1/payments/:id/events`
// and `/api/v1/payments/:id/ledger` routes (Phase 2-4), for the dashboard's
// payment detail page. Combines both into one call since the UI always
// wants them together.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { id } = await params;

    const [history, ledger] = await Promise.all([
      getPaymentHistory(merchantId, id),
      getLedgerForPayment(merchantId, id),
    ]);

    return successResponse({ ...history, ledger });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof PaymentNotFoundError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_FOUND, err.message, 404);
    }
    logger.error("Payment detail lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { getPaymentHistory, PaymentNotFoundError } from "@/core/payment/payment-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Payment history / audit timeline (Phase 0 §4 PaymentEvent, "Payment history"
// deliverable of Phase 2). The merchant-facing dashboard route at
// /api/merchant/payments/:id/events (Phase 5) will read from the same
// service function once the dashboard UI exists.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;

    const history = await getPaymentHistory(merchantId, id);
    return successResponse(history);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof PaymentNotFoundError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_FOUND, err.message, 404);
    }
    logger.error("Payment history lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

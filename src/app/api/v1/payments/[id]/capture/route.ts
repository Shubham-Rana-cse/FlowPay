import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import {
  capturePayment,
  PaymentNotFoundError,
  PaymentNotAuthorizedError,
} from "@/core/payment/payment-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Explicit capture (Phase 0 §9). Most Payments auto-capture during
// POST /payments (MerchantSettings.autoCapture defaults to true, FR4a) and
// never need this — it exists for the AUTHORIZED-but-not-yet-captured case
// (auto-capture off, or a previous capture attempt that failed).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;

    const payment = await capturePayment(merchantId, id);
    logger.info("Payment captured", { correlationId, merchantId, paymentId: id });
    return successResponse(payment);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof PaymentNotFoundError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_FOUND, err.message, 404);
    }
    if (err instanceof PaymentNotAuthorizedError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_AUTHORIZED, err.message, 409);
    }
    logger.error("Payment capture failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

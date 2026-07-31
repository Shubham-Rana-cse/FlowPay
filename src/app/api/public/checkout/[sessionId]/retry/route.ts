import { NextRequest } from "next/server";
import {
  retryCheckoutPayment,
  CheckoutSessionNotFoundError,
  CheckoutSessionExpiredError,
  CheckoutSessionAlreadyCompletedError,
  CheckoutSessionNotRetryableError,
  OrderNotFoundError,
  OrderNotPayableError,
} from "@/core/checkout/checkout-session-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { sessionId } = await params;
    const session = await retryCheckoutPayment(sessionId);
    logger.info("Checkout session payment retried", { correlationId, sessionId });
    return successResponse(session);
  } catch (err) {
    if (err instanceof CheckoutSessionNotFoundError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_NOT_FOUND, err.message, 404);
    }
    if (err instanceof CheckoutSessionExpiredError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_EXPIRED, err.message, 409);
    }
    if (err instanceof CheckoutSessionAlreadyCompletedError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_ALREADY_COMPLETED, err.message, 409);
    }
    if (err instanceof CheckoutSessionNotRetryableError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_NOT_RETRYABLE, err.message, 409);
    }
    if (err instanceof OrderNotFoundError) {
      return errorResponse(ErrorCode.ORDER_NOT_FOUND, err.message, 404);
    }
    if (err instanceof OrderNotPayableError) {
      return errorResponse(ErrorCode.ORDER_NOT_PAYABLE, err.message, 409);
    }
    logger.error("Checkout session retry failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

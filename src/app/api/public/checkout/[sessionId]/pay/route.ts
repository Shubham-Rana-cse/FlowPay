import { NextRequest } from "next/server";
import { submitCheckoutPaymentSchema } from "@/lib/validation";
import {
  submitCheckoutPayment,
  CheckoutSessionNotFoundError,
  CheckoutSessionExpiredError,
  CheckoutSessionAlreadyCompletedError,
} from "@/core/checkout/checkout-session-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { sessionId } = await params;

    const body = await req.json().catch(() => null);
    const parsed = submitCheckoutPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const session = await submitCheckoutPayment(sessionId, parsed.data.method);
    logger.info("Checkout session payment submitted", { correlationId, sessionId });
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
    logger.error("Checkout session payment failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

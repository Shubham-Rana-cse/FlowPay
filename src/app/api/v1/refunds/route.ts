import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { createRefundSchema } from "@/lib/validation";
import {
  createRefund,
  PaymentNotFoundError,
  PaymentNotRefundableError,
  RefundAmountExceedsRemainingError,
} from "@/core/refund/refund-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 4, FR13 — full or partial refund on a CAPTURED/PARTIALLY_REFUNDED payment.
export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);

    const body = await req.json().catch(() => null);
    const parsed = createRefundSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const { refund, payment } = await createRefund(merchantId, {
      paymentId: parsed.data.payment_id,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    });

    logger.info("Refund processed", {
      correlationId,
      merchantId,
      refundId: refund.id,
      status: refund.status,
    });
    return successResponse({ ...refund, payment }, 201);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof PaymentNotFoundError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_FOUND, err.message, 404);
    }
    if (err instanceof PaymentNotRefundableError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_REFUNDABLE, err.message, 409);
    }
    if (err instanceof RefundAmountExceedsRemainingError) {
      return errorResponse(ErrorCode.REFUND_AMOUNT_INVALID, err.message, 400);
    }
    logger.error("Refund creation failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

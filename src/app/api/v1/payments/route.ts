import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { createPaymentSchema } from "@/lib/validation";
import {
  createPayment,
  IdempotencyKeyRequiredError,
  IdempotencyKeyConflictError,
  OrderNotFoundError,
  OrderNotPayableError,
} from "@/core/payment/payment-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const idempotencyKey = req.headers.get("idempotency-key") ?? "";

    const body = await req.json().catch(() => null);
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const payment = await createPayment(
      merchantId,
      { orderId: parsed.data.order_id },
      idempotencyKey
    );
    logger.info("Payment created", { correlationId, merchantId, paymentId: payment.id });
    return successResponse(payment, 201);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof IdempotencyKeyRequiredError) {
      return errorResponse(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, err.message, 400);
    }
    if (err instanceof IdempotencyKeyConflictError) {
      return errorResponse(ErrorCode.IDEMPOTENCY_KEY_CONFLICT, err.message, 409);
    }
    if (err instanceof OrderNotFoundError) {
      return errorResponse(ErrorCode.ORDER_NOT_FOUND, err.message, 404);
    }
    if (err instanceof OrderNotPayableError) {
      return errorResponse(ErrorCode.ORDER_NOT_PAYABLE, err.message, 409);
    }
    logger.error("Payment creation failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

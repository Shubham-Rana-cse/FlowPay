import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { createOrderSchema } from "@/lib/validation";
import { createOrder } from "@/core/order/order-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);

    const body = await req.json().catch(() => null);
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const order = await createOrder(merchantId, parsed.data);
    logger.info("Order created", { correlationId, merchantId, orderId: order.id });
    return successResponse(order, 201);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    logger.error("Order creation failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

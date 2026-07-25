import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { listWebhookEventsForMerchant } from "@/core/webhook/webhook-event-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 5 — FR15 dashboard visibility: recent WebhookEvents + their
// WebhookDelivery attempts, for merchants debugging their integration.
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const events = await listWebhookEventsForMerchant(merchantId);
    return successResponse({ events });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Webhook event listing failed", {
      correlationId,
      error: (err as Error).message,
    });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

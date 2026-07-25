import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import {
  redeliverWebhookEvent,
  WebhookEventNotFoundError,
} from "@/core/webhook/webhook-delivery-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 5 — merchant-triggered re-delivery (dashboard "Retry" button). Same
// pattern as settlement-service.ts's merchant-triggered payout run standing
// in for a real cron: an automatic retry poller reusing `nextRetryAt` is
// Phase 6 territory (Open Design Decision #1), this is the manual
// equivalent available now.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { id } = await params;

    const deliveries = await redeliverWebhookEvent(merchantId, id);
    logger.info("Webhook event redelivered", { correlationId, merchantId, webhookEventId: id });
    return successResponse({ deliveries });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof WebhookEventNotFoundError) {
      return errorResponse(ErrorCode.WEBHOOK_EVENT_NOT_FOUND, err.message, 404);
    }
    logger.error("Webhook redelivery failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireCronSecret, CronAuthError } from "@/middleware/cron-auth";
import { pollDueWebhookDeliveries } from "@/core/webhook/webhook-delivery-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 6 — automatic counterpart to the dashboard's manual "Retry
// delivery" button (FR15, Open Design Decision #1's shared polling
// mechanism). Meant to be hit on a schedule (see vercel.json). Vercel Cron
// always calls cron paths with GET; POST is also supported for
// manual/curl/other-scheduler triggering.
async function handle(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    requireCronSecret(req.headers, correlationId);

    const result = await pollDueWebhookDeliveries();
    logger.info("Webhook retry poll completed", { correlationId, ...result });
    return successResponse(result);
  } catch (err) {
    if (err instanceof CronAuthError) {
      return errorResponse(ErrorCode.CRON_UNAUTHORIZED, err.message, 401);
    }
    logger.error("Webhook retry poll failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export const GET = handle;
export const POST = handle;

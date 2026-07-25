import { NextRequest } from "next/server";
import { requireCronSecret, CronAuthError } from "@/middleware/cron-auth";
import { pollPaymentRetries } from "@/core/retry/retry-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 6 — Open Design Decision #1: the polling half of "DB retry_at
// column + polling job". Meant to be hit on a schedule (see vercel.json)
// by an external scheduler; not merchant-facing (see cron-auth.ts).
// Vercel Cron always calls cron paths with GET, so that's supported here
// alongside POST for manual/curl/other-scheduler triggering.
async function handle(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    requireCronSecret(req.headers, correlationId);

    const result = await pollPaymentRetries();
    logger.info("Payment retry poll completed", { correlationId, ...result });
    return successResponse(result);
  } catch (err) {
    if (err instanceof CronAuthError) {
      return errorResponse(ErrorCode.CRON_UNAUTHORIZED, err.message, 401);
    }
    logger.error("Payment retry poll failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export const GET = handle;
export const POST = handle;

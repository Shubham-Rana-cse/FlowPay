import { NextRequest } from "next/server";
import { requireCronSecret, CronAuthError } from "@/middleware/cron-auth";
import { runScheduledSettlements } from "@/core/settlement/settlement-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 6 — puts settlement on a schedule (see vercel.json) instead of
// requiring a merchant to remember to call POST /api/v1/settlements.
// Vercel Cron always calls cron paths with GET; POST is also supported for
// manual/curl/other-scheduler triggering.
async function handle(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    requireCronSecret(req.headers, correlationId);

    const result = await runScheduledSettlements();
    logger.info("Scheduled settlement run completed", { correlationId, ...result });
    return successResponse(result);
  } catch (err) {
    if (err instanceof CronAuthError) {
      return errorResponse(ErrorCode.CRON_UNAUTHORIZED, err.message, 401);
    }
    logger.error("Scheduled settlement run failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export const GET = handle;
export const POST = handle;

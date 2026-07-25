import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { logger } from "@/lib/logger";

// Phase 0 §9 named this endpoint from the start; nothing needed it until
// Phase 6's cron-triggered pollers gave the project its first
// machine-to-machine callers worth a liveness/readiness check.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return successResponse({ status: "ok", db: "up", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Health check failed", { error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Database unreachable", 503);
  }
}

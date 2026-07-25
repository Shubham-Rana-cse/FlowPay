import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { getAnalyticsForMerchant } from "@/core/analytics/analytics-service";
import { analyticsQuerySchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 5 — FR18: aggregate success rate, volume, failure breakdown.
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const query = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = analyticsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const analytics = await getAnalyticsForMerchant(merchantId, parsed.data);
    return successResponse(analytics);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Analytics lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

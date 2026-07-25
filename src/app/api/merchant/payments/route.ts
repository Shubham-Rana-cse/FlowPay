import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { listPaymentsForMerchant } from "@/core/payment/payment-service";
import { listPaymentsQuerySchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 5 — FR17 (filters: status/date range/amount) + FR19 (search by ID/reference).
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const query = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = listPaymentsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const { status, from, to, min_amount, max_amount, search, limit, cursor } = parsed.data;
    const result = await listPaymentsForMerchant(merchantId, {
      status,
      from,
      to,
      minAmount: min_amount,
      maxAmount: max_amount,
      search,
      limit,
      cursor,
    });
    return successResponse(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Payment listing failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

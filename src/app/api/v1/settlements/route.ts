import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { createSettlementSchema } from "@/lib/validation";
import { createSettlement, listSettlementsForMerchant } from "@/core/settlement/settlement-service";
import { DEFAULT_CURRENCY } from "@/constants/currencies";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 4 — "Settlement simulation" roadmap deliverable. Merchant-triggered
// for now (see settlement-service.ts header); Phase 6 would put this on a
// schedule instead of requiring a manual POST.
export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);

    const body = await req.json().catch(() => ({}));
    const parsed = createSettlementSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const currency = parsed.data.currency ?? DEFAULT_CURRENCY;
    const result = await createSettlement(merchantId, currency);

    logger.info("Settlement run", {
      correlationId,
      merchantId,
      currency,
      settled: result.settled,
    });
    return successResponse(result, result.settled ? 201 : 200);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    logger.error("Settlement run failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const settlements = await listSettlementsForMerchant(merchantId);
    return successResponse({ settlements });
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    logger.error("Settlement list failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { getSettlementForMerchant, SettlementNotFoundError } from "@/core/settlement/settlement-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;

    const settlement = await getSettlementForMerchant(merchantId, id);
    return successResponse(settlement);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof SettlementNotFoundError) {
      return errorResponse(ErrorCode.SETTLEMENT_NOT_FOUND, err.message, 404);
    }
    logger.error("Settlement lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

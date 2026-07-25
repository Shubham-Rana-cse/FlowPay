import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { getRefundForMerchant, RefundNotFoundError } from "@/core/refund/refund-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;

    const refund = await getRefundForMerchant(merchantId, id);
    return successResponse(refund);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof RefundNotFoundError) {
      return errorResponse(ErrorCode.REFUND_NOT_FOUND, err.message, 404);
    }
    logger.error("Refund lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

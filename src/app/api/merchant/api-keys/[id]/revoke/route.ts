import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { revokeApiKey, ApiKeyNotFoundError } from "@/core/merchant/api-key-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { id } = await params;

    await revokeApiKey(merchantId, id);
    logger.info("API key revoked", { correlationId, merchantId, apiKeyId: id });

    return successResponse({ id, isActive: false });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof ApiKeyNotFoundError) {
      return errorResponse(ErrorCode.NOT_FOUND, err.message, 404);
    }
    logger.error("Failed to revoke API key", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

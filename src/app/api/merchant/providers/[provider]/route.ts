import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { deleteProviderConfig, ProviderConfigNotFoundError } from "@/core/routing/provider-config-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 7 — removes a provider's config row entirely, reverting it to "not
// configured" for this merchant (distinct from disabling it via
// POST /api/merchant/providers with enabled:false, which keeps the row but
// excludes it from routing).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { provider } = await params;

    await deleteProviderConfig(merchantId, decodeURIComponent(provider));
    return successResponse({ deleted: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof ProviderConfigNotFoundError) {
      return errorResponse(ErrorCode.PROVIDER_CONFIG_NOT_FOUND, err.message, 404);
    }
    logger.error("Provider config delete failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import {
  listProviderConfigs,
  upsertProviderConfig,
  UnknownProviderError,
  KNOWN_PROVIDERS,
} from "@/core/routing/provider-config-service";
import { upsertProviderConfigSchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 7 — "Provider switching" + Dynamic Routing Engine opt-in. A
// merchant with zero rows here keeps routing exactly like Phase 3-6
// (FixedProviderStrategy -> mock-bank); the first successful POST here is
// what makes dynamic-routing-engine.ts start applying for them.
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const configs = await listProviderConfigs(merchantId);
    return successResponse({ providers: configs, known_providers: KNOWN_PROVIDERS });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Provider config listing failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

// Create-or-update one provider's config (enabled/priority/costBps).
export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const body = await req.json().catch(() => null);
    const parsed = upsertProviderConfigSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const config = await upsertProviderConfig(merchantId, parsed.data);
    logger.info("Provider config upserted", { correlationId, merchantId, provider: parsed.data.provider });
    return successResponse(config);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof UnknownProviderError) {
      return errorResponse(ErrorCode.UNKNOWN_PROVIDER, err.message, 400);
    }
    logger.error("Provider config upsert failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

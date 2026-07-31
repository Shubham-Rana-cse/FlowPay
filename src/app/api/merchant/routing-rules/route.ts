import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { listRoutingRules, createRoutingRule } from "@/core/routing/routing-rule-service";
import { UnknownProviderError } from "@/core/routing/provider-config-service";
import { createRoutingRuleSchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 7 — Dynamic Routing Engine (FR9/FR21): currency/amount-conditioned
// routing overrides, evaluated in ascending `priority` order before the
// merchant's configured strategy (see rule-matching.ts, dynamic-routing-engine.ts).
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const rules = await listRoutingRules(merchantId);
    return successResponse({ rules });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Routing rule listing failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const body = await req.json().catch(() => null);
    const parsed = createRoutingRuleSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const rule = await createRoutingRule(merchantId, parsed.data);
    logger.info("Routing rule created", { correlationId, merchantId, ruleId: rule.id });
    return successResponse(rule, 201);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof UnknownProviderError) {
      return errorResponse(ErrorCode.UNKNOWN_PROVIDER, err.message, 400);
    }
    logger.error("Routing rule creation failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

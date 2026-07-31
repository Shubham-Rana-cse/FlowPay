import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import {
  updateRoutingRule,
  deleteRoutingRule,
  RoutingRuleNotFoundError,
} from "@/core/routing/routing-rule-service";
import { UnknownProviderError } from "@/core/routing/provider-config-service";
import { updateRoutingRuleSchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = updateRoutingRuleSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const rule = await updateRoutingRule(merchantId, id, parsed.data);
    return successResponse(rule);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof RoutingRuleNotFoundError) {
      return errorResponse(ErrorCode.ROUTING_RULE_NOT_FOUND, err.message, 404);
    }
    if (err instanceof UnknownProviderError) {
      return errorResponse(ErrorCode.UNKNOWN_PROVIDER, err.message, 400);
    }
    logger.error("Routing rule update failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const { id } = await params;

    await deleteRoutingRule(merchantId, id);
    return successResponse({ deleted: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof RoutingRuleNotFoundError) {
      return errorResponse(ErrorCode.ROUTING_RULE_NOT_FOUND, err.message, 404);
    }
    logger.error("Routing rule delete failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import { createApiKeySchema } from "@/lib/validation";
import { generateApiKey, listApiKeys } from "@/core/merchant/api-key-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const keys = await listApiKeys(merchantId);
    return successResponse({ keys });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Failed to list API keys", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const body = await req.json().catch(() => ({}));
    const parsed = createApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const result = await generateApiKey(merchantId, parsed.data.label);
    logger.info("API key generated", { correlationId, merchantId, apiKeyId: result.id });

    // rawKey is shown exactly once — the client must save it now.
    return successResponse(result, 201);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Failed to generate API key", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { loginSchema } from "@/lib/validation";
import { authenticateMerchant, InvalidCredentialsError } from "@/core/merchant/merchant-service";
import { signJwt } from "@/lib/auth";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { logger } from "@/lib/logger";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      parsed.error.issues.map((i) => i.message).join(", "),
      400
    );
  }

  try {
    const merchant = await authenticateMerchant(parsed.data.email, parsed.data.password);
    const token = signJwt({ merchantId: merchant.id, email: merchant.email });

    logger.info("Merchant logged in", { correlationId, merchantId: merchant.id });
    return successResponse({ token, merchant });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return errorResponse(ErrorCode.INVALID_CREDENTIALS, err.message, 401);
    }
    logger.error("Login failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

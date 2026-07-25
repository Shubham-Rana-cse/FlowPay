import { NextRequest } from "next/server";
import { registerSchema } from "@/lib/validation";
import { registerMerchant, DuplicateEmailError } from "@/core/merchant/merchant-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { logger } from "@/lib/logger";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      ErrorCode.VALIDATION_ERROR,
      parsed.error.issues.map((i) => i.message).join(", "),
      400
    );
  }

  try {
    const merchant = await registerMerchant(parsed.data);
    logger.info("Merchant registered", { correlationId, merchantId: merchant.id });
    return successResponse(merchant, 201);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return errorResponse(ErrorCode.DUPLICATE_EMAIL, err.message, 409);
    }
    logger.error("Merchant registration failed", {
      correlationId,
      error: (err as Error).message,
    });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

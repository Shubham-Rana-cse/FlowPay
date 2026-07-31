import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import {
  getCheckoutSessionForMerchant,
  CheckoutSessionNotFoundError,
} from "@/core/checkout/checkout-session-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;
    const session = await getCheckoutSessionForMerchant(merchantId, id);
    return successResponse(session);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof CheckoutSessionNotFoundError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_NOT_FOUND, err.message, 404);
    }
    logger.error("Checkout session lookup failed", { error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

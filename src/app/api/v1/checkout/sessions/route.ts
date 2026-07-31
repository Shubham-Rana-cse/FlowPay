import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { createCheckoutSessionSchema } from "@/lib/validation";
import {
  createCheckoutSession,
  OrderNotFoundError,
  OrderNotPayableError,
} from "@/core/checkout/checkout-session-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);

    const body = await req.json().catch(() => null);
    const parsed = createCheckoutSessionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    // Checkout pages are served by this same Next.js app (see
    // src/app/checkout/[sessionId]/page.tsx), so the request's own origin
    // is always the right host to build checkout_url from — no separate
    // APP_URL env var needed, and it's correct in every environment
    // (localhost, a preview deployment, or production) without config.
    const appOrigin = req.nextUrl.origin;

    const session = await createCheckoutSession(
      merchantId,
      {
        orderId: parsed.data.order_id,
        returnUrl: parsed.data.return_url,
        expiresInSeconds: parsed.data.expires_in_seconds,
      },
      appOrigin
    );

    logger.info("Checkout session created", { correlationId, merchantId, sessionId: session.id });
    return successResponse(session, 201);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof OrderNotFoundError) {
      return errorResponse(ErrorCode.ORDER_NOT_FOUND, err.message, 404);
    }
    if (err instanceof OrderNotPayableError) {
      return errorResponse(ErrorCode.ORDER_NOT_PAYABLE, err.message, 409);
    }
    logger.error("Checkout session creation failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

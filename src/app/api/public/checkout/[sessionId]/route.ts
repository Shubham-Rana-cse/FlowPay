/**
 * Phase 8 — public checkout endpoints (Phase 0 §9 doesn't have a category
 * for these; they're a new one: no JWT, no API key, the unguessable
 * `sessionId` itself is the bearer token, same trust model as a Stripe
 * Checkout Session URL. `getPublicCheckoutSession` only ever returns
 * fields safe to hand to an anonymous browser — see that function's own
 * comment.
 */
import { NextRequest } from "next/server";
import {
  getPublicCheckoutSession,
  CheckoutSessionNotFoundError,
} from "@/core/checkout/checkout-session-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { logger } from "@/lib/logger";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const session = await getPublicCheckoutSession(sessionId);
    return successResponse(session);
  } catch (err) {
    if (err instanceof CheckoutSessionNotFoundError) {
      return errorResponse(ErrorCode.CHECKOUT_SESSION_NOT_FOUND, err.message, 404);
    }
    logger.error("Public checkout session lookup failed", { error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

import { NextRequest } from "next/server";
import { requireApiKey, ApiKeyAuthError } from "@/middleware/api-key-auth";
import { getLedgerForPayment } from "@/core/ledger/ledger-service";
import { PaymentNotFoundError } from "@/core/payment/payment-service";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// Phase 4 — "transaction history" roadmap deliverable: the money-movement
// half of FR14 (LedgerEntry), a sibling to the process-timeline half at
// /api/v1/payments/:id/events (PaymentEvent).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = await requireApiKey(req.headers);
    const { id } = await params;

    const ledger = await getLedgerForPayment(merchantId, id);
    return successResponse(ledger);
  } catch (err) {
    if (err instanceof ApiKeyAuthError) {
      return errorResponse(ErrorCode.API_KEY_INVALID, err.message, 401);
    }
    if (err instanceof PaymentNotFoundError) {
      return errorResponse(ErrorCode.PAYMENT_NOT_FOUND, err.message, 404);
    }
    logger.error("Ledger lookup failed", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

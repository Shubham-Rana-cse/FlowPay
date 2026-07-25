import { NextRequest } from "next/server";
import { requireJwt, UnauthorizedError } from "@/middleware/jwt-auth";
import {
  getMerchantSettings,
  updateMerchantSettings,
  SettingsNotFoundError,
} from "@/core/merchant/merchant-service";
import { updateSettingsSchema } from "@/lib/validation";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ErrorCode } from "@/constants/errors";
import { getOrCreateCorrelationId } from "@/middleware/correlation-id";
import { logger } from "@/lib/logger";

// GET-only through Phase 4 — see prior READMEs' "not here yet" notes.
// Phase 5 (Merchant Dashboard) adds PUT below.
export async function GET(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);
    const settings = await getMerchantSettings(merchantId);

    if (!settings) {
      return errorResponse(ErrorCode.NOT_FOUND, "Settings not found", 404);
    }

    return successResponse(settings);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    logger.error("Failed to fetch settings", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

// Phase 5 — FR4/FR4a: settings become editable (auto-capture, default
// currency, timezone, and the FR4 webhook URL). Partial update — send only
// the fields you want to change.
export async function PUT(req: NextRequest) {
  const correlationId = getOrCreateCorrelationId(req.headers);
  try {
    const { merchantId } = requireJwt(req.headers, correlationId);

    const body = await req.json().catch(() => null);
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues.map((i) => i.message).join(", "),
        400
      );
    }

    const settings = await updateMerchantSettings(merchantId, parsed.data);
    logger.info("Settings updated", { correlationId, merchantId });
    return successResponse(settings);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return errorResponse(ErrorCode.UNAUTHORIZED, err.message, 401);
    }
    if (err instanceof SettingsNotFoundError) {
      return errorResponse(ErrorCode.NOT_FOUND, err.message, 404);
    }
    logger.error("Failed to update settings", { correlationId, error: (err as Error).message });
    return errorResponse(ErrorCode.INTERNAL_ERROR, "Something went wrong", 500);
  }
}

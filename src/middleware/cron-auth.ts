// Phase 6 — guards the internal polling endpoints (`/api/internal/cron/*`)
// that an external scheduler (Vercel Cron, a system crontab hitting curl,
// etc.) calls on a schedule. These aren't merchant-facing: no JWT, no API
// key, just a shared secret the scheduler is configured with, same spirit
// as `api-key-auth.ts`/`jwt-auth.ts` but for machine-to-machine calls
// instead of a merchant's own requests.
import { logger } from "@/lib/logger";

export class CronAuthError extends Error {
  constructor(message = "Invalid or missing cron secret") {
    super(message);
    this.name = "CronAuthError";
  }
}

export function requireCronSecret(headers: Headers, correlationId?: string): void {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    // Fail closed: an unconfigured secret must never mean "open to anyone".
    logger.error("CRON_SECRET is not configured — refusing all internal cron requests", {
      correlationId,
    });
    throw new CronAuthError("Cron endpoints are not configured");
  }

  // Vercel Cron sends this automatically for routes it triggers; also
  // accept a plain header for manual/curl/other-scheduler use.
  const vercelCronHeader = headers.get("authorization");
  const customHeader = headers.get("x-cron-secret");

  const matchesVercel = vercelCronHeader === `Bearer ${configured}`;
  const matchesCustom = customHeader === configured;

  if (!matchesVercel && !matchesCustom) {
    throw new CronAuthError();
  }
}

-- Phase 6: cross-request retry polling (Open Design Decision #1).
-- `retryCount` / `nextRetryAt` drive retry-service.ts's poller, distinct
-- from Phase 3's in-request (same-call) retry counter which is never
-- persisted.
ALTER TABLE "payments" ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payments_status_nextRetryAt_idx" ON "payments"("status", "nextRetryAt");

-- Phase 5: FR4 — merchant-configured webhook endpoint URL.
-- Nullable: merchants who haven't configured one yet just get no
-- WebhookDelivery attempts (see webhook-delivery-service.ts), not an error.
ALTER TABLE "merchant_settings" ADD COLUMN "webhookUrl" TEXT;

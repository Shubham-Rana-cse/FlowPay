-- Phase 8: Hosted Checkout. Purely additive — one new enum, one new table,
-- both nullable/optional everywhere they touch existing rows (Payment gets
-- no new column at all; CheckoutSession.paymentId is nullable). No existing
-- table's data or behavior changes: a merchant who never calls
-- POST /api/v1/checkout/sessions is completely unaffected, same pattern as
-- every prior phase's additive migration (Settlement, webhookUrl,
-- retryCount/nextRetryAt, ProviderConfig/RoutingRule).

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentId" TEXT,
    "providerChosen" TEXT,
    "paymentMethod" TEXT,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "returnUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkout_sessions_merchantId_idx" ON "checkout_sessions"("merchantId");

-- CreateIndex
CREATE INDEX "checkout_sessions_orderId_idx" ON "checkout_sessions"("orderId");

-- CreateIndex
CREATE INDEX "checkout_sessions_paymentId_idx" ON "checkout_sessions"("paymentId");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

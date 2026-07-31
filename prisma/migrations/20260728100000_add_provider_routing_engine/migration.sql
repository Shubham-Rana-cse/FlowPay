-- Phase 7: Dynamic Routing Engine, Provider Switching, Automatic Failover.
-- Purely additive — no existing table/column is touched, so every merchant
-- with no ProviderConfig/RoutingRule rows keeps routing exactly like
-- Phase 3-6 (FixedProviderStrategy -> mock-bank). See dynamic-routing-engine.ts.

-- CreateEnum
CREATE TYPE "RoutingStrategyType" AS ENUM ('FIXED', 'ROUND_ROBIN', 'CHEAPEST', 'HIGHEST_SUCCESS_RATE', 'MERCHANT_PREFERRED', 'RULE_BASED');

-- AlterTable
ALTER TABLE "merchant_settings" ADD COLUMN     "routingStrategy" "RoutingStrategyType" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "merchant_settings" ADD COLUMN     "preferredProvider" TEXT;
ALTER TABLE "merchant_settings" ADD COLUMN     "failoverEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "costBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT,
    "minAmount" INTEGER,
    "maxAmount" INTEGER,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_configs_merchantId_idx" ON "provider_configs"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_merchantId_provider_key" ON "provider_configs"("merchantId", "provider");

-- CreateIndex
CREATE INDEX "routing_rules_merchantId_idx" ON "routing_rules"("merchantId");

-- AddForeignKey
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

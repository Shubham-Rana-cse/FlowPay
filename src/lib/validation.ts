import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/constants/currencies";

export const registerSchema = z.object({
  businessName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createApiKeySchema = z.object({
  label: z.string().max(100).optional(),
});

// Phase 2 — Orders & Payments (FR5-FR8, FR6, FR9-FR12)

export const createOrderSchema = z.object({
  amount: z.number().int().positive("amount must be a positive integer in minor units"),
  currency: z.enum(SUPPORTED_CURRENCIES),
  reference: z.string().max(200).optional(),
});

export const createPaymentSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
});

// Phase 4 — Refunds & Settlements (FR13; settlement is a Phase 4 addition, see settlement-service.ts)

export const createRefundSchema = z.object({
  payment_id: z.string().min(1, "payment_id is required"),
  // Omitted -> refund the full remaining (unrefunded) amount.
  amount: z.number().int().positive("amount must be a positive integer in minor units").optional(),
  reason: z.string().max(300).optional(),
});

export const createSettlementSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
});

// Phase 5 — Merchant Settings edit (FR4, FR4a) and webhook URL (FR4).
// Every field optional: this is a partial update (PUT semantics here mean
// "replace the fields you send", not "you must send everything").
export const updateSettingsSchema = z.object({
  autoCapture: z.boolean().optional(),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
  timezone: z.string().min(1).max(100).optional(),
  // Empty string clears a previously-configured URL; omit the field to
  // leave it untouched.
  webhookUrl: z
    .union([z.string().url("webhookUrl must be a valid URL"), z.literal("")])
    .optional(),
  // Phase 7 — Dynamic Routing Engine / Automatic Failover configuration.
  routingStrategy: z
    .enum(["FIXED", "ROUND_ROBIN", "CHEAPEST", "HIGHEST_SUCCESS_RATE", "MERCHANT_PREFERRED", "RULE_BASED"])
    .optional(),
  // Empty string clears a previously-configured preference.
  preferredProvider: z.union([z.string().min(1).max(50), z.literal("")]).optional(),
  failoverEnabled: z.boolean().optional(),
});

// Phase 7 — Dynamic Routing Engine (FR9/FR21): provider switching + rules.

export const upsertProviderConfigSchema = z.object({
  provider: z.string().min(1).max(50),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  costBps: z.number().int().min(0).max(10000).optional(),
});

export const createRoutingRuleSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  priority: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  minAmount: z.number().int().nonnegative().optional(),
  maxAmount: z.number().int().nonnegative().optional(),
});

export const updateRoutingRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().min(1).max(50).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
  // null clears the condition; omit the field to leave it untouched.
  currency: z.union([z.enum(SUPPORTED_CURRENCIES), z.null()]).optional(),
  minAmount: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  maxAmount: z.union([z.number().int().nonnegative(), z.null()]).optional(),
});

// Phase 8 — Hosted Checkout.

export const createCheckoutSessionSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
  return_url: z.string().url("return_url must be a valid URL"),
  // Defaults to 30 minutes (see checkout-session-service.ts); merchants
  // can shorten/extend within a sane range.
  expires_in_seconds: z.number().int().min(60).max(3600).optional(),
});

export const submitCheckoutPaymentSchema = z.object({
  method: z.enum(["card", "upi", "netbanking"]),
});

// Phase 5 — Dashboard list/search filters (FR17-FR19). All optional; an
// empty query still returns the merchant's most recent items.
const dateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date");

export const listOrdersQuerySchema = z.object({
  status: z.enum(["CREATED", "PAID", "FAILED", "EXPIRED"]).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  search: z.string().max(200).optional(), // matches order id or reference
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export const listPaymentsQuerySchema = z.object({
  status: z
    .enum([
      "CREATED",
      "PENDING",
      "AUTHORIZED",
      "CAPTURED",
      "FAILED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "RETRY",
      "TIMEOUT",
    ])
    .optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  min_amount: z.coerce.number().int().nonnegative().optional(),
  max_amount: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(), // matches payment id or order reference
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export const analyticsQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

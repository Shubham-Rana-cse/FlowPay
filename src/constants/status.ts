// Central source of truth for all status enums used across the system.
// Prevents string-literal typos like "AUTHORIZED" vs "Authorized" scattered across files.

export const OrderStatus = {
  CREATED: "CREATED",
  PAID: "PAID",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  CREATED: "CREATED",
  PENDING: "PENDING",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  RETRY: "RETRY",
  TIMEOUT: "TIMEOUT",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RefundStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

// Phase 4 — Settlement simulation. Not part of the original Phase 0 ERD;
// see settlement-service.ts's header comment for why it was added now.
export const SettlementStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const WebhookDeliveryStatus = {
  PENDING: "PENDING",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

// Phase 5 — FR15. Logical business events dispatched to a merchant's
// configured webhook URL (WebhookEvent.eventType). Kept distinct from
// PaymentEventType: PaymentEventType is the internal process timeline
// (every transition, incl. ones no merchant integration cares about);
// WebhookEventType is the small, stable, public contract merchants build
// integrations against.
export const WebhookEventType = {
  PAYMENT_CAPTURED: "payment.captured",
  PAYMENT_FAILED: "payment.failed",
  REFUND_COMPLETED: "refund.completed",
  SETTLEMENT_COMPLETED: "settlement.completed",
} as const;
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

export const PaymentEventType = {
  CREATED: "created",
  VALIDATED: "validated",
  PROVIDER_SELECTED: "provider_selected",
  AUTHORIZATION_STARTED: "authorization_started",
  AUTHORIZATION_SUCCESS: "authorization_success",
  CAPTURED: "captured",
  REFUND_REQUESTED: "refund_requested",
  REFUND_COMPLETED: "refund_completed",
  SETTLED: "settled",
  FAILED: "failed",
  // Phase 6 — cross-request retry poll (retry-service.ts), distinct from
  // "failed" (a hard decline resolved within the original request).
  RETRY_ATTEMPTED: "retry_attempted",
  RETRY_EXHAUSTED: "retry_exhausted",
} as const;
export type PaymentEventType = (typeof PaymentEventType)[keyof typeof PaymentEventType];

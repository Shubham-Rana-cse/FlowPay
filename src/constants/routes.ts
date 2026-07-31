// Central route path constants — avoids magic strings when linking/fetching between
// dashboard pages and API routes.
export const API_ROUTES = {
  AUTH_REGISTER: "/api/auth/register",
  AUTH_LOGIN: "/api/auth/login",
  MERCHANT_API_KEYS: "/api/merchant/api-keys",
  MERCHANT_API_KEY_REVOKE: (id: string) => `/api/merchant/api-keys/${id}/revoke`,
  MERCHANT_SETTINGS: "/api/merchant/settings",
  V1_ORDERS: "/api/v1/orders",
  V1_ORDER: (id: string) => `/api/v1/orders/${id}`,
  V1_PAYMENTS: "/api/v1/payments",
  V1_PAYMENT: (id: string) => `/api/v1/payments/${id}`,
  V1_PAYMENT_EVENTS: (id: string) => `/api/v1/payments/${id}/events`,
  V1_PAYMENT_LEDGER: (id: string) => `/api/v1/payments/${id}/ledger`,
  V1_REFUNDS: "/api/v1/refunds",
  V1_REFUND: (id: string) => `/api/v1/refunds/${id}`,
  V1_SETTLEMENTS: "/api/v1/settlements",
  V1_SETTLEMENT: (id: string) => `/api/v1/settlements/${id}`,
  // Phase 8 — Hosted Checkout. V1_* is merchant/API-key authed (session
  // creation); PUBLIC_* takes no auth beyond the session id itself, same
  // trust model as a Stripe Checkout Session URL.
  V1_CHECKOUT_SESSIONS: "/api/v1/checkout/sessions",
  V1_CHECKOUT_SESSION: (id: string) => `/api/v1/checkout/sessions/${id}`,
  PUBLIC_CHECKOUT_SESSION: (id: string) => `/api/public/checkout/${id}`,
  PUBLIC_CHECKOUT_PAY: (id: string) => `/api/public/checkout/${id}/pay`,
  PUBLIC_CHECKOUT_RETRY: (id: string) => `/api/public/checkout/${id}/retry`,
  // Phase 5 — merchant dashboard reads (FR17-FR19) and settings (FR4)
  MERCHANT_ORDERS: "/api/merchant/orders",
  MERCHANT_PAYMENTS: "/api/merchant/payments",
  MERCHANT_ANALYTICS: "/api/merchant/analytics",
  MERCHANT_WEBHOOKS: "/api/merchant/webhooks",
  MERCHANT_WEBHOOK_REDELIVER: (id: string) => `/api/merchant/webhooks/${id}/redeliver`,
} as const;

export const DASHBOARD_ROUTES = {
  HOME: "/dashboard",
  ORDERS: "/dashboard/orders",
  PAYMENTS: "/dashboard/payments",
  PAYMENT: (id: string) => `/dashboard/payments/${id}`,
  ANALYTICS: "/dashboard/analytics",
  WEBHOOKS: "/dashboard/webhooks",
  SETTINGS: "/dashboard/settings",
  API_KEYS: "/dashboard/api-keys",
  PROFILE: "/dashboard/profile",
  LOGIN: "/login",
  REGISTER: "/register",
} as const;

// Phase 8 — the hosted, customer-facing checkout page. Deliberately not
// under DASHBOARD_ROUTES: it has no sidebar, no JWT, and isn't part of the
// merchant dashboard's route tree.
export const CHECKOUT_ROUTES = {
  SESSION: (id: string) => `/checkout/${id}`,
} as const;

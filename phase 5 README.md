# Payment Orchestrator — Phase 5: Merchant Dashboard

Phase 1 (foundation), Phase 2 (Orders/Payments/idempotency), Phase 3 (Mock
Bank, Provider Adapter pattern, real authorization + capture), and Phase 4
(refunds, ledger, settlement simulation) are done. This is the Phase 5
build: **webhooks (FR15), editable merchant settings incl. webhook URL
(FR4/FR4a), order/payment search & filters (FR17/FR19), aggregate
analytics (FR18), and the dashboard UI to drive all of it.** The only
things still deferred are Phase 6's polling jobs (cross-request payment
retry, automatic webhook redelivery, scheduled settlement) and Phase 7's
real provider adapters (Stripe/Razorpay).

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma 7
- JWT auth (15 min, short-lived, no refresh token) + bcrypt password hashing
- Zod validation on every endpoint
- Vitest for unit tests

## ⚠️ Setup required before running

This project was scaffolded in a sandboxed environment without access to
`binaries.prisma.sh`, so the Prisma client could **not** be generated here.
You must run `prisma generate` yourself before anything will build or run.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:
- `DATABASE_URL` — point this at a Postgres instance (Neon, Supabase, or local Postgres).
- `JWT_SECRET` — generate one: `openssl rand -base64 32`

### 3. Generate the Prisma client (required — this step was blocked in the sandbox)

```bash
npx prisma generate
```

This creates `src/generated/prisma/` — the actual database client. **Phase
5 adds `MerchantSettings.webhookUrl`** (see "Schema changes in Phase 5"
below) — if you're upgrading from a Phase 4 checkout, re-run this command
even if you already had a client generated, or `webhook-delivery-service.ts`
won't type-check.

### 4. Run the migration

```bash
npx prisma migrate dev
```

This applies every migration up through Phase 4's full ERD plus the Phase 5
`add_webhook_url` migration (`MerchantSettings.webhookUrl`). If you already
ran migrations for an earlier phase, Prisma will detect the new migration
and apply just that one column — no reset needed.

### 5. Seed the database

```bash
npm run prisma:seed
```

This creates one demo merchant (`demo@merchant.test` / `password123`) with
two API keys and a MerchantSettings row. The raw API keys are printed once
to the console.

### 6. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000` — it redirects to `/login`.

## Verifying it works

```bash
npm run test    # Vitest — Money, state-machine, refund/ledger rules, Mock Bank, routing, webhook signing
npm run lint    # ESLint
npm run build   # Production build
```

## Trying the Phase 5 dashboard

Log in as `demo@merchant.test` / `password123` and use the sidebar:

- **Dashboard** — payment count, success rate, and captured volume at a glance.
- **Orders** — search/filter by status, and by ID or reference (FR17, FR19).
- **Payments** — same filters plus a status dropdown covering every
  `PaymentStatus`; click into a payment for its full `PaymentEvent` timeline
  and `LedgerEntry` history side by side.
- **Analytics** — total payments, success rate, captured volume by currency,
  a status-breakdown bar chart, and a failure breakdown by provider error
  code (FR18).
- **Settings** — auto-capture toggle, default currency, timezone, and the
  webhook URL, plus a reveal/hide control for the webhook signing secret
  (FR4, FR4a).
- **Webhooks** — every `WebhookEvent` dispatched (`payment.captured`,
  `payment.failed`, `refund.completed`, `settlement.completed`) with its
  delivery attempts and a manual "Retry delivery" button (FR15).

### Trying webhooks end-to-end

1. Stand up any endpoint that can receive a POST — [webhook.site](https://webhook.site)
   works well for a quick manual test — and paste its URL into **Settings →
   Webhook URL**, then save.
2. Run any Phase 3/4 flow that changes payment state (a successful payment,
   a refund, a settlement). A `WebhookEvent` row is created and delivered
   immediately (or left `RETRYING`/`FAILED` if your endpoint didn't return
   2xx).
3. Verify the signature: HMAC-SHA256 over the raw JSON body using your
   merchant's `webhookSecret` (visible under Settings), compared against
   the `X-Signature` header.
4. Check **Webhooks** in the dashboard to see the delivery outcome, and hit
   "Retry delivery" to force another attempt on demand.

```bash
# Everything below still works exactly as in Phase 2-4 — unchanged.
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
  -d '{"amount": 50000, "currency": "INR", "reference": "cart_success"}'

curl -X POST http://localhost:3000/api/v1/payments \
  -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" -d '{"order_id": "ord_..."}'
# -> a payment.captured WebhookEvent is created + delivered right after this returns
```

## What's implemented in Phase 5

- **Editable Merchant Settings** (`src/core/merchant/merchant-service.ts`,
  `PUT /api/merchant/settings`, FR4/FR4a) — auto-capture, default currency,
  timezone, and the new `webhookUrl` are all editable now; every field is a
  partial update (send only what changed). `webhookUrl: ""` clears a
  previously-configured URL (stored as `null`).
- **Webhook Event Service** (`src/core/webhook/webhook-event-service.ts`,
  FR15) — `dispatchWebhookEvent` is the single entry point every other
  service calls: it writes one `WebhookEvent` row per logical business
  event (`payment.captured`, `payment.failed`, `refund.completed`,
  `settlement.completed` — see the new `WebhookEventType` constants) and
  triggers the first delivery attempt. Always called *after* the caller's
  own DB transaction commits (see `payment-service.ts`'s `performCapture`,
  `refund-service.ts`'s `createRefund`, `settlement-service.ts`'s
  `createSettlement`) — a webhook is a third-party network call, and
  holding a DB transaction open across one would turn a slow/unreachable
  merchant endpoint into a lock held on the Payment row. Never throws: a
  webhook failing to dispatch must never turn a successful payment/refund/
  settlement into an error response to the merchant's original API call.
- **Webhook Delivery Service** (`src/core/webhook/webhook-delivery-service.ts`,
  FR15, Open Design Decision #2) — HMAC-SHA256 signing over the raw JSON
  body using `MerchantSettings.webhookSecret`, sent as `X-Signature`;
  `attemptDelivery` makes one HTTP POST (5s timeout) and writes one
  `WebhookDelivery` row (`DELIVERED`/`RETRYING`/`FAILED`) with a
  `nextRetryAt` computed via the same exponential-backoff shape
  `payment-service.ts` already uses for authorize retries (30s/1m/2m/4m/8m,
  5 attempts max). A merchant with no `webhookUrl` configured just gets no
  delivery attempts — not an error. `redeliverWebhookEvent` is the
  merchant-triggered "Retry" action available today; an automatic poller
  that revisits `nextRetryAt` rows on its own is Phase 6 territory, same as
  `retry-service.ts`'s payment-retry poller (Open Design Decision #1) —
  webhook retries are designed to plug into that same mechanism rather than
  getting a second, parallel one.
- **Analytics Service** (`src/core/analytics/analytics-service.ts`,
  `GET /api/merchant/analytics`, FR18) — success rate (captured-ever vs.
  every terminal payment; `RETRY` is excluded since Phase 6 hasn't resolved
  it to a final state yet), captured volume grouped by currency, a full
  status breakdown, and a failure breakdown by `PaymentAttempt.errorCode`.
  Pure aggregation over existing tables — no new tables, same reasoning as
  Phase 0 §4's note about not needing a second status-history table.
- **Order/Payment search & filters** (`listOrdersForMerchant` in
  `order-service.ts`, `listPaymentsForMerchant` in `payment-service.ts`,
  `GET /api/merchant/orders`, `GET /api/merchant/payments`, FR17/FR19) —
  filter by status, created-at date range, and (for payments) amount range;
  search by exact ID or a case-insensitive `contains` match on the order's
  `reference`. Cursor-paginated on `id` rather than offset-paginated, to
  avoid the "page N" performance cliff at this project's scale.
- **`GET /api/merchant/payments/:id`** — JWT-authed dashboard sibling to
  the API-key `/api/v1/payments/:id/events` and `/api/v1/payments/:id/ledger`
  routes from Phase 2-4; combines both into one response since the payment
  detail page always wants them together.
- **`GET /api/merchant/webhooks`, `POST /api/merchant/webhooks/:id/redeliver`**
  — recent webhook activity and the manual redelivery action.
- **Dashboard UI** (FR17-FR19) — Orders and Payments list pages with live
  filters, a Payment detail page (event timeline + ledger), an Analytics
  page (success rate, volume, status/failure breakdowns), an editable
  Settings page (with a reveal/hide toggle for the webhook secret), and a
  Webhooks activity page with a manual retry button. The dashboard home
  page now shows real numbers instead of placeholder cards.

### Schema changes in Phase 5

Unlike Phase 2/3 (pure logic, no schema changes) and similar in spirit to
Phase 4's `Settlement` addition, Phase 5 adds exactly one column:
- `MerchantSettings.webhookUrl` (nullable `String`) — FR4's merchant-
  configured webhook endpoint. `WebhookEvent`/`WebhookDelivery` themselves
  needed no schema changes — Phase 0's ERD already modeled both tables in
  full; Phase 5 is just the first phase to write real logic into them.

## What's implemented in Phase 1

- **Auth**: `POST /api/auth/register`, `POST /api/auth/login` (bcrypt + short-lived JWT)
- **API keys**: `GET/POST /api/merchant/api-keys`, `POST /api/merchant/api-keys/:id/revoke`
- **Merchant**: `GET /api/merchant/me`
- **Money value object**: `src/shared/money.ts` (+ full test suite)
- **Full Prisma schema**: every Phase 0 entity, ready for later phases to build directly into
- **Constants**: `src/constants/` — status enums, error codes, route paths, currencies
- **Logger + correlation ID**: every request gets a correlation ID

## What's implemented in Phase 2

- **Orders** (FR5, FR8): `POST/GET /api/v1/orders`, `GET /api/v1/orders/:id`
- **Payments** (FR6, FR7, FR9-FR12): `POST /api/v1/payments` (idempotent),
  `GET /api/v1/payments/:id`, `GET /api/v1/payments/:id/events`
- **Payment state machine** (`src/core/payment/state-machine.ts`), unit-tested

## What's implemented in Phase 3

- **Provider Adapter pattern + Provider Registry + Routing Strategy** (FR9, FR20, FR21)
- **Mock Bank** (FR16) — deterministic success/failure/timeout/network-error simulation
- **Real authorization + capture**, auto-capture (FR4a), `POST /api/v1/payments/:id/capture`
- **Order becomes `PAID`** (FR8) wired for real

## What's implemented in Phase 4

- **Ledger Service** (FR14 money-movement half) + `GET /api/v1/payments/:id/ledger`
- **Refund Service** (FR13) + `POST/GET /api/v1/refunds`, `GET /api/v1/refunds/:id`
- **Settlement Service** (new model, not in the original Phase 0 ERD) +
  `POST/GET /api/v1/settlements`, `GET /api/v1/settlements/:id`

## What's intentionally *not* here yet

- **Phase 6** — `core/retry`'s DB `retry_at` + polling job (Open Design
  Decision #1) for cross-request payment retries; the equivalent automatic
  poller for `WebhookDelivery.nextRetryAt` rows (today's Phase 5 webhook
  retries are manual, via the dashboard's "Retry delivery" button); and
  scheduled (cron-driven) settlement runs instead of the merchant-triggered
  `POST /api/v1/settlements` call.
- **Phase 7** — real provider adapters (Stripe, Razorpay) alongside the Mock
  Bank; `RoutingStrategy` implementations beyond `FixedProviderStrategy`
  (cheapest/fastest/highest-success-rate/merchant-preferred).
- No Vercel deployment — deploy last, once everything above is stable
  locally (per Phase 1 decisions).

## Known sandbox limitations (not project bugs)

- The sandbox *did* have npm registry access for Phase 5: `npm install`,
  `npm run lint`, and `npm run test` were all run and pass (59/59 tests —
  the 55 from Phase 1-4 plus 4 new ones covering HMAC webhook signing).
  `tsc --noEmit` is clean **everywhere except the one place already broken
  by Phase 4's stale client** (`settlement-service.ts`, exactly as
  documented in the Phase 4 README) **plus one new, same-category error**:
  `webhook-delivery-service.ts` references `MerchantSettings.webhookUrl`,
  which the committed `src/generated/prisma/*` client — generated before
  this phase's schema change, and for Windows besides — doesn't know
  about. Running `npx prisma generate` (step 3) and `npx prisma migrate dev`
  (step 4) locally resolves both.
- `npm run test` prints one benign error (not a failing test — all 59 pass)
  from the new `webhook-delivery-service.test.ts`: importing that module
  pulls in the `prisma` singleton, which tries to load the committed
  Windows query-engine binary on this Linux sandbox. Identical root cause
  to the Phase 1-4 Prisma-binary limitation, not a Phase 5 regression.
- `binaries.prisma.sh` still wasn't reachable from this sandbox, so
  `prisma generate` / `migrate` / `validate` still need to be run locally.

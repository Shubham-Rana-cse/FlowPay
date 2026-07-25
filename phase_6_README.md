# Payment Orchestrator — Phase 6: Retry, Redelivery & Settlement Polling

Phase 1 (foundation), Phase 2 (Orders/Payments/idempotency), Phase 3 (Mock
Bank, real authorization + capture), Phase 4 (refunds, ledger, settlement
simulation), and Phase 5 (webhooks, editable settings, dashboard, search &
analytics) are done. This is the Phase 6 build: **the three background
polling jobs every earlier phase deliberately deferred** — cross-request
payment retry (Open Design Decision #1), automatic webhook redelivery, and
scheduled settlement runs. Only Phase 7 (real provider adapters) remains
after this.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma 7
- JWT auth (15 min, short-lived, no refresh token) + bcrypt password hashing
- Zod validation on every endpoint
- Vitest for unit tests
- Vercel Cron (or any external scheduler) for the Phase 6 pollers

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
- `CRON_SECRET` — **new in Phase 6.** Generate one the same way
  (`openssl rand -base64 32`). This guards `/api/internal/cron/*` — see
  "Trying the Phase 6 pollers" below.

### 3. Generate the Prisma client (required — this step was blocked in the sandbox)

```bash
npx prisma generate
```

This creates `src/generated/prisma/`. **Phase 6 adds `Payment.retryCount` +
`Payment.nextRetryAt`** (see "Schema changes in Phase 6" below) — if you're
upgrading from a Phase 5 checkout, re-run this command even if you already
had a client generated, or `retry-service.ts` won't type-check.

### 4. Run the migration

```bash
npx prisma migrate dev
```

This applies every migration up through Phase 5's full ERD plus the Phase 6
`add_payment_retry_scheduling` migration (`Payment.retryCount`,
`Payment.nextRetryAt`, and a `(status, nextRetryAt)` index for the poller's
query). If you already ran migrations for an earlier phase, Prisma will
detect the new migration and apply just that diff — no reset needed.

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
npm run test    # Vitest — Money, state-machine, refund/ledger/retry rules, Mock Bank, routing, webhook signing
npm run lint    # ESLint
npm run build   # Production build
```

## Trying the Phase 6 pollers

All three live under `/api/internal/cron/*`, guarded by `CRON_SECRET`
(`cron-auth.ts`) instead of a merchant's JWT or API key — these are
machine-to-machine endpoints for a scheduler, not something a merchant
calls directly. Each accepts both `GET` (what Vercel Cron actually sends)
and `POST` (for manual/curl testing), and each is idempotent-safe to call
repeatedly or concurrently.

```bash
# Payment retry poll — picks up every Payment stuck in TIMEOUT/RETRY whose
# nextRetryAt has elapsed and asks the Mock Bank what really happened.
curl -X POST http://localhost:3000/api/internal/cron/payment-retry \
  -H "x-cron-secret: <your CRON_SECRET>"
# -> { "scanned": 1, "authorized": 1, "failed": 0, "rescheduled": 0 }

# Webhook redelivery poll — automatic counterpart to the dashboard's
# manual "Retry delivery" button; picks up RETRYING deliveries past
# their nextRetryAt.
curl -X POST http://localhost:3000/api/internal/cron/webhook-retry \
  -H "x-cron-secret: <your CRON_SECRET>"
# -> { "scanned": 0, "delivered": 0, "stillFailing": 0 }

# Scheduled settlement — the cron-driven counterpart to the merchant-
# triggered POST /api/v1/settlements from Phase 4; finds every
# (merchant, currency) pair with anything eligible and settles it.
curl -X POST http://localhost:3000/api/internal/cron/settlement \
  -H "x-cron-secret: <your CRON_SECRET>"
# -> { "pairsScanned": 1, "settlementsCreated": 1 }

# Health check (named in Phase 0 §9 from the start; nothing needed it
# until Phase 6 gave the project its first machine-to-machine callers).
curl http://localhost:3000/api/internal/health
```

### End-to-end: watching a stuck payment resolve itself

1. Create an order whose amount ends in `97`–`99` (timeout/network error —
   see Phase 3's Mock Bank table) and pay it:
   ```bash
   curl -X POST http://localhost:3000/api/v1/orders \
     -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
     -d '{"amount": 10099, "currency": "INR"}'
   curl -X POST http://localhost:3000/api/v1/payments \
     -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" -d '{"order_id": "ord_..."}'
   # -> { "status": "RETRY", ... } — Phase 3's inline retries (3x, same
   #    request) are exhausted; nextRetryAt is now set ~1 minute out.
   ```
2. Check the dashboard's payment detail page — it now shows an "Awaiting
   automatic retry" banner with the retry count and next attempt time.
3. Wait a minute (or don't — the poller only checks `nextRetryAt <= now`,
   so calling it immediately after step 1 is a no-op; that's the point)
   and hit `POST /api/internal/cron/payment-retry`.
4. `GET /api/v1/payments/pay_...` now shows `CAPTURED` (or `AUTHORIZED` if
   `autoCapture` is off) — the poller asked the Mock Bank's `checkStatus`
   what actually happened rather than blindly resubmitting the same
   deterministic authorize call (which would just reproduce the identical
   timeout forever, since the outcome is derived from the unchanged
   amount).
5. `GET /api/v1/payments/pay_.../events` shows the full timeline including
   the new `retry_attempted`/`retry_exhausted` event types this phase adds.

### Scheduling it for real (production)

`vercel.json` (new this phase) wires all three into Vercel Cron:

| Job | Schedule |
|---|---|
| `payment-retry` | every 5 minutes |
| `webhook-retry` | every 5 minutes |
| `settlement` | daily at 02:00 |

Set `CRON_SECRET` as a Vercel project environment variable and Vercel Cron
authenticates automatically (`Authorization: Bearer $CRON_SECRET`) — no
extra config needed beyond `vercel.json` + the env var. Any other
scheduler (system crontab + curl, GitHub Actions, etc.) works the same way
via the `x-cron-secret` header instead.

## What's implemented in Phase 6

- **Cross-request payment retry** (`src/core/retry/retry-rules.ts` +
  `retry-service.ts`, Open Design Decision #1, FR12) — `retry-rules.ts` is
  pure backoff/exhaustion policy (no DB, same pattern as
  `state-machine.ts`/`ledger-rules.ts`, unit-tested): 5 cross-request
  retries, backing off 1m → 5m → 15m → 30m → 60m. This is a *separate*
  counter from Phase 3's in-request retry loop (3 attempts, 50/100/200ms,
  same HTTP call) — that loop already gave up before a Payment ever lands
  in `TIMEOUT`/`RETRY` with `nextRetryAt` set.
  `retry-service.ts`'s `pollPaymentRetries` is the actual poller: it asks
  the provider what happened via `ProviderAdapter.checkStatus` — exactly
  the method Phase 3 reserved for this — rather than blindly
  re-authorizing, since re-running `authorize()` against the deterministic
  Mock Bank would just reproduce the identical timeout/network-error
  forever (the outcome is derived from the unchanged payment amount). Every
  state change goes through `payment-service.ts`'s existing
  `transitionPayment` compare-and-swap (now extended to accept extra
  columns like `nextRetryAt` in the same atomic update), so overlapping
  poller runs or a merchant's own concurrent request can never
  double-process the same Payment. A payment that resolves successfully
  goes through the exact same (now-exported) `performCapture` auto-capture
  path Phase 3 built. One that exhausts its retries transitions to `FAILED`
  and dispatches the `payment.failed` webhook — this phase's poller is
  where that dispatch was always meant to happen (see Phase 3/5's own
  comments to that effect).
- **State machine extended** (`src/core/payment/state-machine.ts`) —
  `RETRY`/`TIMEOUT` can now resolve directly to `AUTHORIZED` (via the
  poller's `checkStatus` path) or to `FAILED` (exhausted retries), and
  `RETRY` gained a self-loop for "still transient, rescheduled" polls.
  Unit-tested alongside the existing transition tests.
- **Automatic webhook redelivery** (`src/core/webhook/webhook-delivery-service.ts`,
  FR15) — `pollDueWebhookDeliveries` is the background counterpart to
  Phase 5's merchant-triggered "Retry delivery" button: it finds every
  `WebhookEvent` whose most recent `WebhookDelivery` is `RETRYING` with an
  elapsed `nextRetryAt` and calls the exact same `attemptDelivery` the
  manual button uses, so both paths behave identically.
- **Scheduled settlement** (`src/core/settlement/settlement-service.ts`) —
  `runScheduledSettlements` finds every distinct `(merchant, currency)` pair
  with at least one eligible payment and runs the same `createSettlement`
  batching/locking logic Phase 4 built, automatically instead of requiring
  a merchant to remember to call `POST /api/v1/settlements`.
- **Cron auth** (`src/middleware/cron-auth.ts`) — a shared-secret guard
  (`CRON_SECRET`) for the new internal endpoints, machine-to-machine
  instead of JWT/API-key, fails closed if the secret isn't configured.
- **`POST/GET /api/internal/cron/payment-retry`,
  `/webhook-retry`, `/settlement`** (Phase 0 §9's "Internal / System"
  category) — thin route handlers wiring the three services above to an
  external scheduler; accept `GET` (what Vercel Cron sends) and `POST`
  (manual/curl).
- **`GET /api/internal/health`** — the health check Phase 0 §9 named from
  the start; added now since Phase 6 is the first phase with real
  machine-to-machine callers worth a liveness check for.
- **`vercel.json`** — cron schedule wiring all three jobs into Vercel Cron
  (5 min / 5 min / daily).
- **Dashboard** — the payment detail page now shows an "Awaiting automatic
  retry" banner (retry count, next attempt time) whenever a payment is
  `TIMEOUT`/`RETRY`, so a merchant isn't left wondering why a payment looks
  stuck.

### Schema changes in Phase 6

Similar in spirit to Phase 4's `Settlement` addition and Phase 5's
`webhookUrl` column, Phase 6 adds exactly two columns plus an index:
- `Payment.retryCount` (`Int`, default `0`) — cross-request retry attempts
  made so far by `retry-service.ts`'s poller. Reset implicitly (stays 0)
  until a payment first lands in `TIMEOUT`/`RETRY`; cleared to its terminal
  meaning once the payment resolves to `AUTHORIZED` or `FAILED`.
- `Payment.nextRetryAt` (`DateTime?`) — when the poller should next check
  this payment; `null` once resolved. Seeded by `payment-service.ts` the
  moment a payment first lands in `TIMEOUT`/`RETRY`, then updated by the
  poller on every subsequent (re)schedule.
- `@@index([status, nextRetryAt])` on `Payment` — the poller's query
  (`WHERE status IN (TIMEOUT, RETRY) AND nextRetryAt <= now()`) is the
  whole reason this index exists.

`WebhookDelivery` and `Settlement` themselves needed no schema changes —
Phase 0/4's ERD already modeled everything Phase 6's pollers write to;
this is just the first phase to run them on a schedule instead of only on
demand.

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

## What's implemented in Phase 5

- **Editable Merchant Settings** incl. webhook URL (FR4/FR4a)
- **Webhooks** (FR15) — `WebhookEvent`/`WebhookDelivery`, HMAC-SHA256 signing, manual redelivery
- **Analytics** (FR18), **Order/Payment search & filters** (FR17/FR19)
- **Dashboard UI** — Orders, Payments (+ detail page), Analytics, Settings, Webhooks

## What's intentionally *not* here yet

- **Phase 7** — real provider adapters (Stripe, Razorpay) alongside the Mock
  Bank; `RoutingStrategy` implementations beyond `FixedProviderStrategy`
  (cheapest/fastest/highest-success-rate/merchant-preferred).
- No dashboard UI for the pollers themselves (a "system health" page
  showing recent poll runs) — the pollers are meant to be invisible
  infrastructure; the payment detail page's retry banner and the existing
  Webhooks/Settlements dashboard pages are the merchant-facing surface for
  their effects.
- No Vercel deployment — deploy last, once everything above is stable
  locally (per Phase 1 decisions).

## Known sandbox limitations (not project bugs)

- The sandbox *did* have npm registry access for Phase 6: `npm install`,
  `npm run lint`, and `npm run test` were all run and pass (68/68 tests —
  the 59 from Phase 1-5 plus 6 new ones covering `retry-rules.ts`'s backoff
  schedule and exhaustion policy, plus 3 new state-machine tests for
  Phase 6's added transitions). `tsc --noEmit` and `npm run build` fail in
  exactly the same way as every prior phase's schema addition (Phase 4's
  `Settlement`, Phase 5's `webhookUrl`): the committed
  `src/generated/prisma/*` client predates this phase's schema change
  (`Payment.retryCount`/`nextRetryAt`) — on top of already being a stale
  Windows binary in a Linux sandbox — so every reference to those two
  fields (in `payment-service.ts` and `retry-service.ts`) fails to
  type-check until you run `npx prisma generate` (step 3) and `npx prisma
  migrate dev` (step 4) locally, exactly as documented in every prior
  phase's README.
- `binaries.prisma.sh` still wasn't reachable from this sandbox, so
  `prisma generate` / `migrate` / `validate` still need to be run locally.
- `npm run test` prints the same one benign error as Phase 5 (not a failing
  test — all 68 pass), from `webhook-delivery-service.test.ts` importing
  the `prisma` singleton, which tries to load the committed Windows
  query-engine binary on this Linux sandbox. Identical root cause to every
  prior phase's Prisma-binary limitation, not a Phase 6 regression.

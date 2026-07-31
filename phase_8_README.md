# Payment Orchestrator — Phase 8: Hosted Checkout

Phases 1-7 (foundation through Dynamic Routing/Failover) are done and
**untouched** by this phase — every existing test, API contract, and
documented behavior from those READMEs still applies exactly as written.
This is the Phase 8 build: **a branded, hosted checkout page** (`/checkout/{sessionId}`)
that a merchant redirects their customer's browser to, instead of driving
the payment themselves. Routing, failover, ledger, webhooks, retries — all
of Phase 1-7 — run completely unchanged underneath it.

## The one thing to understand before anything else

**A `CheckoutSession` is a thin wrapper around an existing Order, not a new
payment engine.** Creating the actual `Payment` still goes through the
exact same `createPayment()` in `payment-service.ts` that Phase 2-7 built —
same idempotency, same Dynamic Routing Engine / Automatic Failover, same
ledger writes, same webhook dispatch. This phase adds a session id (the
customer's bearer token for the hosted page), a status derived from the
underlying Payment, and a page to drive it from. Nothing about `/api/v1/*`
changes; a merchant who never calls `POST /api/v1/checkout/sessions` is
completely unaffected.

## Stack

Same as Phase 1-7 (Next.js 16, TypeScript, Tailwind, PostgreSQL, Prisma,
JWT + bcrypt, Zod, Vitest) — no new runtime dependencies. The hosted
checkout page is a plain Next.js App Router route in the same app; no
separate frontend project, no CORS to configure.

## ⚠️ Setup required before running

### 1-2. Install dependencies, configure `.env`

```bash
npm install
cp .env.example .env
```

No new environment variables. `checkout_url` is built from the incoming
request's own origin (`req.nextUrl.origin`) at session-creation time — the
hosted checkout page is served by this same app, so that's always the
right host in every environment (localhost, a Vercel preview, production)
with zero config.

### 3. Generate the Prisma client (required)

```bash
npx prisma generate
```

**Phase 8 adds one new model (`CheckoutSession`) and one new enum
(`CheckoutSessionStatus`)** — re-run this even if you already had a client
generated, or `checkout-session-service.ts` won't type-check.

### 4. Run the migration

```bash
npx prisma migrate dev
```

Applies every migration through Phase 7 plus Phase 8's
`add_checkout_sessions` migration. No reset needed if you already migrated
for an earlier phase.

### 5-6. Seed + run

```bash
npm run prisma:seed
npm run dev
```

The seed script is unchanged from Phase 1 — nothing about checkout
requires new seed data; any existing Order can have a session created
against it.

## Verifying it works

```bash
npm run test    # Vitest — all Phase 1-7 suites, unchanged
npm run lint    # ESLint
npm run build   # Production build
```

Phase 8 adds no new pure-logic module in the `state-machine.ts`/
`ledger-rules.ts`/`retry-rules.ts` sense — `checkout-session-service.ts` is
orchestration over already-tested logic (`createPayment`, the state
machine, routing), not new business rules, so there's no new unit-test
suite this phase. (If you want one: the natural candidate is a pure
`deriveSessionStatus(paymentStatus)` mapping test, already isolated as its
own function in the service for exactly this reason.)

## Trying Phase 8

### 1. Create a checkout session for an existing Order

Same auth as every other `/api/v1/*` endpoint — a raw API key as `Bearer`.

```bash
# Create an order (same as every prior phase)
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
  -d '{"amount": 34900, "currency": "INR", "reference": "cart_998"}'
# -> { "id": "ord_...", "status": "CREATED", ... }

# Create a checkout session against it
curl -X POST http://localhost:3000/api/v1/checkout/sessions \
  -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
  -d '{"order_id": "ord_...", "return_url": "https://example-merchant.test/return"}'
# -> {
#      "id": "cs_...", "status": "OPEN", "amount": 34900, "currency": "INR",
#      "expires_at": "...", "return_url": "https://example-merchant.test/return",
#      "checkout_url": "http://localhost:3000/checkout/cs_..."
#    }
```

### 2. Open `checkout_url` in a browser

That's the whole integration from the merchant's point of view: redirect
the customer's browser to `checkout_url`. The page:

1. Shows the merchant name, order reference, and amount (no PayFlow/FlowPay
   dashboard chrome — this is a standalone, customer-facing page).
2. Lets the customer pick Card / UPI / Net Banking. Only Card shows input
   fields, and — deliberately — **those fields are never submitted
   anywhere**; see "What's real vs. simulated" below.
3. On "Pay", calls the same Mock Bank / Stripe / Razorpay routing path
   every other phase already built, via `POST /api/public/checkout/{id}/pay`.
4. Polls `GET /api/public/checkout/{id}` every 2.5s while the underlying
   Payment is still resolving (`CREATED`/`PENDING`/`AUTHORIZED`/`TIMEOUT`/`RETRY`
   — the exact same "still in flight" set Phase 6's poller cares about).
5. On success or failure, shows a result screen and **auto-redirects back
   to `return_url`** after a 3-second countdown (with a manual "Continue
   now" button), appending `?session_id=...&status=...&payment_id=...`.
6. On failure, offers "Try again" — `POST /api/public/checkout/{id}/retry`
   — an FR7-style retry (new `Payment` against the same `Order`) without
   ever leaving the hosted page.

Use the same deterministic Mock Bank amount-ending convention from Phase 3
to drive every scenario on demand (e.g. an order amount ending `94` fails,
`99` needs Phase 6's poller to resolve `RETRY` — the checkout page will sit
in "Processing…" until you hit the cron endpoint, same as any other
merchant integration).

### 3. Session expiry

```bash
curl -X POST http://localhost:3000/api/v1/checkout/sessions \
  -H "Authorization: Bearer <raw_api_key>" -H "Content-Type: application/json" \
  -d '{"order_id": "ord_...", "return_url": "https://example-merchant.test/return", "expires_in_seconds": 60}'
```

Wait past `expires_at` and reload `/checkout/{id}` — it flips to `EXPIRED`
lazily on that read (no cron job for this, same "no dedicated poller"
choice Phase 0's own Order-expiry Open Design Decision made) and shows a
dead-end screen with no retry option.

## What's implemented in Phase 8

- **`CheckoutSession` model** (new — not in the original Phase 0 §4 ERD,
  same situation as Phase 4's `Settlement`) — see the schema's own comment
  for the full field rationale. Tracks `merchantId`/`orderId`, a
  denormalized `amount`/`currency` (same reasoning as `Payment`'s own
  denormalized fields), the current/latest `paymentId`, `status`, an
  `attemptCount` for FR7-style retries, and `returnUrl`/`expiresAt`.
- **`checkout-session-service.ts`** (`src/core/checkout/`) — the only new
  logic this phase adds:
  - `createCheckoutSession` — validates the Order belongs to the requesting
    merchant and is still `CREATED` (same guard `createPayment` already
    uses), mints a session with a default 30-minute TTL.
  - `getPublicCheckoutSession` — the one function every public/customer-
    facing read goes through. Returns only what a hosted checkout page
    needs (merchant name, order reference, amount, session status,
    embedded payment status + error code) — never a webhook secret, API
    key, or anything else a merchant would consider private. Lazily flips
    `OPEN -> EXPIRED` on read past `expiresAt`.
  - `submitCheckoutPayment` / `retryCheckoutPayment` — both call the
    existing `createPayment` with an idempotency key derived from
    `${sessionId}:${attemptCount}`, so each retry is guaranteed a fresh key
    (no accidental idempotent-replay of a failed attempt) while a
    double-click of "Pay" on the same attempt is not a fresh key (no
    accidental double charge). `deriveSessionStatus()` is the single pure
    mapping from `Payment.status` to `CheckoutSessionStatus` — `CAPTURED`
    -> `COMPLETED`, `FAILED` -> `FAILED`, everything else -> `OPEN` (still
    resolving).
- **Merchant-facing API** (API-key authed, Phase 0 §9 "Payment API"
  category):
  - `POST /api/v1/checkout/sessions` — create a session, returns
    `checkout_url` built from the request's own origin.
  - `GET /api/v1/checkout/sessions/:id` — merchant lookup of a session they
    own.
- **Public/customer-facing API** — a category Phase 0 §9 didn't need until
  now: no JWT, no API key. The session id itself is the bearer token, same
  trust model as a Stripe Checkout Session URL — unguessable (`cuid()`),
  single-purpose, and time-boxed.
  - `GET /api/public/checkout/:sessionId`
  - `POST /api/public/checkout/:sessionId/pay`
  - `POST /api/public/checkout/:sessionId/retry`
- **Hosted checkout page** (`src/app/checkout/[sessionId]/`) — a server
  component (`page.tsx`) fetches the session directly via the service (same
  process, no HTTP round-trip to itself) and hands it to a client component
  (`CheckoutClient.tsx`) that owns the interactive state machine described
  in "Trying Phase 8" above. Styled with the same design tokens as the
  merchant dashboard (`globals.css`'s ledger/terminal palette) but with none
  of the dashboard's sidebar/chrome — this route sits outside
  `/dashboard/*` on purpose.

### Schema changes in Phase 8

Purely additive, same spirit as every prior phase's schema addition:

- `CheckoutSessionStatus` enum (`OPEN`/`COMPLETED`/`FAILED`/`EXPIRED`).
- `CheckoutSession` model (new).
- Back-relations on `Merchant`, `Order`, and `Payment` (`checkoutSessions
  CheckoutSession[]`) — required by Prisma for the relation, not new
  concepts on those models. No existing column on any of the three
  changes.

## What's real vs. simulated

- **The payment result is completely real** within this project's own
  terms — it's the exact same `createPayment` call, Dynamic Routing
  Engine, provider adapters (Mock Bank / Stripe Test Mode / Razorpay Test
  Mode from Phase 7), ledger writes, and webhook dispatch as calling
  `/api/v1/payments` directly. Nothing about the checkout page fakes an
  outcome independently.
- **The card/UPI/net-banking forms are cosmetic.** Card number, expiry,
  CVV, and name are local component state only — never sent to the
  server, never stored, never logged. This is a deliberate design choice
  carried over from the Phase 8 design doc's own reasoning: collecting raw
  card data server-side would put this project's own backend in PCI DSS
  scope, and neither Stripe's nor Razorpay's Test Mode APIs (per Phase 7's
  own adapter comments) are meant to be driven that way from a
  merchant's/orchestrator's own server. A production build of this page
  would swap the card panel for Stripe Elements / Razorpay's client-side
  checkout SDK — same shape, real PCI-scope-avoiding hand-off — without
  touching anything in `checkout-session-service.ts`.
- **Method selection (Card/UPI/Net Banking) is not currently wired to
  provider behavior.** Mock Bank's deterministic buckets (Phase 3) and
  Stripe/Razorpay's own buckets (Phase 7) are keyed off the payment
  amount, not the method — `paymentMethod` is recorded on the session for
  display and as a hook for a future phase, not consumed by routing yet.

### TIMEOUT/RETRY and the long-wait escape hatch

A payment that lands in `TIMEOUT`/`RETRY` is resolved by Phase 6's own cron
poller, which backs off from 1 minute up to 60 minutes between attempts —
genuinely up to ~111 minutes worst case across all 5 cross-request retries
(`retry-rules.ts`). A customer cannot be expected to sit on a checkout page
for that. After 15 seconds continuously in `TIMEOUT`/`RETRY`,
`CheckoutClient.tsx` stops implying "any second now" and shows an honest
"still confirming with your bank, this can take a while" panel with a
"Return to {merchant}" button — the session stays `OPEN` and Phase 6's
poller keeps working on it server-side regardless of whether the customer
is still on the page; the merchant finds out via the webhook (or the next
time their own system reconciles) whenever it resolves. Polling also backs
off to every 8s (from 2.5s) once in this state, since there's no benefit to
hammering the API for something that may not change for minutes.

## What's intentionally *not* here

- No checkout-sessions list page in the merchant dashboard — a merchant can
  look up one session by id via the new `GET /api/v1/checkout/sessions/:id`,
  but there's no `/dashboard/checkout-sessions` UI this phase, same
  "API first, dashboard surface later if needed" pattern Phase 2's
  API-only payments had before Phase 5's dashboard.
- No dedicated `session.expired` webhook — an expired session is a UX dead
  end on the hosted page, not a business event the merchant's backend
  needs pushed to it (they'll simply never see a `payment.captured`
  webhook for that Order and can create a fresh session).
- No real Stripe Elements / Razorpay Checkout SDK integration — see "What's
  real vs. simulated" above.
- No automatic session-expiry sweep — same non-decision as Phase 0's Order
  expiry, resolved lazily on read, consistent with that Open Design
  Decision rather than introducing a new poller Phase 6 didn't already ask
  for.
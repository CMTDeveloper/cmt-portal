# Slice C — Event Registration Port (Design)

**Status:** Design approved 2026-04-15. Implementation plan pending.
**Porting source:** `/Users/dineshmatta/projects/chinmaya-event-registration` (standalone Next.js 16 app, `2026MothersDay` campaign).
**Supersedes:** nothing. Follows slice B (family check-in port) which shipped 2026-04-15.

---

## 1. Goal

Port the standalone `chinmaya-event-registration` app into `apps/portal` as internal route segments under `/events/register/*`, with strict functional parity and zero user-facing regressions, while taking targeted opportunities to reuse slice B primitives (Firebase admin, `findFamilyById`/`findFamilyByContact`, Firestore rate limiter, shared-domain types, feature flags, `@cmt/ui` primitives). The standalone app continues running unchanged and the two apps write to the same Firestore collection during a parallel-run soak period. When the portal is deemed ready, the user coordinates a cutover with Vaibhav for the webhook URL and the Cloud Run proxy allowlist.

## 2. Non-goals

- **No data model or pricing changes.** Flat $10 BV / $10 per person non-BV. Stripe fee 2.20% + $0.30. Same Firestore collection path (`events/{campaign}/registrations/{id}`). Same `MD26-XXXXXXX` ID format. Same env var names where they make sense.
- **No admin UI in slice C.** Vaibhav continues using the Google Sheet as his reconciliation worklist. `/check-in/admin` is not touched. A possible follow-up slice (tentatively "C2") can add an admin registrations tab once parallel-run feedback clarifies what Vaibhav actually needs.
- **No new auth layer.** Registration stays open — no login required for users, no cookies on any user-facing `/api/events/*` route. Webhook stays protected by the existing `WEBHOOK_API_KEY`.
- **No multi-event support.** One campaign per deployment, controlled by `NEXT_PUBLIC_EVENT_CAMPAIGN`. Turning this into a first-class Events system (runtime campaign switching, admin event management, historical reports) is explicitly a future slice.
- **No Stripe SDK integration.** Keeps the existing Cloud Run proxy. No new npm deps.
- **No sessionStorage → server-session migration.** Same Step 1 → Step 2 handoff mechanism as the standalone. Closing the tab mid-flow loses draft state, same as today.
- **No landing page changes on `chinmayatoronto.org`.** The user separately decides when to flip the public "register" link from the standalone domain to the portal.

## 3. Parallel-run strategy

- Both `chinmaya-event-registration` (standalone) and the portal's `/events/register` write to **the same Firestore path**: `events/2026MothersDay/registrations/{registrationId}` in the prod Firebase project (`chinmaya-setu-715b8`).
- Both apps POST to **the same Google Apps Script endpoint** (`NEXT_PUBLIC_GOOGLE_SHEET_URL`). The Apps Script de-duplicates by `registrationId` via its existing `action: create|update` routing.
- Both apps read **the same RTDB `/families/*` tree** for BV verification.
- The portal's webhook endpoint `/api/events/webhooks/payment-status` is deployed but **not live for real admin traffic** until the user notifies Vaibhav to switch URLs. Vaibhav's current admin tool keeps POSTing to the standalone's webhook URL throughout the slice.
- The Cloud Run Stripe proxy's redirect URL allowlist is updated (out of this repo, coordinated manually) only when portal is ready for real users. During slice C development and initial soak, Stripe checkout from portal-origin requests will be rejected by the proxy — acceptable because the **portal defaults to e-Transfer** and `NEXT_PUBLIC_ENABLE_STRIPE=false` in Vercel Production until allowlist lands.
- Cutover is purely "flip the public `register` link from standalone domain to portal domain, plus update Vaibhav's webhook URL, plus allowlist the portal domain in Cloud Run". Zero data migration required.

## 4. Architecture

### 4.1 Repository layout

```
chinmaya-mission-portal/
├── packages/shared-domain/src/events/            # NEW — cross-app (portal + mobile)
│   ├── registration.ts                           # EventRegistration, PaymentSource, RegistrationPaymentStatus
│   ├── pricing.ts                                # calculatePricing() + PricingInput/PricingResult
│   ├── api-contracts.ts                          # Zod schemas + TS types per route
│   ├── __tests__/
│   │   ├── pricing.test.ts                       # 30+ cases ported from standalone utils.test.ts
│   │   └── api-contracts.test.ts
│   └── index.ts                                  # barrel
│
├── apps/portal/src/features/events/              # NEW — portal-only
│   ├── shared/
│   │   ├── bv-contacts.ts                        # collectFamilyContactSet(family)
│   │   ├── firestore-adapter.ts                  # Firestore <-> EventRegistration
│   │   ├── google-sheets-sender.ts               # fire-and-forget helper
│   │   ├── rate-limiter.ts                       # re-export or wrap B2's limiter for IP-based keys
│   │   └── __tests__/
│   ├── registration-form.tsx                     # Step 1 client island
│   ├── registration-form-shell.tsx               # server wrapper (flag gate + server props)
│   ├── payment-instructions.tsx                  # Step 2 client
│   ├── order-summary.tsx
│   ├── counter-input.tsx                         # ported 1:1 from standalone src/components/
│   ├── step-indicator.tsx                        # ported 1:1
│   ├── success-banner.tsx
│   ├── cancel-banner.tsx
│   ├── index.ts                                  # barrel
│   └── __tests__/                                # component tests
│
├── apps/portal/src/app/events/register/          # NEW — route segments
│   ├── page.tsx                                  # Step 1 (renders notFound if flag off)
│   ├── error.tsx
│   ├── loading.tsx
│   ├── payment/
│   │   ├── page.tsx                              # Step 2
│   │   └── error.tsx
│   ├── success/
│   │   ├── page.tsx                              # Stripe success landing
│   │   └── error.tsx
│   └── cancel/
│       ├── page.tsx                              # Stripe cancel landing
│       └── error.tsx
│
├── apps/portal/src/app/api/events/               # NEW — API routes
│   ├── check-bv-status/route.ts                  # + __tests__/
│   ├── register/route.ts                         # + __tests__/
│   ├── lookup/route.ts                           # + __tests__/
│   ├── create-checkout/route.ts                  # + __tests__/
│   ├── update-reference/route.ts                 # + __tests__/
│   ├── update-payment-status/route.ts            # + __tests__/
│   └── webhooks/payment-status/route.ts          # + __tests__/
│
├── apps/portal/src/lib/env.ts                    # MODIFIED — extend schema
├── apps/portal/src/lib/flags.ts                  # MODIFIED — add eventsRegister flag
├── apps/portal/.env.local                        # MODIFIED — add new vars
├── apps/portal/e2e/c-events.spec.ts              # NEW — Playwright
├── README.md                                     # MODIFIED — slice C section
└── CLAUDE.md                                     # MODIFIED — slice status + slice C notes
```

### 4.2 Disciplines (from project CLAUDE.md)

1. **Feature boundaries enforced.** `features/events/*` cannot import from `features/check-in/*`. Shared primitives must flow through `@cmt/shared-domain` or `@cmt/ui`. The one exception: reusing `findFamilyById`/`findFamilyByContact` from `features/check-in/shared/rtdb/family-lookup.ts`. **Resolution:** promote those two functions into `features/check-in/shared/rtdb/family-lookup.ts`'s current home but re-export them via `@cmt/shared-domain/check-in`'s `index.ts` as a dedicated sub-module so `features/events/*` imports them through `@cmt/shared-domain`, not directly across feature directories. If that's not feasible (because the helpers depend on server-only Firebase Admin), **promote them to a new `packages/firebase-shared/src/rtdb/family-lookup.ts`** and update both `features/check-in/*` and `features/events/*` to import from there.
2. **`@cmt/shared-domain` stays pure TypeScript.** `events/registration.ts`, `events/pricing.ts`, `events/api-contracts.ts` contain no React, no Next, no DOM, no Firebase SDK imports. Lint-enforced.
3. **Per-segment error boundaries.** Every new route segment under `/events/register/*` gets its own `error.tsx`.
4. **Pre-push hook.** No change. Slice C lands via the same main-branch discipline used for slice B.
5. **Feature flags.** `flags.eventsRegister` gates all pages and all API routes except the webhook (which is gated only by API key — webhooks must survive flag flips to avoid losing real admin events in flight).
6. **No premature package extraction.** Portal chrome, registration form, and components all live in `apps/portal/src/features/events/*`. No new `@cmt/events-ui` package. Shared pieces live in `@cmt/shared-domain/events`.

## 5. User flows & pages

### 5.1 `/events/register` — Step 1 (registration form)

- Server component (`page.tsx`) checks `flags.eventsRegister`, renders `notFound()` if off, otherwise renders `<RegistrationFormShell>`
- `<RegistrationFormShell>` is a server wrapper that reads env metadata (display name, poster URL, campaign, price per person) and passes to `<RegistrationForm>`
- `<RegistrationForm>` is a client component:
  - Event poster left column (desktop 50/50 split, hidden on mobile — 1:1 ported)
  - BV status selector (3 options: "I have a Family ID", "Use my email", "I'm not a BV family")
  - BV verify panel conditionally renders based on selector → calls `POST /api/events/check-bv-status` → shows contact validation input if Family ID
  - Counter inputs for adults + children (`<CounterInput>`)
  - Name / email / phone text inputs (plain HTML + Tailwind, no phone-input library)
  - Payment method radio (e-Transfer default, Stripe if `NEXT_PUBLIC_ENABLE_STRIPE=true`)
  - Live cost breakdown (`<OrderSummary>`, re-runs `calculatePricing` client-side on every input change)
  - Lookup banner toggle (renders secondary form for `POST /api/events/lookup`)
  - Submit → `POST /api/events/register` → store result in `sessionStorage` key `cmtEventRegistration` → `router.push('/events/register/payment')`
- Tests: flag-off `notFound`, form validation, BV verify success/failure, submit happy path, lookup happy path, submit failure (409, 503)

### 5.2 `/events/register/payment` — Step 2

- Client component (reads `sessionStorage` in `useEffect`)
- Renders:
  - Registration ID with copy button
  - Order summary (line items from `calculatePricing`)
  - e-Transfer instructions panel (recipient email from `NEXT_PUBLIC_ETRANSFER_EMAIL`, registration ID as memo)
  - Stripe "Pay Now" button (if `payment_source === 'stripe'`, opens `stripePaymentLink` in new tab)
  - e-Transfer reference input with "Update Reference" button → `POST /api/events/update-reference`
  - Payment status banner (yellow "awaiting payment" → green "confirmed")
- On `window focus` → re-call `POST /api/events/lookup` to refresh status (matches standalone behavior)
- Reload-safe via sessionStorage

### 5.3 `/events/register/success?regId=XXXXX` — Stripe post-payment

- Client component, reads sessionStorage on mount
- Calls `POST /api/events/update-payment-status` with `{ registrationId: regId, paymentStatus: 'completed', payment_source: 'stripe' }`
- Shows green banner + order summary
- If sessionStorage empty, redirects to `/events/register`

### 5.4 `/events/register/cancel?regId=XXXXX` — Stripe cancellation

- Client component, reads sessionStorage
- Yellow banner with:
  - "Retry Payment" button → opens `stripePaymentLink` in new tab
  - "Start Over" → navigates to `/events/register` and clears sessionStorage

### 5.5 Feature-flag-off behavior

When `flags.eventsRegister === false`:
- `/events/register`, `/events/register/payment`, `/events/register/success`, `/events/register/cancel` all render Next's `notFound()` → 404 response
- All `/api/events/*` routes **except webhooks** return 404 (hard-coded early return before any logic)
- `/api/events/webhooks/payment-status` still listens — gated only by API key — so in-flight webhook traffic isn't lost on a flag flip

## 6. API routes

All seven routes live under `apps/portal/src/app/api/events/`. All accept and return JSON only. All use `@cmt/shared-domain/events/api-contracts` Zod schemas at the boundary. All are mobile-callable with plain `fetch`.

### 6.1 `POST /api/events/check-bv-status`

- **Input (Zod):** `{ familyId: string } | { email: string }` (discriminated union)
- **Output:** `{ isBvFamily: boolean, familyEmails?: string[], familyPhones?: string[] }`
- **Behavior:** look up family via `findFamilyById(fid)` or `findFamilyByContact(email)`. If found, call `collectFamilyContactSet(family)` → aggregate all contact fields (email, pemail, emergency_email, phone, phphone, pmphone, emergency_hphone, emergency_mphone) → return `isBvFamily: true` + the aggregated lists. If not found, return `isBvFamily: false`.
- **Error handling:** Firebase read failures default to `isBvFamily: false` (matches standalone graceful degradation).
- **Rate limit:** 5 requests per IP per minute (Firestore-backed).
- **Flag gate:** `flags.eventsRegister`.
- **Auth:** none.

### 6.2 `POST /api/events/register`

- **Input (Zod):** full `RegisterRequest` schema from `@cmt/shared-domain/events/api-contracts` — name, email, phone, adults, children, paymentMethod, isBvFamily, registrationId (pre-generated client-side with `MD26-XXXXXXX`), subtotal, processingFee, total, stripePaymentLink?, etransferReference?
- **Primary write:** `portalFirestore().collection('events').doc(campaign).collection('registrations').doc(registrationId).create(document)` — `create()` prevents duplicate IDs → 409 on conflict
- **Backup write:** Next.js `after()` dispatches a fire-and-forget `sendToGoogleSheet(payload)` call. Failures are logged but do not affect the response.
- **Output:** `{ success: true, registrationId }` on primary success, `{ error: 'duplicate' }` on 409, `{ error: 'firestore_unavailable' }` on 503.
- **Rate limit:** 5/IP/min.
- **Flag gate + no auth.**

### 6.3 `POST /api/events/lookup`

- **Input:** `{ registrationId, email }`
- **Behavior:** Firestore first (case-insensitive email comparison), fallback to Google Sheet Apps Script endpoint on Firestore miss or error. Returns `{ registration, paymentStatus }` or 404.
- **No rate limit.** (Matches standalone — it's a read-only lookup on a keyed ID, low abuse surface.)
- **Flag gate + no auth.**

### 6.4 `POST /api/events/create-checkout`

- **Input:** `{ lineItems, customerEmail, client_reference_id, successUrl, cancelUrl, metadata, branding_settings }`
- **Validation:**
  - Line item names must be one of Adults / Child / BV Family / Processing Fees
  - Server-side fee recalculation — recompute using `calculatePricing` from `@cmt/shared-domain/events/pricing`, compare to client-submitted `total` within 1¢ tolerance, reject on mismatch
  - Redirect URLs must match either the request's own origin OR a portal-domain allowlist regex (`cmt-portal-portal[a-z0-9-]*\.vercel\.app` or the production portal domain, plus `localhost:*` for dev)
  - Rate limit 5/IP/min via Firestore-backed limiter
- **Behavior:** on validation success, POST to `STRIPE_CHECKOUT_URL` with `Authorization: Bearer ${STRIPE_API_KEY}` header and the validated payload. Return the proxy's `{ checkoutUrl, sessionId }` verbatim.
- **Flag gate + no auth.**

### 6.5 `POST /api/events/update-reference`

- **Input:** `{ registrationId, email, etransferReference }`
- **Behavior:**
  - Read Firestore doc by `registrationId`
  - Compare stored email (case-insensitive) to submitted email — mismatch → 404
  - Merge `etransferReference` into the doc via `set({ etransferReference, updatedAt: now }, { merge: true })`
  - Fire-and-forget POST to Google Sheet with `action: "update_reference"`
- **Errors:** Firestore verify failure → 502 (don't allow writes on unverified reads); doc missing → 404.
- **No rate limit.** Email match is the ownership check.
- **Flag gate + no auth.**

### 6.6 `POST /api/events/update-payment-status`

- **Input:** strict `{ registrationId, paymentStatus: 'completed', payment_source: 'stripe' }` — any other enum value → 400
- **Behavior:** verify doc exists and stored `payment_source === 'stripe'` → merge `paymentStatus` + `updatedAt`. Non-Stripe doc → 400. Doc missing → 404.
- **Called from:** the `/events/register/success` page client-side after Stripe redirect.
- **Flag gate + no auth.**

### 6.7 `POST /api/events/webhooks/payment-status`

- **Input:** `{ registrationId, paymentStatus: 'pending'|'completed'|'failed'|'refunded', payment_source?: 'stripe'|'etransfer'|'unknown' }`
- **Auth:** `x-api-key` header compared with `timingSafeEqual` against `WEBHOOK_API_KEY`. Missing or wrong → 401.
- **Behavior:** read doc, merge new status + `updatedAt`, fire-and-forget Google Sheet update. Doc missing → 404.
- **NOT flag-gated.** Always live as long as the deploy is up, so in-flight webhooks aren't lost on a flag flip.
- **Env var name:** `WEBHOOK_API_KEY` — same as standalone, so Vaibhav's migration is URL-only.

## 7. Data model & shared-domain types

### 7.1 `packages/shared-domain/src/events/registration.ts`

```ts
export const PAYMENT_SOURCES = ['etransfer', 'stripe'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const REGISTRATION_PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
] as const;
export type RegistrationPaymentStatus =
  (typeof REGISTRATION_PAYMENT_STATUSES)[number];

export interface EventRegistration {
  registrationId: string;        // e.g. MD26-A1B2C3D
  campaign: string;              // e.g. 2026MothersDay
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  isBvFamily: boolean;
  payment_source: PaymentSource;
  contribution: number;          // dollars, to match standalone semantics
  etransferReference?: string;
  paymentStatus: RegistrationPaymentStatus;
  createdAt: number;             // ms since epoch (numeric for mobile parity)
  updatedAt: number;
}
```

### 7.2 `packages/shared-domain/src/events/pricing.ts`

```ts
import type { PaymentSource } from './registration';

export interface PricingInput {
  adults: number;
  children: number;
  isBvFamily: boolean;
  paymentMethod: PaymentSource;
  pricePerPerson: number; // default 10
}

export interface PricingResult {
  subtotal: number;
  processingFee: number; // 0 for etransfer, (subtotal*0.022 + 0.30) rounded to 2dp for stripe
  total: number;
}

export function calculatePricing(input: PricingInput): PricingResult;
```

Pure function, side-effect-free, identical to standalone's `utils.ts` logic. All 30+ test cases from standalone's `utils.test.ts` are ported verbatim into `__tests__/pricing.test.ts`.

### 7.3 `packages/shared-domain/src/events/api-contracts.ts`

Zod schemas and derived TS types for all seven routes. Every API route in `apps/portal/src/app/api/events/*` imports the relevant schema from here — no schema duplication. Example:

```ts
import { z } from 'zod';

export const checkBvStatusRequestSchema = z.union([
  z.object({ familyId: z.string().min(1) }),
  z.object({ email: z.string().email() }),
]);
export type CheckBvStatusRequest = z.infer<typeof checkBvStatusRequestSchema>;

export const checkBvStatusResponseSchema = z.object({
  isBvFamily: z.boolean(),
  familyEmails: z.array(z.string().email()).optional(),
  familyPhones: z.array(z.string()).optional(),
});
export type CheckBvStatusResponse = z.infer<typeof checkBvStatusResponseSchema>;

// ... similar for register, lookup, create-checkout, update-reference,
//     update-payment-status, webhook
```

### 7.4 Firestore document shape

Path: `events/{campaign}/registrations/{registrationId}`

```
name: string
email: string (lowercased for comparisons)
phone: string (normalized to 10-digit North American form)
adults: number
children: number
payment_source: 'stripe' | 'etransfer'
contribution: number (dollars; Stripe stores total WITH fee, e-Transfer stores subtotal)
isBvFamily: boolean
etransferReference: string | undefined
paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled'
createdAt: Firestore Timestamp (converted to number in TS layer)
updatedAt: Firestore Timestamp
```

**No composite index required.** All lookups are by document ID. `firestore.indexes.json` is not modified.

### 7.5 BV roster (RTDB) — no change

Uses the existing `findFamilyById` and `findFamilyByContact` helpers from `features/check-in/shared/rtdb/family-lookup.ts`. New sibling helper:

```ts
// features/events/shared/bv-contacts.ts
import type { Family } from '@cmt/shared-domain/check-in';

export interface FamilyContactSet {
  emails: string[];
  phones: string[];
}

export function collectFamilyContactSet(family: Family): FamilyContactSet;
```

Aggregates all eight contact fields (email, pemail, emergency_email, phone, phphone, pmphone, emergency_hphone, emergency_mphone), filters out NULL/empty/numeric-leftover values, normalizes phones to 10-digit form (strips leading `1` only for 11-digit numbers). All 26 test cases from the standalone's contact-validation tests are ported into `bv-contacts.test.ts`.

## 8. External integrations

### 8.1 Stripe (Cloud Run proxy)

- Portal `create-checkout` route POSTs to `STRIPE_CHECKOUT_URL` with `Authorization: Bearer ${STRIPE_API_KEY}` header.
- Portal submits its own-origin success/cancel URLs (e.g. `https://{portalDomain}/events/register/success?regId=...`).
- The Cloud Run proxy validates the redirect URLs against its allowlist. Until the allowlist is updated (out-of-scope, coordinated manually), portal-origin redirects are rejected.
- **Mitigation for slice C:** ship with `NEXT_PUBLIC_ENABLE_STRIPE=false` in Vercel Production; e-Transfer works unchanged. Allowlist update happens in parallel with the slice C cutover plan.

### 8.2 Google Apps Script (dual-write backup)

- `NEXT_PUBLIC_GOOGLE_SHEET_URL` points at the same Apps Script endpoint as the standalone.
- Both apps POST to it during parallel run. Apps Script's existing `action: create|update` logic de-dupes by `registrationId`.
- Portal helper `features/events/shared/google-sheets-sender.ts` exports `sendToGoogleSheet(payload)` — single place that knows the endpoint URL and the fire-and-forget discipline. All routes that need a backup write call this helper.

### 8.3 Firebase

- **Zero new setup.** Reuses `PORTAL_*` Admin SDK credentials for Firestore writes and `MASTER_*` Admin SDK for RTDB reads, both already initialized from slice B.
- No new service account, no new index, no new emulator config.

### 8.4 Webhook

- New URL: `POST /api/events/webhooks/payment-status`. Old URL (`chinmaya-event-registration.vercel.app/api/webhooks/payment-status`) continues to serve Vaibhav's admin tool throughout the slice's development and soak.
- Same `WEBHOOK_API_KEY` env var name → when Vaibhav migrates, he updates only the URL.
- Never flag-gated; always listens.

## 9. Environment variables

### 9.1 New variables added to `apps/portal/src/lib/env.ts`

**Public (`NEXT_PUBLIC_*`):**
- `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER` — flag string, default `'false'`
- `NEXT_PUBLIC_EVENT_CAMPAIGN` — default `'2026MothersDay'`
- `NEXT_PUBLIC_EVENT_DISPLAY_NAME` — e.g. `"Mother's Day 2026"`, optional
- `NEXT_PUBLIC_PRICE_PER_PERSON` — coerced number, default `10`
- `NEXT_PUBLIC_ENABLE_STRIPE` — flag string, default `'false'`
- `NEXT_PUBLIC_EVENT_POSTER_URL` — optional URL string
- `NEXT_PUBLIC_ETRANSFER_EMAIL` — email string, required when `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER === 'true'`
- `NEXT_PUBLIC_GOOGLE_SHEET_URL` — URL, required when flag is on

**Server-only:**
- `STRIPE_CHECKOUT_URL` — optional URL (required when `NEXT_PUBLIC_ENABLE_STRIPE === 'true'`)
- `STRIPE_API_KEY` — optional string (required when `NEXT_PUBLIC_ENABLE_STRIPE === 'true'`)
- `WEBHOOK_API_KEY` — required when `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER === 'true'`
- `EVENT_REGISTRATION_RATE_LIMIT_PER_MIN` — coerced number, default `5`

### 9.2 `.env.local` changes

The portal's `apps/portal/.env.local` gains the above variables. Values are copied from the standalone's `.env.local` where they already exist (campaign, price, poster URL, ETransfer email, Google Sheet URL, Stripe proxy URL, Stripe API key, webhook API key). `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=true` locally so the user can develop against it. `NEXT_PUBLIC_ENABLE_STRIPE=false` locally by default; developer flips it on when they want to exercise Stripe against the dev proxy.

### 9.3 Vercel environment

- **Preview:** mirror of `.env.local`, `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=true`, `NEXT_PUBLIC_ENABLE_STRIPE=false`
- **Production:** `NEXT_PUBLIC_FEATURE_EVENTS_REGISTER=false` on initial deploy. Flip to `true` when parallel run is approved. `NEXT_PUBLIC_ENABLE_STRIPE=false` until Cloud Run allowlist is updated, then flip to `true`.

## 10. Mobile readiness

- Every request and response shape lives in `@cmt/shared-domain/events/*`. React Native consumers import the same Zod schemas and TS types.
- JSON-only I/O on every user-facing route. No HTML, no redirects that assume a browser form submit.
- No cookies, no Bearer tokens, no session headers on any user-facing route. Mobile clients call them identically to the portal's own client.
- Rate limiter is IP-based (via Firestore doc keyed on IP + minute window). Works for mobile.
- Stripe integration is URL-based. Mobile app opens the `checkoutUrl` in an in-app browser or WebView and handles success/cancel redirects same as desktop. Future native Stripe SDK integration is a separate mobile concern that doesn't require changes to these routes.
- Webhook endpoint is back-office only and never called by mobile.
- Every API route gets an integration test that exercises it with plain `fetch` + JSON — passing those tests proves mobile compatibility.

## 11. Testing strategy

### 11.1 Unit tests

- `packages/shared-domain/src/events/__tests__/pricing.test.ts` — 30+ cases ported from standalone `utils.test.ts`
- `packages/shared-domain/src/events/__tests__/api-contracts.test.ts` — schema round-trips, rejection cases
- `apps/portal/src/features/events/shared/__tests__/bv-contacts.test.ts` — 26 cases ported from standalone's BV contact tests
- `apps/portal/src/features/events/shared/__tests__/firestore-adapter.test.ts` — Timestamp conversions, default paymentStatus, missing-field defaults
- `apps/portal/src/features/events/shared/__tests__/google-sheets-sender.test.ts` — mocked fetch, error swallowing
- Component tests for `CounterInput`, `StepIndicator`, `OrderSummary`, `SuccessBanner`, `CancelBanner`, `RegistrationForm`, `PaymentInstructions`

### 11.2 API route integration tests

One `route.test.ts` per endpoint, using `next-test-api-route-handler`:
- `check-bv-status`: family hit, non-family miss, Firebase error graceful degradation
- `register`: happy path, 409 duplicate, Zod rejection, 503 Firestore failure, Google Sheet fallback
- `lookup`: Firestore hit, case-insensitive email, Google Sheet fallback, 404
- `create-checkout`: valid request forwarding, fee recalculation mismatch rejection, redirect URL allowlist accept/reject, rate limit (5/min)
- `update-reference`: happy path, email mismatch 404, Firestore verify failure 502
- `update-payment-status`: Stripe happy path, non-Stripe rejection 400, non-completed rejection 400, doc missing 404
- `webhooks/payment-status`: missing API key 401, wrong API key 401, valid pending/completed/failed/refunded, doc missing 404

All tests call the routes via plain `fetch` — no cookies, no browser shimming — which also validates mobile compatibility.

### 11.3 Playwright e2e — `apps/portal/e2e/c-events.spec.ts`

- Flag-off variant: `/events/register`, `/events/register/payment`, `/events/register/success`, `/events/register/cancel` all return 404
- Flag-on variant:
  - Form renders, poster visible on desktop viewport, hidden on mobile viewport
  - Submit happy path (non-BV, e-Transfer) → Step 2 renders with correct order summary
  - Lookup banner → retrieves existing registration
- Webhook endpoint: POST without API key → 401, POST with valid API key → 200

## 12. Decomposition

**One slice, one plan, single push.** Rough task count ~14–16, comparable to slice B1 (kiosk) and slice B4 (admin). Not decomposed into sub-slices — the pieces are tightly coupled and parallel-running with the standalone provides an implicit safety margin during soak.

The implementation plan will break the work into numbered tasks with clear owners, dependencies, and TDD steps. Worker split in the team run: one worker on API routes + shared-domain + final push, one worker on components + pages + Playwright e2e. Rough parity with the B4 split (7 API-side tasks, 6 UI-side tasks, 2 closing tasks).

## 13. Acceptance criteria

1. User can submit a non-BV registration end-to-end via `/events/register` with e-Transfer payment method and receives a valid `registrationId` plus a Step 2 page with correct fee breakdown.
2. User can submit a BV-verified registration (Family ID or email lookup path) at flat $10 pricing.
3. User can retrieve an existing registration via the Step 1 lookup banner; the form pre-fills and jumps to Step 2.
4. User can add an e-Transfer reference number post-registration via Step 2; the update lands in Firestore and the Google Sheet.
5. Stripe checkout path returns a valid `checkoutUrl` (once Cloud Run allowlist permits; test with allowed dev/staging URLs during slice development).
6. `/events/register/success` calls `update-payment-status` and marks the Firestore doc `paymentStatus: 'completed'`.
7. `/events/register/cancel` preserves the stored Stripe payment link and offers a retry.
8. Webhook endpoint accepts valid payloads when the API key matches and rejects with 401 otherwise. Updates land in Firestore + Google Sheet.
9. All pages and all API routes (except the webhook) render/return 404 when `flags.eventsRegister === false`.
10. During parallel run, the standalone `chinmaya-event-registration` app and the portal's `/events/register` both read and write the same Firestore collection (`events/2026MothersDay/registrations/*`) with no conflicts.
11. Every `/api/events/*` route is callable with plain `fetch` + `@cmt/shared-domain/events` schemas, proving mobile-app compatibility.
12. Google Sheet dual-write continues for all mutating routes (`register`, `update-reference`, `update-payment-status`, webhook).
13. Full suite (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) passes via the pre-push hook on the final commit.
14. Playwright `c-events.spec.ts` passes at minimum its flag-off variant and the form-renders smoke test.
15. No banned dependencies introduced: `react-datepicker`, `react-hot-toast`, `react-phone-number-input`, `xlsx`, `redis`, `@headlessui`, or webpack Node module fallbacks.
16. The standalone `chinmaya-event-registration` app continues to serve real user traffic unchanged throughout slice C development and into the parallel-run soak period.

## 14. Risks & open questions

1. **Cloud Run Stripe proxy allowlist** — portal-origin redirects will fail until the allowlist is updated. Mitigation: ship with `NEXT_PUBLIC_ENABLE_STRIPE=false` in Vercel Production; e-Transfer path works from day one. User coordinates the Cloud Run update with Vaibhav post-slice-C, before flipping `NEXT_PUBLIC_ENABLE_STRIPE` on.
2. **Google Apps Script rate and concurrency limits** — during parallel run both apps hit the same Apps Script. Google caps at 6 min per execution and 30 concurrent. Low risk in practice; failures log visibly in Vercel Function logs for early detection.
3. **Firestore duplicate `registrationId` under parallel run** — extremely unlikely given 7-character random IDs, and `create()` catches the collision and returns 409 cleanly. Tested.
4. **sessionStorage fragility** — closing the tab mid-flow loses draft state, same as today. Not fixed; out of scope for functionality parity.
5. **Apps Script dual-write race during parallel run** — if both apps POST the same `registrationId` within milliseconds, the Apps Script may race. Mitigation: rely on Firestore `create()` to fail one write quickly so the Apps Script only sees the winner. Monitor during soak.
6. **Webhook cutover** — Vaibhav's admin tool migration is coordinated manually by the user after portal is deemed ready. Slice C ships the endpoint listening but not serving live admin traffic until the user says so.
7. **Landing page cutover** — outside slice C scope, but tracked: `chinmayatoronto.org`'s "register" link currently points at the standalone. When portal is ready for real users, the user flips that link to portal's `/events/register` URL.
8. **Feature boundary exception for RTDB family lookup helpers** — `features/events/*` needs `findFamilyById` / `findFamilyByContact`, which currently live in `features/check-in/shared/rtdb/`. The plan must either (a) promote them into `@cmt/shared-domain/check-in` (impossible if they import Firebase Admin), or (b) promote them into a new `packages/firebase-shared/src/rtdb/family-lookup.ts` module. The plan will decide and execute this refactor as its first task so both features can depend on a shared home.

## 15. Post-slice follow-ups (not in scope)

- **Slice C2 (optional):** admin registrations tab inside `/check-in/admin` — triggered only if Vaibhav's parallel-run feedback says the Google Sheet is inadequate.
- **Full Events system:** runtime campaign switching, event CRUD in admin, historical reports, cross-event stats — only if CMT is running multiple concurrent events within the same deployment.
- **Server-side session state:** replace sessionStorage with a Firestore-backed draft doc so refreshes and multi-device flows survive. Only if real user feedback shows it's needed.
- **Retire the standalone app:** when both apps have been running in parallel cleanly for a period defined by the user, and the landing page, webhook, and Cloud Run allowlist have been cut over, the user can decommission `chinmaya-event-registration`.

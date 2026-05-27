# Slice 3 Code Review — Donations Checkout + Receipts

**Date:** 2026-05-27  
**Reviewer:** Codex / RepoPrompt review workflow  
**Spec:** `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md`  
**Reviewed scope:** `4312fb1..HEAD` on `main` (`HEAD` at review time: `90114ab`)  
**Working tree at review time:** clean

## Summary

The committed range implements the Slice 3a/3b foundations: donation-period admin configuration, schemas, Firestore indexes, seed data, enrollment APIs, family enrollment UI wiring, and tests.

It does **not** implement the full Slice 3 donations checkout and CRA receipt scope. Stripe checkout, donation records, webhook handling, manual reconciliation, receipt PDF generation/storage/email, `/family/donations` real data, and admin/welcome donation queues remain unimplemented. Treat the current state as **3a/3b only**, not complete Slice 3.

## Must-fix before release

### 1. Enrollment routes users into unfinished donation UI

**Severity:** P0 / release blocker  
**Files:**
- `apps/portal/src/features/family/components/enroll-cta.tsx:52-54`
- `apps/portal/src/app/family/enroll/page.tsx:105-108`
- `apps/portal/src/app/family/enroll/page.tsx:210-213`
- `apps/portal/src/app/family/donate/page.tsx:1-176`

**Issue:**  
A successful enrollment shows `Enrolled! Continuing to donation.` and routes to `/family/donate?eid=...`. Already-enrolled families also see live `Continue to donation` links. However `/family/donate` is still a static prototype: hardcoded `$500`, hardcoded Brampton/Fall copy, no `eid` loading, no donation intent API, no mailing address capture, no payment submit, and disabled CTA.

**Required fix:**
- Until 3c+ ships, do **not** route users to `/family/donate` after enrollment.
- Gate the redirect/link behind `flags.setuDonations`, or replace it with an explicit “Your family is enrolled; donations are coming soon” state.
- When checkout ships, `/family/donate` must load enrollment by `eid` and use the enrollment snapshot/override for suggested amount.

### 2. Enrollment UI violates pricing snapshot invariant

**Severity:** P1  
**File:** `apps/portal/src/app/family/enroll/page.tsx:109,204`

**Issue:**  
The enrolled-family UI displays `activePeriod.suggestedAmount`. The spec requires the family-visible suggested amount to be pinned as:

```ts
suggestedAmountOverride ?? suggestedAmountSnapshot
```

If an admin later edits the period amount, or welcome-team applies a hardship override, `/family/enroll` displays the wrong amount.

**Required fix:**

```ts
const displaySuggestedAmount =
  activeEnrollment?.effectiveSuggestedAmount ?? activePeriod?.suggestedAmount;
```

Use that value in all Dakshina/suggested donation blocks. Add tests for:
- period amount changes after enrollment,
- welcome-team override wins over snapshot.

### 3. `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` exists but is not enforced

**Severity:** P1 / release blocker until intentional policy is documented  
**Files:**
- `apps/portal/src/lib/flags.ts:18`
- `apps/portal/src/app/api/setu/enrollments/route.ts:10,28`
- `apps/portal/src/app/api/admin/donation-periods/route.ts:14-100`
- `apps/portal/src/app/api/admin/donation-periods/[pid]/route.ts:11-69`

**Issue:**  
The spec says Slice 3 lands behind `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=false` until the whole donation lifecycle is ready. The flag is defined but not used. Donation-period admin APIs/UI and enrollment write flow are live under `setuAuth` only.

**Required fix:**
- Gate donation-specific pages and route handlers with `flags.setuDonations`, or document a deliberate staged policy.
- If enrollment must remain live before checkout, make the UX explicit and avoid any “continue to donation” route.
- Add tests asserting disabled-flag behavior.

### 4. Date conversion shifts Toronto enrollment windows

**Severity:** P1  
**Files:**
- `apps/portal/src/features/admin/donation-periods/periods-table.tsx:88,101`
- `apps/portal/scripts/seed-donation-periods.ts:25-31`

**Issue:**  
The admin UI converts `YYYY-MM-DD` with `new Date(date).toISOString()`, which means UTC midnight, not Toronto-local midnight. End dates become the start of the selected day and can close enrollment almost a day early in Toronto. The seed script also hardcodes `-04:00`, which is wrong during EST dates.

**Required fix:**
- Centralize helpers such as `toTorontoStartOfDay(date)` and `toTorontoEndOfDay(date)`.
- Use those helpers in admin payload creation and seed scripts.
- Add tests for EST dates and inclusive end-date behavior.

### 5. Donation-period creation is not atomic and `pid` is unsafe

**Severity:** P1/P2  
**File:** `apps/portal/src/app/api/admin/donation-periods/route.ts:66-75`

**Issue:**  
The handler derives `pid` from the raw label with only whitespace replacement, so labels containing `/` or other invalid/problematic characters can produce bad document paths or 500s. Creation also does check-then-`set()`, so concurrent creates for the same derived `pid` can both pass the existence check and last-write-wins.

**Required fix:**
- Add a strict slug helper: trim, lowercase, replace non `[a-z0-9-]`, collapse dashes, reject empty slugs.
- Use `periodRef.create(...)` and map already-exists to `409`, or use a Firestore transaction.
- Add tests for `Fall/2027`, punctuation, duplicate/concurrent create behavior.

## Should-fix / follow-up findings

### 6. Public webhook/cron bypasses exist before secure handlers

**Severity:** P1 before 3c/3d  
**File:** `packages/shared-domain/src/auth/public-routes.ts:50-56`

**Issue:**  
`/api/webhooks/stripe` and `/api/cron/archive-pledges` are public routes, but the corresponding signature/secret-verifying handlers are not implemented.

**Fix:**
- Remove these public routes until the handlers land, or
- Add placeholder handlers returning `404`/`501`, with tests documenting required Stripe signature and `CRON_SECRET` checks.

### 7. Donation API routes are authorized before they exist

**Severity:** P2  
**File:** `packages/shared-domain/src/auth/can-access-route.ts:95-101`

**Issue:**  
Middleware authorizes `/api/setu/donations/*`, but this range does not add the required handlers:
- `POST /api/setu/donations/intent`
- `GET /api/setu/donations`
- `GET /api/setu/donations/:did/receipt`
- `GET /api/setu/donations/zip?year=YYYY`

**Fix:**
- Remove the authorization branch until 3c/3e, or
- Add explicit `501 not-implemented` handlers so contract failures are obvious.

### 8. Welcome-team override endpoint does not match the spec

**Severity:** P2  
**File:** `apps/portal/src/app/api/welcome/enrollments/[eid]/route.ts:8-63`

**Issue:**  
The spec lists:

```http
PATCH /api/welcome/enrollments/:eid/override
```

The implementation exposes:

```http
PATCH /api/welcome/enrollments/:eid
```

**Fix:**
- Add `/override` as the canonical route or an alias, or update the spec/API docs and tests to reflect the shipped contract.

### 9. GET enrollment handler should validate session role defensively

**Severity:** P2  
**File:** `apps/portal/src/app/api/setu/enrollments/route.ts:10-19`

**Issue:**  
`GET /api/setu/enrollments` only reads `x-portal-fid`. Middleware gates access, but the project pattern is middleware plus handler-level authorization.

**Fix:**
- Use `readSessionFromHeaders(req)`.
- Require `isSetuFamily(session)`.
- Use `session.fid` instead of trusting a raw header.

### 10. Full checkout/receipts implementation remains missing

**Severity:** P0 if claiming full Slice 3 completion  
**Spec refs:**
- `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md:12-21`
- `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md:329-579`

**Missing pieces:**
- `DonationDoc` schema and donation write/read paths.
- Stripe dependencies and `POST /api/setu/donations/intent`.
- Stripe webhook handler with signature verification and idempotency.
- e-Transfer/cheque pledge flow and welcome-team reconciliation queue.
- Cron archive for expired pledges with `CRON_SECRET` verification.
- Receipt counter transaction and receipt number generation.
- PDF generation with `@react-pdf/renderer`.
- Firebase Storage upload / signed URL re-generation.
- Receipt email template/SES send path.
- Real `/family/donations`, `/welcome/donations`, `/admin/donations` UIs.
- Env validation and turbo passthroughs for Stripe, receipt storage, pledge TTL, and cron secret.

**Fix:**
- Treat current state as 3a/3b only.
- Keep `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=false` until 3c-3f are implemented and UAT-walked.
- Do not announce or release as “donations checkout + CRA receipts complete.”

## Verification recommended after fixes

- Run unit tests for changed route handlers and schemas.
- Run e2e tests against UAT Firestore for donation-period CRUD and enrollment flow.
- Manually walk:
  1. admin creates period,
  2. family sees active period,
  3. manager enrolls,
  4. already-enrolled state uses pinned snapshot/override,
  5. no route enters unfinished checkout while donations flag is off.
- Before flipping donations on, complete the spec’s mock-free UAT walkthrough for Stripe, webhooks, receipt PDF, email delivery, and receipt re-download.

## Open questions

1. Is the current delivery intentionally only sub-slices 3a/3b? If yes, update docs/release notes accordingly.
2. Should enrollment be allowed before checkout is live, or should all enrollment/donation-period surfaces stay gated by `NEXT_PUBLIC_FEATURE_SETU_DONATIONS`?
3. If enrollment remains live early, what should the post-enrollment family UX say until payment/receipts are implemented?

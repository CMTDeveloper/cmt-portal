# Slice 2 — Setu Auth + Family Registration API (Implementation Plan)

**Date:** 2026-05-22
**Status:** Ready to execute (pending user go-ahead)
**Design spec:** [`2026-05-22-slice-2-setu-auth-family-api-design.md`](../specs/2026-05-22-slice-2-setu-auth-family-api-design.md)
**Owner:** CMT Developer

---

## How to use this plan

Each sub-slice is a self-contained vertical: schema → API → wiring → tests → commit. TDD: write the failing test first, run it red, implement until green, commit. Each commit ends with `pnpm typecheck && pnpm lint && pnpm test` clean (the pre-push hook will enforce this anyway).

Sub-slices sequenced by hard dependency:
```
2a (OTP auth) ─┬─► 2b (registration + dedupe) ─┬─► 2c (family CRUD) ─┬─► 2d (invite)
               │                                │                     │
               └─► 2e (welcome search) ◄────────┴─────────────────────┘
                                                │
                                                └─► 2f (bulk legacy migration)
```

2a is the hard prerequisite — everything else needs sessions. 2e and 2f can run in parallel with 2c/2d after 2b lands.

---

## Sub-slice 2a — OTP auth wiring

**Goal:** A real user can hit `/sign-in`, enter email or phone, receive a 6-digit code, enter it, and end up signed in at `/family` (or redirected to `/register` if no family exists yet).

**Estimated effort:** 2–3 days.

### Files to create

- `packages/shared-domain/src/setu/index.ts` — barrel export
- `packages/shared-domain/src/setu/session-claims.ts` — extended `SessionClaims` with `family-manager`, `family-member`, `welcome-team` roles
- `packages/shared-domain/src/setu/__tests__/session-claims.test.ts`
- `apps/portal/src/features/setu/auth/find-family-by-contact.ts` — Setu-side lookup against `contactKeys/{hash}` with legacy fallback
- `apps/portal/src/features/setu/auth/__tests__/find-family-by-contact.test.ts`
- `apps/portal/src/app/api/setu/auth/send-code/route.ts`
- `apps/portal/src/app/api/setu/auth/send-code/__tests__/route.test.ts`
- `apps/portal/src/app/api/setu/auth/verify-code/route.ts`
- `apps/portal/src/app/api/setu/auth/verify-code/__tests__/route.test.ts`
- `apps/portal/src/app/api/setu/auth/signout/route.ts`
- `apps/portal/src/app/api/setu/auth/signout/__tests__/route.test.ts`

### Files to modify

- `packages/shared-domain/src/auth/session-claims.ts` (or whatever holds the existing `SessionClaims`) — widen the role union; add `fid`, `mid` (optional)
- `packages/shared-domain/src/auth/can-access-route.ts` — accept new roles; `/family/*` allowed for `family-manager` + `family-member`; `/welcome/*` only for `welcome-team`
- `packages/shared-domain/src/auth/public-routes.ts` — move `/family`, `/family/` OUT (now auth-gated); add `/api/setu/auth/send-code`, `/api/setu/auth/verify-code`, `/api/setu/auth/signout` IN
- `apps/portal/src/middleware.ts` — redirect target: if pathname matches `/family/*` and no session, redirect to `/sign-in` (NOT `/login`). Other paths (`/check-in/*`) keep redirecting to `/login`.
- `apps/portal/src/app/sign-in/page.tsx` — wire to real send-code; add OTP entry state; "Use phone instead" toggle
- `apps/portal/src/lib/env.ts` — add `SETU_OTP_TTL_MIN`, `SETU_OTP_RATE_LIMIT_PER_MIN`, `NEXT_PUBLIC_FEATURE_SETU_AUTH`

### TDD test list

1. `session-claims.test.ts`:
   - Zod schema parses each role variant
   - `family-manager` requires `fid` and `mid`
   - `welcome-team` does not require `fid`
2. `find-family-by-contact.test.ts`:
   - Returns Setu family when `contactKeys/{hash}` exists
   - Falls back to legacy `findFamilyByContact` when no Setu hit
   - Returns null when neither hit
3. `route.test.ts` for `send-code`:
   - Accepts `{ type: 'email', value }` → calls SES sender
   - Accepts `{ type: 'phone', value }` → calls SNS sender
   - Returns 200 even when contact not found (no enumeration)
   - Rate-limited returns 429 with `resetAt`
   - Feature-flag-gated returns 404 when `NEXT_PUBLIC_FEATURE_SETU_AUTH=false`
4. `route.test.ts` for `verify-code`:
   - Correct code → sets session cookie, returns redirect path
   - Wrong code → 400, no cookie set
   - Expired code → 410 gone
   - Verified existing family → redirect `/family`
   - Verified, no family found → redirect `/register?contact=verified`
5. `route.test.ts` for `signout`:
   - Clears `__session` cookie
   - 303 → `/`

### Acceptance gates

- Manual: hit `/sign-in`, enter the user's own email, receive a code via SES, enter it, land at `/family`.
- All new tests green.
- `pnpm typecheck && pnpm lint && pnpm test` clean.

---

## Sub-slice 2b — Family registration + dedupe

**Goal:** A new user without a family record can register, and a contact already attached to a family triggers the dedupe panel.

**Estimated effort:** 3–4 days.

### Files to create

- `packages/shared-domain/src/setu/schemas/family.ts` — zod for `FamilyDoc`
- `packages/shared-domain/src/setu/schemas/member.ts` — zod for `MemberDoc`
- `packages/shared-domain/src/setu/schemas/contact-key.ts` — zod for `ContactKeyDoc` + `hashContactKey()`
- `packages/shared-domain/src/setu/__tests__/schemas.test.ts`
- `apps/portal/src/features/setu/registration/register-family.ts` — the transactional family-create helper
- `apps/portal/src/features/setu/registration/lazy-migrate.ts` — promotes a legacy family to Setu on first verify
- `apps/portal/src/features/setu/registration/__tests__/register-family.test.ts`
- `apps/portal/src/features/setu/registration/__tests__/lazy-migrate.test.ts`
- `apps/portal/src/app/api/setu/family-lookup/route.ts` + tests
- `apps/portal/src/app/api/setu/register/route.ts` + tests
- `apps/portal/src/app/api/setu/family/join/route.ts` + tests
- `firestore.indexes.json` — append composite indexes for `families.searchKeys` and `contactKeys.contactKey`

### Files to modify

- `apps/portal/src/app/register/page.tsx` — debounced `/family-lookup` on field blur, real submit
- `apps/portal/src/app/register/family/page.tsx` — real submit to `/api/setu/register`; surface zod errors server-to-client
- `apps/portal/src/app/api/setu/auth/verify-code/route.ts` — call `lazyMigrate(legacyFid)` when a legacy hit + no Setu doc

### TDD test list

1. `schemas.test.ts`:
   - Each schema accepts/rejects fixtures
   - `hashContactKey('email', 'Foo@Bar.com')` === `hashContactKey('email', 'foo@bar.com')` (case-insensitive normalize)
   - `hashContactKey('phone', '(416) 555-2204')` === `hashContactKey('phone', '+14165552204')`
2. `register-family.test.ts`:
   - Atomic transaction creates family + N members + M contactKeys
   - Fails atomically if contactKey already exists for a different family
   - Generated `fid` matches expected format
3. `lazy-migrate.test.ts`:
   - Reads legacy roster, maps fields, writes Setu family with `legacyFid` populated
   - Idempotent — second invocation on same legacy family is a no-op
   - Members inherit grade / contact fields from legacy parent/student rows
4. API route tests for `family-lookup`, `register`, `family/join`:
   - Happy paths
   - Race condition simulated (same email registered twice concurrently → second errors)
   - Rate-limiting on lookup endpoint
5. Wire-up tests for `register/page.tsx`:
   - Typing `raj.patel@gmail.com` shows the match panel after lookup
   - Typing a fresh email + phone enables the "Continue" button
   - Submit posts to `/api/setu/register` and navigates to `/family`

### Acceptance gates

- Manual: register a brand-new family (Patel-2). Confirm Firestore docs present.
- Manual: register with same email as an existing family → dedupe panel.
- All tests green.

---

## Sub-slice 2c — Family CRUD

**Goal:** Signed-in manager can read their family + add/edit/remove members. Member view is read-only.

**Estimated effort:** 2–3 days.

### Files to create

- `apps/portal/src/app/api/setu/family/route.ts` (GET) + tests
- `apps/portal/src/app/api/setu/members/route.ts` (POST) + tests
- `apps/portal/src/app/api/setu/members/[mid]/route.ts` (PATCH, DELETE) + tests
- `apps/portal/src/features/setu/members/last-manager-guard.ts` + tests

### Files to modify

- `apps/portal/src/app/family/page.tsx` — server-fetch family + members, replace mock
- `apps/portal/src/app/family/members/page.tsx` — same
- `apps/portal/src/app/family/members/[mid]/page.tsx` — lookup by `mid`; 404 if not in user's family
- `apps/portal/src/app/family/members/new/page.tsx` — real POST to `/api/setu/members`
- Add `apps/portal/src/app/family/members/[mid]/edit/page.tsx` — new edit screen (reuses add-member layout)
- `apps/portal/src/features/family/data/mock.ts` — keep for fallback when `NEXT_PUBLIC_FEATURE_SETU_AUTH=false`, otherwise dead code

### TDD test list

1. `last-manager-guard.test.ts`:
   - Removing the only manager is rejected
   - Demoting the only manager is rejected
   - Removing one of two managers succeeds
2. API route tests:
   - GET `/family` requires session, returns 401 otherwise
   - GET `/family` returns only the user's own family (cross-family access denied)
   - POST `/members` requires manager role
   - PATCH `/members/:mid` allows self-edit for non-managers
   - DELETE `/members/:mid` rejects non-managers
3. UI integration:
   - `/family/members/[mid]` 404s for mid not in user's family

### Acceptance gates

- Manual: as manager, add a 3rd child; PATCH their grade; DELETE; restore.
- All tests green.

---

## Sub-slice 2d — Invite flow

**Goal:** A manager can invite a co-manager via email; the invitee clicks the link, signs in via OTP, and is added to the family.

**Estimated effort:** 1–2 days.

### Files to create

- `apps/portal/src/lib/aws/templates/setu-invite-email.tsx` (React Email or plain HTML — match the existing template pattern under `src/lib/aws/templates/`)
- `apps/portal/src/app/api/setu/invite/send/route.ts` + tests
- `apps/portal/src/app/api/setu/invite/[token]/route.ts` (GET for invite metadata) + tests
- `apps/portal/src/app/api/setu/invite/accept/route.ts` + tests

### Files to modify

- `apps/portal/src/app/invite/[token]/page.tsx` — server-fetch invite metadata; real `Accept & join` button
- `apps/portal/src/app/family/members/page.tsx` — wire the "Invite a co-manager" CTA (mobile) and the "Invite co-manager" button (desktop) to a modal or new screen that posts to `/api/setu/invite/send`

### TDD test list

1. `send/route.test.ts`:
   - Requires manager role
   - Generates token, stores Firestore doc with 14-day expiry
   - Calls SES sender with invite template
2. `accept/route.test.ts`:
   - Requires signed-in user
   - Verifies token not expired, not already accepted
   - Verifies user's verified-contact email matches invite email
   - Creates member doc with `manager: true`
   - Marks invite accepted
3. Edge cases: expired token (410), already-accepted (409), email-mismatch (403)

### Acceptance gates

- Manual: manager invites a co-manager; co-manager receives email, opens link, signs in, accepts.

---

## Sub-slice 2e — Welcome-team family search

**Goal:** A welcome-team user can search families by name / email / phone / new FID / legacy FID and open a read-only family detail.

**Estimated effort:** 2–3 days.

### Files to create

- `apps/portal/src/app/api/setu/family/search/route.ts` + tests
- `apps/portal/src/app/welcome/page.tsx` — minimal welcome dashboard with search bar
- `apps/portal/src/app/welcome/error.tsx`
- `apps/portal/src/app/welcome/family/[fid]/page.tsx` — read-only family detail
- `apps/portal/src/features/setu/search/search-families.ts` + tests

### Files to modify

- `packages/shared-domain/src/auth/public-routes.ts` — `/welcome` and `/welcome/family/:fid` are NOT public; they require welcome-team role
- `packages/shared-domain/src/auth/can-access-route.ts` — gate `/welcome/*` and `/api/setu/family/search` on `welcome-team`
- `apps/portal/src/features/family/components/atoms.tsx` — extend `DesktopSidebar` to accept a `role` prop; welcome-team gets a different nav (Search / Pending / Donation periods placeholder)

### TDD test list

1. `search-families.test.ts`:
   - Search by exact email finds family via contactKey
   - Search by phone normalizes then finds via contactKey
   - Search by new FID exact match
   - Search by legacy FID exact match (e.g. `4421`)
   - Search by partial name (case-insensitive prefix on `searchKeys`)
   - Dedupes by fid when multiple hits
   - Returns top 20
2. Route tests:
   - 403 for non-welcome-team
   - 200 with hits for welcome-team

### Acceptance gates

- Manual: log in as welcome-team user (manually grant role via Firebase admin). Search by legacy FID 4421. Find the Patel family. Open detail.

---

## Sub-slice 2f — Bulk legacy migration

**Goal:** A script can pre-populate Setu families from the legacy RTDB roster before launch.

**Estimated effort:** 1–2 days.

### Files to create

- `apps/portal/scripts/migrate-legacy-families.ts`
- `apps/portal/scripts/__tests__/migrate-legacy-families.test.ts`
- `docs/superpowers/specs/2026-XX-legacy-fid-migration-runbook.md` — operational runbook (date when written)

### Files to modify

- `package.json` (apps/portal) — add `migrate:legacy-families` npm script

### TDD test list

1. Migration script tests with fixture RTDB data:
   - Dry-run produces CSV without Firestore writes
   - Real run creates families + members + contactKeys
   - Idempotent: second run skips already-migrated families
   - Skipped families logged with reason (e.g. malformed legacy row)

### Acceptance gates

- Dry-run against UAT against fixture; review CSV.
- Real run against UAT, then spot-check 5 families in Firestore.
- Production rehearsal documented in runbook.

---

## Cross-cutting workstreams (do during 2a)

These touch the design CSS / shadcn primitives and should land before the API work blocks UI changes:

- Install missing shadcn primitives the v3 brief flagged (`badge`, `tabs`, `select`, `checkbox`, `radio-group`, `tooltip`, `popover`, `dropdown-menu`, `table`) — needed for the form UX in 2b/2c (e.g., real grade picker, payment method radio).
- Update `apps/portal/src/features/family/components/atoms.tsx` exports if any new atom needed (mostly: `OtpEntry`, `Toast`/`Sonner` wrapper).
- Add a global `<Toaster />` mount in root layout — currently absent but needed for error toasts on form submission.

---

## Sequencing diagram (calendar view)

```
Day 1-3     ████████████  2a OTP auth
Day 4-6                ███  shadcn primitives + Toaster mount (parallel)
Day 4-7                  ████████████  2b registration + dedupe
Day 8-10                              ████████  2c family CRUD
Day 10-11                                     ██████  2d invite
Day 11-13                                           ██████  2e welcome search (can start day 9 once 2b done)
Day 13-14                                                 ██████  2f bulk migration
```

Total: ~14 calendar days of focused work, or ~3 calendar weeks with normal pace + reviews.

---

## Out-of-scope reminders (for this slice)

- Donations checkout, Stripe / e-Transfer, tax-receipt PDFs → Slice 3
- Teacher views, take-attendance, kiosk migration → Slice 4
- Admin CMS (announcements, donation periods, email templates editor) → Slice 4 or 5
- Legacy `/check-in/*` decommissioning → Slice 5 (after kiosk cutover)
- Photo galleries / event recaps → post-launch

---

## Definition of done for Slice 2

- [ ] All six sub-slices merged to `main`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] Manual happy-path validation against UAT (`chinmaya-setu-uat`):
  - Sign up as new family
  - Sign in as existing family (Setu doc present)
  - Sign in as legacy family (no Setu doc) → lazy migration → land in /family
  - Add / edit / remove members
  - Invite + accept co-manager
  - Welcome-team search by all 5 criteria
- [ ] Bulk migration dry-run against UAT produces sensible CSV
- [ ] Project memory updated: replace [[project-2026-redesign]] note about Slice 2 "next" with "Slice 2 ✅ landed, Slice 3 next"
- [ ] CLAUDE.md status block updated

# Slice 3b — Enrollment Workflow: Review

**Sub-slice:** 3b  
**Status:** Shipped to `main` (commits 3318e36 → 5edc557)  
**Owner:** backend-eng-2

---

## What shipped

### Schemas (`packages/shared-domain`)

`packages/shared-domain/src/setu/schemas/enrollment.ts` — re-exports `LOCATIONS`/`PROGRAM_KEYS` from `donation-period.ts` (no duplication). Exports:
- `EnrollmentDoc` + `EnrollmentDocSchema`
- `PostEnrollmentBodySchema` (family-initiated: `{ pid }`)
- `WelcomePostEnrollmentBodySchema` (welcome-team: `{ fid, pid }`)
- `OverrideEnrollmentBodySchema` (`{ suggestedAmountOverride: number | null }`)
- `ResolveActivePeriodParams` (used by the server helper)

### Firestore indexes (`firestore.indexes.json`)

- `enrollments` COLLECTION — `status ASC, enrolledAt DESC` (family dashboard query)
- `enrollments` COLLECTION_GROUP field override — `eid ASC` (welcome-team override PATCH lookup)

Deploy to UAT only: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (never `--force`, never prod).

### Feature helpers (`apps/portal/src/features/setu/enrollment/`)

| File | Purpose |
|---|---|
| `enroll-family.ts` | Core idempotent enrollment transaction |
| `get-enrollments.ts` | Fetches enrollments + joins period doc + computes `effectiveSuggestedAmount` |
| `resolve-active-period.ts` | Server-only helper for `/family/enroll` page — finds latest-start-date active enabled period for (location, programKey) |
| `enroll-on-first-attendance.ts` | Slice 4 export — wraps `enrollFamily` with `enrolledVia: 'first-attendance'` |

### API routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/setu/enrollments` | any setu family | Returns `{ enrollments: EnrollmentDoc & { effectiveSuggestedAmount, period } }` |
| POST | `/api/setu/enrollments` | family-manager | Idempotent; returns 201 (created) or 200 (already active) |
| DELETE | `/api/setu/enrollments/[eid]` | family-manager | Sets `status: 'cancelled'`; cross-family guard (`eid.startsWith(fid)`) |
| POST | `/api/welcome/enrollments` | welcome-team / admin | Enroll on behalf with `enrolledVia: 'welcome-team'` |
| PATCH | `/api/welcome/enrollments/[eid]` | welcome-team / admin | Sets `suggestedAmountOverride` (positive int or null to clear) |

### Tests

`apps/portal/src/app/api/setu/__tests__/enrollment-integration.test.ts` — 35 tests, all passing.

Coverage includes:
- GET: empty array, effectiveSuggestedAmount from snapshot, override wins over snapshot
- POST: 201 on create, 200 on idempotent re-enroll, snapshot invariant assertion, 404 period-not-found, 422 period-disabled, 422 period-expired, 403 non-manager, 401 unauthenticated, 400 bad body
- DELETE: 200 cancel, 404 not-found, 409 already-cancelled, 403 cross-family, 403 non-manager
- Welcome POST: 201 created, 200 idempotent, 403 wrong role, 400 bad body
- Welcome PATCH override: 200 set, 200 clear null, 404 not-found, 409 not-active, 403 wrong role, 400 negative amount

---

## Key invariants

**Snapshot pinning.** `suggestedAmountSnapshot` is written inside the same Firestore transaction that reads `donationPeriods/{pid}`. If admin later edits `suggestedAmount` on the period, this family's snapshot never changes. `effectiveSuggestedAmount = suggestedAmountOverride ?? suggestedAmountSnapshot`.

**Idempotency.** `eid = {fid}-{pid}` is deterministic. POST with the same `(fid, pid)` pair when enrollment is already `active` returns 200 with the existing snapshot — no write occurs.

**Transaction read order.** `Promise.all([period, enrollment, family])` runs first; the members subcollection query runs after the early-exit checks (period-not-found, period-disabled, period-expired, already-active). This keeps the happy-path txn lean.

**Cross-family guard on DELETE.** The middleware injects `x-portal-fid` from the session; the route checks `eid.startsWith(fid + '-')` before entering the transaction. A manager cannot cancel another family's enrollment even if they guess the eid.

---

## Post-deploy verification (UAT)

1. Deploy indexes: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`
2. Sign in as a family-manager in UAT (`/sign-in`).
3. `POST /api/setu/enrollments` with a valid `pid` from a seeded donation period → expect 201 + `{ eid, suggestedAmount, donateUrl }`.
4. Repeat the same POST → expect 200 (idempotent).
5. `GET /api/setu/enrollments` → enrollment appears with `effectiveSuggestedAmount` matching the period's `suggestedAmount`.
6. Edit the period's `suggestedAmount` in Firestore Console. Re-fetch GET → `suggestedAmountSnapshot` unchanged (snapshot invariant confirmed).
7. Sign in as welcome-team. `PATCH /api/welcome/enrollments/{eid}` with `{ suggestedAmountOverride: 300 }` → GET shows `effectiveSuggestedAmount: 300`.
8. Clear override: PATCH with `null` → GET shows `effectiveSuggestedAmount` reverts to snapshot.
9. `DELETE /api/setu/enrollments/{eid}` as family-manager → 200. GET shows `status: 'cancelled'`.

---

## What's NOT in 3b

- Donation payment flow (3c — Stripe)
- Manual reconciliation queue (3d)
- Tax receipt PDF generation (3e)
- `/family/enroll` page wiring (T18 — frontend-eng)
- E2E tests against real UAT Firestore (T20 — qa-tester)
- `enrollFamilyOnFirstAttendance` call site (Slice 4 — teacher attendance)

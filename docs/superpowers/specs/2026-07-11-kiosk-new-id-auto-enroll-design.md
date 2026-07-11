# Kiosk new-ID lookup + auto-enroll - Design

**Status:** Draft (awaiting review)
**Date:** 2026-07-11
**Author:** CMT Developer (with Claude)

## Goal

Let the portal check-in kiosk recognize a family's **new 4-digit Family ID** (`publicFid`), and when a recognized family (or their child, via teacher attendance) is not yet enrolled in the current Bala Vihar year, **auto-enroll them** (unpaid, all eligible children).

## Decisions locked (owner, 2026-07-11)

1. **Where it lives:** the **portal's own check-in kiosk** (this repo, `features/check-in/*`) - NOT the standalone `chinmaya-family-check-in` app. The portal already has the Setu families, `publicFid`, and `enrollFamily()`; the standalone legacy app has none of these. This is the planned kiosk-cutover surface.
2. **Auto-enroll behavior:** create an **active** current-year Bala Vihar enrollment with the suggested donation left **outstanding** (no charge; family is nudged to pay later), enrolling **all eligible children** at once - exactly what `enrollFamily()` already does.
3. **Kiosk authentication (owner, 2026-07-11):** the check-in endpoint is **authenticated, not public**. A dedicated least-privilege `kiosk` role + a generic kiosk account (email/password) is signed into the tablet once via the existing password sign-in; the session cookie authorizes check-ins. This gives auth, attribution, and revocability, and (because `canAccessRoute` is deny-by-default) keeps the shared public tablet from reaching the roster/admin/PII. Trade-offs: it is a shared credential, and Firebase's hard 14-day session-cookie cap means the tablet re-signs-in at most every 2 weeks.

## Architecture reality (why this shape)

Two systems, two data models:

- **Legacy check-in world** (RTDB `roster` + Firestore `check_in_events`/`family-check-ins`, project `chinmaya-setu-715b8`): families keyed by the **legacy numeric id**; no `publicFid`, no enrollment concept. The portal kiosk today resolves the entered number here via `findFamilyById()` (`features/check-in/shared/rtdb/family-lookup.ts:33`, RTDB) and writes `check_in_events` (`app/api/check-in/families/[familyId]/check-in/route.ts`).
- **Setu world** (Firestore `families/*`, project `chinmaya-setu-uat` today): `publicFid` (4-digit, `schemas/family.ts:62`), `legacyFid` (`:53`), and enrollments (`families/{fid}/enrollments/{eid}`). `enrollFamily()` lives at `features/setu/enrollment/enroll-family.ts:34`.

`publicFid` and "enrolled" are **Setu concepts only**. So the kiosk must resolve the entered id against the **Setu** database and enroll there.

### Hard prerequisite (environment / timing)

Setu families (with `publicFid` + enrollments) live in **UAT** today and are **not announced** in prod; the prod door still uses the legacy roster. Therefore:

- This feature is **built and verified entirely in UAT** (`chinmaya-setu-uat`), per the standing "UAT only, never touch prod `715b8`" rule.
- Going live in prod is part of the eventual **kiosk cutover** (`NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK`), gated separately - out of scope here.

## Scope

### In scope

1. **Setu-aware kiosk resolver.** Given the number a sevak/family enters, resolve a **Setu** family: try `publicFid` (`families.where('publicFid','==',id).limit(1)`), then fall back to `legacyFid` (`where('legacyFid','==',id).limit(1)`). Return the Setu family (`CMT-` fid, members/children) when found. (Single-field equality queries - **no new composite index**; `searchFamilies` already runs these shapes.)
2. **Auto-enroll on kiosk check-in.** When a resolved Setu family has **no active current-year Bala Vihar enrollment**, call `enrollFamily({ fid, oid, enrolledVia: 'kiosk', enrolledByMid: null })`. The BV offering `oid` comes from `getOpenOfferingsForFamily('bala-vihar', family.location)[0]` (`features/setu/enrollment/get-open-offerings.ts:86`). Idempotent (re-check-in of an already-enrolled family is a no-op - `enrollFamily` returns `created:false`). Payment stays a separate donations concern; the enrollment is created unpaid.
3. **New `enrolledVia` value `'kiosk'`.** Extend the enum at `packages/shared-domain/src/setu/schemas/enrollment.ts:22` (currently `'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion'`) so kiosk-driven enrollments are attributable in reports.
4. **Dedicated `kiosk` role + generic kiosk account (decision #3).** Add `'kiosk'` to `ROLES` (`packages/shared-domain/src/auth/role.ts:1`) + an `isKiosk` helper + the `Capability` union (`apps/portal/src/lib/auth/role-claims.ts`); seed a generic kiosk account (email/password) via a new UAT-only `seed:kiosk-account` script (mirrors `seed-test-accounts.ts`). The endpoint is gated to `isKiosk || isAdmin`, not public.
5. **Teacher-attendance auto-enroll (verify existing).** The portal already auto-enrolls a non-enrolled child marked present via the guest → `enrollFamilyOnFirstAttendance()` path (`features/setu/enrollment/enroll-on-first-attendance.ts:17`, called from `features/setu/teacher/guests.ts:57`, `enrolledVia: 'first-attendance'`). This is gated behind `NEXT_PUBLIC_FEATURE_SETU_TEACHER` (`middleware.ts:74-83`). Scope here is to **confirm** it covers "any non-enrolled child" and **verify** it in UAT with the flag on - not to rebuild it.
6. **Deployed-UAT E2E** with a realistic fixture: a migrated family that has a `publicFid` but **no** BV enrollment → check in by the new id → assert an active BV enrollment now exists for its eligible children.

### Out of scope / non-goals

- Any change to the standalone `chinmaya-family-check-in` app.
- Prod rollout / kiosk cutover flag flip.
- Charging or collecting the donation at the kiosk (enrollment is unpaid; existing donation nudges apply).
- Changing how `check_in_events` attendance is written (the kiosk's existing check-in write is unchanged; auto-enroll is an added step, not a replacement).
- Per-child kiosk enrollment (owner chose all-eligible-children).

## Design detail

### Resolver

A new server helper, e.g. `resolveSetuFamilyByAnyId(id): { family, source: 'publicFid' | 'legacyFid' } | null`, in `features/setu/*` (reused by the kiosk lookup + check-in routes). Order: `publicFid` first (the id we want families to adopt), then `legacyFid`. `publicFid` uniqueness is not DB-enforced, so use `.limit(1)` and treat a hit as authoritative (the sequential allocator makes collisions unlikely; note it as a known limitation).

### Kiosk wiring

The kiosk number entry (`features/check-in/kiosk/family-id-lookup-form.tsx`) routes to a Setu resolve path. When a Setu family is found, the check-in flow (a) shows the family/children and (b) on submit, records the check-in **and** performs the auto-enroll step before/after writing the check-in event. The new endpoint lives at `/api/check-in/setu/*`, is `flags.checkInKiosk`-gated, and requires the `kiosk` session (decision #3) - `canAccessRoute` gates it to `isKiosk || isAdmin`; it is NOT added to `public-routes.ts`.

### Auto-enroll step

```
family = resolveSetuFamilyByAnyId(enteredId)
if (family && !hasActiveBvEnrollment(family)) {
  oid = getOpenOfferingsForFamily('bala-vihar', family.location)[0]?.oid
  if (oid) enrollFamily({ fid: family.fid, oid, enrolledVia: 'kiosk', enrolledByMid: null })
}
```

`enrollFamily` throws `no-eligible-members` for an adult-only family - caught and ignored (nothing to enroll). If no open BV offering exists, skip silently (log).

## Data / contract changes

- **Enum extension** `enrolledVia += 'kiosk'` touches a `@cmt/shared-domain` schema consumed by `/api/setu/enrollments`. Append a `MOBILE_API_CHANGELOG.md` entry (the mobile app mirrors enrollment shapes).
- **No new Firestore indexes** (single-field equality on `publicFid`/`legacyFid`; offering + enrollment queries already indexed).
- **No migration / backfill** (reads existing migrated families; writes only new enrollment docs).
- **Runbook:** add a §14 entry noting the new `'kiosk'` enrolledVia value + the UAT-only, cutover-gated nature.

## Verification

- Unit: resolver (publicFid hit, legacyFid fallback, miss); auto-enroll decision (already-enrolled → no-op, adult-only → skip, no-offering → skip).
- Deployed-UAT E2E (realistic, multi-child, ACTIVE fixture) per the project's E2E discipline - the integration layer (Firestore, offering resolution, enrollment txn) is where these bugs live.
- Manual UAT walkthrough: enter a migrated family's new 4-digit id at the kiosk → confirm resolve + a new BV enrollment; enter their old legacy id → same family resolves; teacher marks a non-enrolled child present → child's family auto-enrolls.

## Risks / open questions

1. **`publicFid` non-uniqueness** - not DB-enforced. `.limit(1)` + sequential allocator makes this low-risk; flagged, not solved here.
2. **Kiosk check-in identity** - `check_in_events` is currently keyed by the entered id. Once the kiosk resolves to a Setu family, we should key attendance/check-in by a stable Setu id for consistency; the plan will decide whether to key by `legacyFid` (bridges existing dashboards) or the `CMT-` fid.
3. **Teacher path breadth** - confirm the first-attendance auto-enroll fires for *any* non-enrolled child, not only those explicitly added as "guests."

# Multi-Program Foundation — Design

**Sub-spec ① of the multi-program system.** Date: 2026-05-30. Status: approved design, pending implementation plan.

## 1. Context & motivation

The original product requirement treats every offering at the Mission as an independent **Program** — Bala Vihar, Tabla, Dance, OM Chanting, Gita Chanting, special workshops/events. Each program may have its own enrollment requirements, attendance rules, donation structure, age restrictions, schedule/calendar, communications, and participant roles. Families enroll in one, several, or all. Bala Vihar (BV) is the **reference model and the only go-live focus**; the platform must be flexible enough to add the rest.

The codebase is already partly program-aware: `DonationPeriodDoc`, `EnrollmentDoc`, `LevelDoc`, and `classCalendarEntries` all carry `programKey` / `programLabel`. But `PROGRAM_KEYS` is a frozen single-value enum (`['bala-vihar']`), there is no `programs` entity, and ~39 `'bala-vihar'` literals across 11 files assume one program. So this work is mostly **making an existing dimension dynamic and adding a Program entity**, not building a new dimension from scratch.

### Decomposition (the full multi-program effort)

This is too large for one spec. It is split into four sub-specs, each with its own spec → plan → build cycle:

- **① Program foundation** — *this document*. The `programs` entity, dynamic `programKey`, admin program CRUD, generalized offerings/enrollment, minimal family enrollment. The reference model for the rest.
- **② Family multi-program enrollment UX** — the polished "Explore programs" catalog, discovery, cross-program management, family-nav restructure.
- **③ Attendance generalization** — unify on the shared `family-check-ins` collection (no duplication) for non-BV programs.
- **④ Per-program communications** — per-program announcements/emails over the existing AWS SES pipeline.

### Sequencing (constraint)

This foundation is a real data-model refactor (collection rename, field renames, enum → dynamic). BV's **2026-27 prod launch is imminent (enrollment opens 2026-06-15)**. Therefore this foundation **lands after BV go-live is stable in prod**, so the refactor never threatens the launch. All work and migration are **UAT-only** (`chinmaya-setu-uat`) until then; BV is not yet announced to families. When prod cutover happens, the prod seed includes the `programs` model from day one (BV as the first program).

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Term model | **Mixed** — `term` (yearly like BV), `one-time` (workshop/event), `rolling` (open-ended) |
| Eligibility | **Per-program rules** — member type (`child`/`adult`/`any`) + optional age range; enforced at enroll |
| Location | **Per-location + location-less** — `location` optional throughout (online programs like Gita have none) |
| Architecture | **A — generalize what exists**: `programs` entity + capability flags + reuse/rename `donationPeriods` → `offerings` + dynamic `programKey` |
| Recurrence | A Program is a **stable, reusable definition**; per-year runs are **Offerings**. Admins reuse a program and add ~2–3 offerings/year |
| Admin IA | **Hybrid** — `/admin/programs` hub (program CRUD + per-program Offerings); Levels & Calendar stay global pages with program+location filters |
| Family scope (this sub-spec) | Generalized dashboard + parameterized `/family/enroll/[programKey]` + minimal eligible-programs list; rich catalog deferred to ② |

## 3. Data model

### 3.1 New collection: `programs/{programKey}`

```
programKey       string    slug, immutable, /^[a-z0-9-]+$/  ('bala-vihar', 'tabla', 'gita-chanting')
label            string    'Bala Vihar'
shortDescription string    one-line, for the catalog card
status           'active' | 'draft' | 'archived'   // draft + archived are hidden from families
locations        Location[]                         // [] = location-less / virtual (online)
termType         'term' | 'one-time' | 'rolling'
eligibility      {
                   memberType: 'child' | 'adult' | 'any',
                   minAgeYears?: number | null,
                   maxAgeYears?: number | null
                 }
capabilities     {
                   usesOfferings:  boolean,   // has enrollable terms (almost always true)
                   usesDonation:   boolean,   // offerings carry pricing/dakshina
                   usesLevels:     boolean,   // class levels + teacher assignment
                   usesCalendar:   boolean,   // published class calendar
                   attendanceMode: 'none' | 'check-in' | 'teacher'
                 }
displayOrder     number
createdAt, createdBy, updatedAt, updatedBy
```

Notes:
- `eligibility` is the **coarse** program gate. BV's **fine-grained grade-bands stay at the level** (`LevelDoc.gradeBand`, shishu month-age) — program eligibility decides who *can* enroll; levels still place children precisely.
- `attendanceMode` is **stored but not behaviorally wired** in this sub-spec beyond BV's existing check-in read (sub-spec ③ wires it).

### 3.2 Rename + generalize `donationPeriods` → `offerings/{oid}`

The current period doc is already "a term with pricing." Generalize it into the **universal enrollable offering**:

```
oid           string                    (was pid)
programKey    string                    // dynamic
programLabel  string
location      Location | null           // null = location-less
termLabel     string                    (was periodLabel)  '2025-26' | 'Spring 2026'
termType      'term' | 'one-time' | 'rolling'   // mirrors the parent program (denormalized for queries)
startDate     Date
endDate       Date | null               // null = rolling/open-ended; one-time = same day as start
pricingTiers  PricingTier[]             // OPTIONAL/empty when the program is free (usesDonation=false)
amountTiers   number[]?                 // optional give-more chips
paymentSource 'portal' | 'legacy'?      // optional, defaults 'portal'
enabled       boolean
createdAt, createdBy, updatedAt, updatedBy
```

Changes vs today: `location` nullable; `endDate` nullable; `pricingTiers` optional; `periodLabel`→`termLabel`; add `termType`; collection name `donationPeriods` → `offerings`.

### 3.3 `enrollment` (light, BV-compatible)

- `childrenMids` → **`enrolledMids`** (any eligible member, not just children)
- `pid` → **`oid`**; add denormalized **`programKey`**
- add **`location: Location | null`**
- `suggestedAmountSnapshot` / `suggestedAmountOverride` only meaningful when the program `usesDonation`
- uniqueness is per **`(fid, oid)`** — a family may hold concurrent enrollments in different offerings of the same program (e.g. Spring *and* Fall OM Chanting)

### 3.4 `levels` / `classCalendarEntries`

- `programKey` enum → dynamic string
- `location` becomes `Location | null`
- otherwise unchanged

### 3.5 Firestore indexes

- `offerings`: `(programKey ASC, location ASC, startDate DESC)` for resolution; mirror the existing `donationPeriods` composite shape. Add to `firestore.indexes.json`; deploy to UAT (never `--force` to prod).
- Confirm enrollment/levels/calendar indexes still satisfy queries after the field renames.

## 4. Dynamic `programKey`

- Replace `z.enum(PROGRAM_KEYS)` everywhere with `z.string().regex(/^[a-z0-9-]+$/)`.
- Existence/active validation moves to the **service layer** (zod can't do async DB lookups):
  - `getProgram(key): Promise<ProgramDoc | null>` — cached via `'use cache'` + a `programs` / `program-${key}` cacheTag (same pattern as `getFamilyByFid`), revalidated on program CRUD.
  - `assertProgramActive(key)` — used by offering-create, enroll, etc.; rejects unknown/`draft`/`archived` programs for family-facing actions.
- `PROGRAM_KEYS` constant is removed; any remaining need for "the BV key" uses a named constant `BALA_VIHAR = 'bala-vihar'`.

## 5. Offering resolution

- Replace `resolveActivePeriod({programKey, location})` (returns one) with **`getOpenOfferings({programKey, location?})`** returning **all** enabled offerings currently open for enrollment: `enabled && (endDate == null || now <= endDate)`, ordered by `startDate`.
- With multiple concurrent runs the family is shown the list and **picks the run** ("OM Chanting · Spring 2026" vs "· Fall 2026"). When exactly one is open (BV's usual case), the UX auto-selects it so **BV feels identical**.
- **`enabled` is the admin's "enrollment-open" switch** — resolution does *not* gate on `startDate`, so an admin can pre-create next year's offering (left disabled) and flip `enabled` exactly when enrollment should open, including before the term starts (advance registration for workshops). This keeps BV identical: BV's current offering is enabled, so it resolves just as `resolveActivePeriod` did.
- **Deferred / flagged future** (noted, not built): per-offering **capacity/seat limits**, and a separate **enrollment window** (`enrollOpensAt`/`enrollClosesAt`) distinct from the term window. Foundation treats "enabled + within term window" as enrollable.

## 6. Migration (UAT-only)

A script following the existing ops-script conventions: **idempotent, `--dry-run`, refuses to run unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'`** (override `--allow-prod`), with a `pnpm` alias in `apps/portal/package.json`.

1. **Seed** `programs/bala-vihar`: label "Bala Vihar", `locations` = all 4 centers, `termType: term`, `eligibility {memberType: child}`, `capabilities {usesOfferings, usesDonation, usesLevels, usesCalendar: true, attendanceMode: 'check-in'}`, `status: active`, `displayOrder: 0`.
2. **Copy** `donationPeriods/*` → `offerings/*` (`periodLabel`→`termLabel`, set `termType: 'term'`, keep `programKey`/`location`/window/pricing).
3. **Migrate** `enrollment` docs (`childrenMids`→`enrolledMids`, `pid`→`oid`, add `programKey: 'bala-vihar'`, `location` copied).
4. `levels` / `classCalendarEntries`: schema relaxation only (data already `'bala-vihar'`).

All reads repoint `donationPeriods` → `offerings`. **BV behaves identically post-migration** — verified by regression tests + a mock-free walkthrough.

## 7. Admin UX (hybrid IA)

- **`/admin/programs`** — programs list (status, capability badges, display order, **+ New program**) and a **program editor** form for the full `ProgramDoc` (label, description, locations multi-select, termType, eligibility, capability toggles, `attendanceMode`, status, display order). `draft` lets an admin fully configure a program before families see it.
- **Per-program Offerings** under the hub: the renamed periods table scoped to the program, with a **"Duplicate offering"** action that clones the previous run (dates shifted, pricing carried) — directly serving the reuse-annually pattern.
- **Levels** and **Calendar** stay **global pages** (`/admin/levels`, `/admin/calendar`) gaining a **program selector** alongside the existing location filter; capability flags hide them for programs that don't use them.
- The `/admin` landing tiles gain a **Programs** entry. All new/changed screens follow the established mobile card + bottom-nav patterns.

## 8. Family UX (foundation scope)

1. **Dashboard generalized** — the hardcoded "Bala Vihar" card becomes **a card per active enrollment across all programs** (program label, term, status; attendance/donation shown only per that program's capabilities). BV looks identical; a new program's card appears once enrolled.
2. **Parameterized enroll** — `/family/enroll` → `/family/enroll/[programKey]`: shows the program's **open offerings** (`getOpenOfferings` → pick the run), **eligible members** (filtered by `eligibility`), "what's included," and the **dakshina step only when `usesDonation`** (free programs just confirm). BV runs through this as `programKey='bala-vihar'`, unchanged in feel.
3. **Minimal eligible-programs list** — a family-facing list of active programs the family is eligible for with an open offering, each linking to its enroll page.

Enrollment is per `(fid, offering)` with `enrolledMids`, so a family can enroll an adult in Gita and a child in BV, or join both Spring and Fall runs of one program.

**Deferred to ②:** the polished "Explore programs" catalog, eligibility-aware browsing/recommendations, cross-program management views, and the mobile family-nav restructure ("Bala Vihar" tab → "Programs").

## 9. Backward compatibility & testing

- **BV identical:** after migration, BV enroll/donate/dashboard/calendar/levels behave exactly as shipped. This is the acceptance bar.
- **TDD** per repo discipline: schema tests for `ProgramDoc` + generalized offering/enrollment; unit tests for `getProgram`/`assertProgramActive` and `getOpenOfferings` (multi-offering case); migration script idempotency/dry-run/prod-refusal.
- **Regression:** existing BV / enrollment / donation-period tests stay green after the rename, repointed to `offerings`. E2E (`enrollments`, `donation-periods`) updated.
- **Mock-free UAT walkthrough:** create a "Test Tabla" program (adult eligibility, online/no-location, one offering), enroll an adult, confirm its dashboard card; then re-run BV enroll + Stripe donate to prove BV is unchanged.

## 10. Scope boundaries

**In this sub-spec:** `programs` entity; dynamic `programKey`; `donationPeriods`→`offerings` generalization; enrollment generalization; admin Programs hub + per-program offerings + program-filtered levels/calendar; generalized family dashboard + parameterized enroll + minimal program list; UAT migration; BV regression.

**NOT in this sub-spec (own specs):**
- Attendance behavior for new programs — ③ (`attendanceMode` stored only; shared `family-check-ins` design lives there).
- Per-program communications — ④.
- Rich family catalog/discovery + family-nav restructure — ②.
- **Flagged future:** per-offering capacity/seat limits; separate enrollment windows; participant roles beyond the existing teacher assignment.

# Lazy `publicFid` minting (Model Y2) - Design

**Date:** 2026-07-14
**Status:** Draft (awaiting review)
**Author:** CMT Developer (via Claude Code)
**Related:** `docs/superpowers/plans/2026-06-24-fid-mid-renumber.md`, `docs/superpowers/specs/2026-07-11-kiosk-new-id-auto-enroll-design.md`, `docs/runbooks/production-cutover-checklist.md` §6/§14

## 1. Context

The portal gives every family a human-friendly `publicFid` (a sequential number starting at 5001, distinct from the internal `CMT-…` doc key `fid`). Today the ID is minted **eagerly**: the UAT cutover bulk-migrated all 881 legacy families into Setu and renumbered every one into the 5001+ band. Prod has **not** been touched yet - the bulk migrate + renumber are still pending cutover steps.

Vaibhav raised the question directly (WhatsApp, 2026-07-13/14):

> "Are you assigning every family the new ID or only when enrollment? I think we should only during the enrollment."
> "We truly have only around active 300-500 families and with all the legacy families they're in thousands - lots of stale info we don't want to carry forward."
> "Only the portal is technically real-time while teacher and self check-in could be queued... So lock vs queue."

Two nested questions:
1. **Eager vs lazy** - pre-assign the ID to all ~864 families, or mint only when a family engages?
2. **If lazy → lock vs queue** - enrollment fires from multiple routes; how do we mint safely?

## 2. Decision

**Lazy minting, lock-based (idempotent Firestore transaction), Model Y2.**

- A family's `publicFid` is minted **only at enrollment**, at a single funnel point: `enrollFamily()`.
- The family **record** still enters Setu lazily - on first sign-in, first kiosk touch, or teacher add - but with `publicFid: null` until they enroll. **Stale families that never engage never enter Setu and never get an ID.**
- **Prod cutover skips** the bulk `migrate-legacy-families` + `renumber:public-ids`. Families arrive lazily.
- **Welcome roster stays Setu-only** for now (a legacy-roster lookup is a deferred fast-follow).

### 2.1 Why lock, not queue

At 300-500 active families, new-family mints happen only on a family's *first-ever* enrollment; after the opening wave the rate approaches zero. Even a pessimistic first-Sunday burst is a small fraction of Firestore's ~1 write/sec single-document soft ceiling on the `counters/familyPublicId` doc, and Firestore transactions auto-retry through contention. A durable queue (with a consumer, eventual-consistency semantics, and failure handling) would solve a throughput bottleneck that does not exist at this scale - textbook over-engineering. The existing counter transaction **is** the lock; it is correct and battle-tested.

### 2.2 Why Y2 (defer the ID, keep the record) over Y (nothing until enrollment)

`fid` (internal `CMT-…` doc key from `generateFid()`) and `publicFid` (the user-facing number) are **separate fields** on the family doc (`packages/shared-domain/src/setu/schemas/family.ts:62`). This lets us defer the *ID* without deferring the *record*. Vaibhav's ask is specifically about "the new ID," so:

- **Y2** mints the `publicFid` only at enrollment while a lightweight record is created on first touch. `/family` keeps working unchanged; cross-route dedup gets *easier* (the record + its `legacyFid` + `contactKeys` exist early, so no route can double-create a family). Stale families still never enter Setu. Least code, least risk.
- **Y** (no record at all until enrollment) is a purer literal match but needs a new legacy confirm-and-enroll flow plus handling a no-record session state for legacy families, with harder dedup - more scope and failure surface for a purity gain that does not change what Vaibhav asked for.

Y2 was chosen.

## 3. Current state (code-backed)

- **Schema already supports this.** `publicFid: z.string().nullable().optional()` (`family.ts:62`). Doc schemas validate on read; pre-mint docs read as `undefined`. **No schema change needed.**
- **`enrollFamily()` is the single enrollment funnel** (`src/features/setu/enrollment/enroll-family.ts:34`, runs in a Firestore transaction). All four enroll routes go through it:
  - Portal family-initiated - `POST /api/setu/enrollments` (`enrolledVia:'family-initiated'`)
  - Welcome-team - `POST /api/welcome/enrollments` (`'welcome-team'`)
  - Kiosk auto-enroll - `autoEnrollBalaVihar` → `enrollFamily` (`'kiosk'`)
  - First-attendance - `enrollFamilyOnFirstAttendance` → `enrollFamily` (`'first-attendance'`), invoked from the teacher guest flow
- **Three creation sites mint `publicFid` eagerly today** and must stop:
  - `register-family.ts:84,154` (net-new portal registration)
  - `lazy-migrate.ts:79,195` (legacy family, first sign-in)
  - `pending-family.ts:65,108` (teacher "add student"; this path does NOT enroll - the mint happens later at first-attendance)
- **Every `publicFid` reader is already null-safe.** `displayFid()` = `publicFid ?? fid`; API serializers use `?? null`; kiosk resolve and welcome search are multi-field with fallbacks; `report-dataset.ts` coerces non-strings to null. **No 500 risk from null.** (One UX exception - see §4.3.)
- **The kiosk resolves from Setu only.** `resolveKioskFamily` (`resolve-kiosk-family.ts:28`) queries `families` by `legacyFid` then `publicFid`, returning `null` on miss. It has **no** legacy-roster fallback - under lazy, a legacy family whose first touch is the door would not be found. This is the one real gap (Part B).
- **`lazyMigrateLegacyFamily(legacyFid)`** (`lazy-migrate.ts`) already reads the legacy roster (`fetchLegacyFamilyForMigration`), is idempotent (legacyFid pre-check + in-txn recheck), and lives in the same `features/setu/` domain the kiosk can import from. It is the exact primitive for Part B.

## 4. Design

### 4.1 Part A - Defer the mint to `enrollFamily()`

**Add an idempotent get-or-mint** to `enrollFamily()`. Because `allocateFamilyPublicId()` opens its own transaction and Firestore forbids nested transactions, the mint follows the established pre-allocate pattern the codebase already uses in `registerFamily`/`lazyMigrate`:

1. **Before** opening the enroll transaction, read the family doc once. If it exists and has no `publicFid`, pre-allocate one via `allocateFamilyPublicId()` (its own txn). Do **not** pre-allocate when the family already has a `publicFid` - re-enrollments and multi-program families must not burn IDs (the 5001-9999 band is bounded).
2. **Inside** the enroll transaction, re-read the family (this already happens). If it still has no `publicFid`, `txn.update(familyRef, { publicFid: preAllocated })`. If a concurrent enrollment already set one (TOCTOU), keep the existing value and let the pre-allocated ID go unused (a harmless gap, matching the documented behavior of the other allocation sites).

This mints exactly once, at the first enrollment, idempotently, for all four enroll routes.

**Remove `publicFid` allocation + write** from the three creation sites (`register-family.ts`, `lazy-migrate.ts`, `pending-family.ts`). They now create the family doc with `publicFid` absent. `allocateMemberPublicIds` is unchanged (member IDs remain minted at member creation - out of scope).

### 4.2 Part B - Kiosk migrate-on-miss

When `resolveKioskFamily` misses in Setu, the entered number may be a **legacy** family not yet migrated (their first touch is the door). Add a migrate-on-miss step:

- On a Setu miss, treat the entered id as a `legacyFid` and call `lazyMigrateLegacyFamily(id)` inside a try/catch. On success (the legacy roster had it), re-resolve from Setu and continue. On "Legacy family not found", return `null` (genuinely unknown number) exactly as today.
- The migrate creates the record + members **without** a `publicFid` (Part A). The subsequent `autoEnrollBalaVihar` → `enrollFamily` mints it. So the door flow for a brand-new legacy family is: enter legacy id → migrate record (no ID) → record check-in → auto-enroll → **mint `publicFid`**. This matches Vaibhav's "during the first week, mark attendance along with check-in → generate the new ID."

**Where the migrate fires:** in the check-in **lookup** step (`GET /api/check-in/setu/lookup`), so that the two-step kiosk flow has stable Setu member IDs (`mid`) to display and to submit against. `lazyMigrateLegacyFamily` is idempotent, so a repeated lookup is a no-op, and a lookup that never proceeds to check-in leaves only a harmless record with no `publicFid` (not enrolled). Recording a write in the lookup GET is a deliberate, documented tradeoff, chosen over the alternative (read-only legacy display in the lookup, migrate in the POST) because the alternative forces synthetic legacy member IDs in the lookup that would not match the real Setu `mid`s created at check-in.

### 4.3 Part C - Family dashboard null-`publicFid` state

`displayFid()` falls back to the internal `CMT-…` id when `publicFid` is null. That is fine for internal/admin surfaces but wrong for a **family-facing** ID card - a signed-in, not-yet-enrolled legacy family must not see "CMT-A1B2C3D4" as their Family ID.

The family dashboard ID card (`/family`) renders a null-aware state when `publicFid` is absent: a short nudge - "Your Family ID is assigned when you enroll" with the enroll CTA - instead of the internal id. Other `displayFid()` consumers (welcome family detail, roster, members page - all internal/admin) are unchanged; showing the `CMT-` id or a blank there is acceptable.

### 4.4 Cross-identity dedup (correctness)

The risk under lazy is a single real family creating two Setu records via two identities (legacyFid vs contactKey). Y2 largely closes this: the record + its `legacyFid` link + its `contactKeys` are written at first touch (sign-in / kiosk / teacher), so every later route resolves to the existing family. `lazyMigrateLegacyFamily` (legacyFid) and `registerFamily`/`upsertPendingFamilyChild` (contactKey) both already guard against duplicate creation. This design adds no new identity key. During planning, verify that the register path links a legacy family to its `legacyFid` (rather than creating a fresh record) so the kiosk cannot later mint a second family for the same people; close any gap found.

### 4.5 Prod cutover changes

The prod cutover **no longer runs** `migrate-legacy-families --allow-prod` or `renumber:public-ids --allow-prod` (runbook §6 steps 2 & 5). Families migrate lazily on first engagement; `publicFid`s are minted at enrollment. Update the runbook (§6 sequence + a dated §14 entry) to reflect the lazy model and remove the eager bulk steps from the prod path. UAT is already eagerly migrated and is left as-is.

## 5. Non-goals / deferred

- **Welcome-roster legacy fallback** - the roster/reports show active (in-Setu) families. Finding an un-migrated legacy family from the welcome desk is a separate fast-follow (the kiosk already pulls them in on first check-in).
- **A queue** for any enrollment route - explicitly rejected (§2.1).
- **Un-migrating UAT** - UAT stays eager; lazy paths are tested with fresh non-migrated test families (§6).
- **Member ID (`publicMid`) timing** - unchanged; minted at member creation.

## 6. Testing strategy

Unit and integration tests ship in the same commits as the logic:

- **`enrollFamily` mint**: mints `publicFid` when the family has none; is idempotent (a second enrollment does not re-mint or change it); does not allocate when one already exists (assert no counter advance for an already-minted family). N=2: a family enrolling in a second program keeps its original `publicFid`.
- **Creation sites**: `registerFamily`, `lazyMigrateLegacyFamily`, `upsertPendingFamilyChild` create the family with `publicFid` absent.
- **Kiosk migrate-on-miss**: a legacy id not yet in Setu resolves via `lazyMigrateLegacyFamily`; an unknown number still returns `null`.
- **Dashboard**: null `publicFid` renders the nudge, not the `CMT-` id.

**Deployed-UAT E2E** (the discipline that catches integration/cache/index bugs mocks miss): because UAT is fully eager-migrated, seed a **fresh legacy-only test family present in the RTDB snapshot but absent from Setu UAT**, then walk the real flow on `cmt-setu.vercel.app`: (a) first sign-in / kiosk touch → record exists, `publicFid` null, dashboard shows the nudge; (b) enroll → `publicFid` minted and shown; (c) re-enroll into a second program → same `publicFid`. Auth via cookie injection, never form password typing. Clean up the seeded family afterward.

## 7. Mobile API contract

`publicFid` can now be **null** in `/api/setu/dashboard` (and any `/api/setu/*` response returning it) for a signed-in family that has not yet enrolled; it becomes non-null after their first enrollment. The mobile app already tolerates null via its own `?? null` handling, but this is a semantic change to when the field is populated. **Append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md`** describing it (mobile: treat a null `publicFid` as "not yet enrolled"; display the enroll nudge rather than a placeholder id).

## 8. Risks & mitigations

- **A family reaches `/family` with no `publicFid`** - handled by Part C (nudge, no `CMT-` leak).
- **ID burned on a rare concurrent first-enrollment race** - acceptable; the bounded 5001-9999 band has ample headroom at 300-500 families, and only genuine concurrency on a never-enrolled family wastes one ID.
- **Kiosk lookup writing on GET** - deliberate, idempotent (§4.2); documented in the route.
- **Double-family via cross-identity** - closed by early record+key creation and existing dedup guards (§4.4); verified during planning.
- **Runbook drift** - the cutover checklist must be updated in the same slice (§4.5), per the standing keep-runbook-current rule.

## 9. File touch list (for planning)

- `src/features/setu/enrollment/enroll-family.ts` - add pre-read + pre-allocate + in-txn conditional mint.
- `src/features/setu/registration/register-family.ts` - remove `publicFid` allocation + write.
- `src/features/setu/registration/lazy-migrate.ts` - remove `publicFid` allocation + write.
- `src/features/setu/teacher/pending-family.ts` - remove `publicFid` allocation + write.
- `src/features/setu/check-in/resolve-kiosk-family.ts` and/or `src/app/api/check-in/setu/lookup/route.ts` - migrate-on-miss.
- Family dashboard ID card component under `src/app/family/` - null-`publicFid` nudge state.
- `docs/runbooks/production-cutover-checklist.md` - lazy cutover, §14 entry.
- `apps/portal/docs/MOBILE_API_CHANGELOG.md` - null-`publicFid` semantics entry.
- Tests alongside each of the above; one deployed-UAT E2E spec under `e2e/`.

No schema change; no new Firestore index (all lookups are single-field equality or existing composites).

# Enrollment Engagement Criteria ("Registered" vs "Enrolled") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The family dashboard shows **Enrolled** only when the family has attended ≥1 Bala Vihar class that year OR made a completed donation toward that year's BV enrollment; otherwise an amber **Registered** pill with a confirm-nudge and a donate CTA (mobile + desktop).

**Architecture:** Derived state — enrollment docs, the `status` enum, and every `status === 'active'` consumer stay untouched. A pure predicate (`isEnrollmentConfirmed`) runs over data the dashboard loader supplies: an attendance count from the existing (currently orphaned) `getFamilyBalaViharAttendance` helper + the family's donations + the legacy-paid flag. The model exposes a three-state `bvState`; web/mobile UI and the dashboard API render it; welcome roster + enrollment report derive the same label.

**Tech Stack:** Next.js 16 App Router, TypeScript (`exactOptionalPropertyTypes`), Firestore Admin, Vitest, Playwright (deployed-UAT `setu` project).

**Spec:** `docs/superpowers/specs/2026-07-02-enrollment-engagement-criteria-design.md` (approved 2026-07-02).

## Global Constraints

- Enrollment docs are NOT written — no schema change, no migration, no new status value. `status: ['active','cancelled']` stays.
- The rule applies to ALL `enrolledVia` values. Any completed donation (any amount) with `eid === enrollment.eid` confirms; for a legacy-sourced offering, `legacyPaid` also confirms. Attendance = present or late, within the enrollment's offering window, from teacher events (oid-scoped) ∪ door check-ins (window-scoped) — exactly what `getFamilyBalaViharAttendance` already computes.
- `isEnrolled` keeps its current meaning everywhere (active BV record exists). New branching uses `bvState: 'enrolled' | 'registered' | 'none'`.
- Mobile contract: additive only. `GET /api/setu/dashboard` → `balaVihar.bvState`. Dated, SHA-keyed entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md` in the same commit as the API change.
- No new Firestore indexes (audit any query you add — none of the planned reads need one: existing helpers only).
- All-families aggregation (enrollment report) uses BULK collectionGroup reads joined in memory — never per-family fan-out (the roster-CSV 45s timeout lesson). The roster page may use per-row reads (20/page, existing pattern).
- `exactOptionalPropertyTypes` is on — never assign `undefined` to an optional; emit `null` in JSON.
- Nudge copy, verbatim: `Attend your first class or complete your donation to confirm enrollment.`
- UAT project only (`chinmaya-setu-uat`); never prod; never `--force` on index deploys.
- Per-task gates: focused vitest while iterating, and before EVERY commit: the touched-package suite + `pnpm --filter @cmt/portal typecheck`. `pnpm --filter @cmt/portal lint` only globs `src/` — if you touch `scripts/**` or `e2e/**`, run `cd apps/portal && pnpm exec eslint <file>` on those files directly.
- Commit author `CMT Developer <developer@chinmayatoronto.org>` (repo-local config). Do not push unless the controller says to (pre-push gate runs the full suite).

## File map

| File | Role |
|---|---|
| `apps/portal/src/app/family/_helpers/enrollment-confirmation.ts` | NEW — pure `isEnrollmentConfirmed` predicate |
| `apps/portal/src/app/family/_helpers/dashboard-model.ts` | `bvAttendedCount` input; `bvState`; 3-state pill; nudge/CTA flags |
| `apps/portal/src/app/family/_helpers/load-dashboard.ts` | compute `bvAttendedCount` via `getFamilyBalaViharAttendance`; use the `members` param |
| `apps/portal/src/app/family/page.tsx` | mobile nudge + Give CTA; desktop nudge (registered state) |
| `apps/portal/src/app/api/setu/dashboard/route.ts` | `balaVihar.bvState` |
| `apps/portal/src/features/setu/roster/*` + `apps/portal/src/app/api/welcome/reports/[kind]/route.ts` | Confirmed/Registered on welcome surfaces |
| `apps/portal/scripts/seed-e2e-family.ts` + `apps/portal/e2e/setu/enrollment-state.spec.ts` | deterministic fixture + deployed-UAT E2E |
| Tests | `apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts` (new), `.../dashboard-model.test.ts` (extend), dashboard route test (extend) |

---

### Task 1: `isEnrollmentConfirmed` pure predicate

**Files:**
- Create: `apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`
- Test: `apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts` (new file, next to `dashboard-model.test.ts`)

**Interfaces:**
- Consumes: `EnrollmentWithOffering` from `@/features/setu/enrollment/get-enrollments`; `DonationDoc` from `@cmt/shared-domain`.
- Produces (Tasks 2+ depend on this exact signature):
```ts
export interface ConfirmationInputs {
  /** present+late marks inside the enrollment's offering window (0 when unknown). */
  attendedCount: number;
  /** ALL of the family's donations (any program). */
  donations: DonationDoc[];
  /** True when a legacy-sourced BV offering is already paid in the legacy roster. */
  legacyPaid: boolean;
}
export function isEnrollmentConfirmed(
  enrollment: Pick<EnrollmentWithOffering, 'eid'>,
  inputs: ConfirmationInputs,
): boolean;
```

- [ ] **Step 1: Write the failing test.** Look at `apps/portal/src/app/family/__tests__/dashboard-model.test.ts` first and reuse its `DonationDoc` fixture shape (build a `makeDonation` local helper if that file has one; otherwise construct minimal objects and cast). Test file:

```ts
import { describe, it, expect } from 'vitest';
import { isEnrollmentConfirmed } from '../_helpers/enrollment-confirmation';
import type { DonationDoc } from '@cmt/shared-domain';

const bv = { eid: 'FAM1-bv-brampton-2026-27' };

function donation(over: Partial<DonationDoc>): DonationDoc {
  return {
    eid: 'FAM1-bv-brampton-2026-27',
    status: 'completed',
    amountCAD: 25,
  } as unknown as DonationDoc;
  // NOTE to implementer: if DonationDoc has required fields this cast hides,
  // copy the full fixture shape from dashboard-model.test.ts instead — the
  // assertions below are what matter.
}

describe('isEnrollmentConfirmed', () => {
  it('attendance alone confirms', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 1, donations: [], legacyPaid: false })).toBe(true);
  });
  it('a completed donation for this eid alone confirms (any amount)', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [donation({})], legacyPaid: false })).toBe(true);
  });
  it('legacyPaid alone confirms', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [], legacyPaid: true })).toBe(true);
  });
  it('neither → not confirmed', () => {
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(false);
  });
  it('a donation to a DIFFERENT enrollment (e.g. Tabla) does NOT confirm', () => {
    const tabla = { ...donation({}), eid: 'FAM1-tabla-brampton-2026-27' } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [tabla], legacyPaid: false })).toBe(false);
  });
  it('a pending/abandoned donation does NOT confirm', () => {
    const pending = { ...donation({}), status: 'pending' } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [pending], legacyPaid: false })).toBe(false);
  });
  it('a donation with eid null (general giving) does NOT confirm', () => {
    const general = { ...donation({}), eid: null } as DonationDoc;
    expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [general], legacyPaid: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/enrollment-confirmation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `enrollment-confirmation.ts`:

```ts
import type { DonationDoc } from '@cmt/shared-domain';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';

export interface ConfirmationInputs {
  /** present+late attendance marks inside the enrollment's offering window. */
  attendedCount: number;
  /** ALL of the family's donations (any program — filtered by eid here). */
  donations: DonationDoc[];
  /** Legacy-sourced BV offering already paid in the legacy roster. */
  legacyPaid: boolean;
}

/**
 * Issue #23 product rule (owner decision 2026-07-02): a family is CONFIRMED
 * ("Enrolled") for an enrollment only after real engagement — attended ≥1 class
 * in the enrollment's window, OR any completed donation tied to its eid, OR
 * (legacy cutover offerings) the legacy roster shows paid. Applies to every
 * enrolledVia; amount is irrelevant (donations are suggestions, not fees).
 * Per-year scoping is structural: attendance is window-scoped by the caller and
 * donations match on this enrollment's eid.
 */
export function isEnrollmentConfirmed(
  enrollment: Pick<EnrollmentWithOffering, 'eid'>,
  inputs: ConfirmationInputs,
): boolean {
  if (inputs.attendedCount > 0) return true;
  if (inputs.legacyPaid) return true;
  return inputs.donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid);
}
```

- [ ] **Step 4: Run to verify it passes.** Same command. Expected: 7/7 PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/portal/src/app/family/_helpers/enrollment-confirmation.ts apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts
git commit -m "feat(setu): isEnrollmentConfirmed engagement predicate (issue #23)"
```

---

### Task 2: `bvState` in the dashboard model

**Files:**
- Modify: `apps/portal/src/app/family/_helpers/dashboard-model.ts`
- Test: `apps/portal/src/app/family/__tests__/dashboard-model.test.ts` (extend; some existing assertions change — see Step 1)

**Interfaces:**
- Consumes: `isEnrollmentConfirmed` (Task 1, exact signature above).
- Produces (Tasks 3–6 rely on these):
  - `DashboardModelInput` gains `bvAttendedCount: number` (REQUIRED — every call site updates; loader supplies 0 when no active BV enrollment).
  - `FamilyDashboardModel` gains `bvState: 'enrolled' | 'registered' | 'none'`.
  - `enrolledPill` becomes three-state (text `'Enrolled' | 'Registered' | 'Not enrolled'`).
  - New model field `confirmNudge: boolean` — true ⟺ `bvState === 'registered'` (drives the nudge line + the registered donate CTA on both layouts).

- [ ] **Step 1: Write the failing tests.** In `dashboard-model.test.ts` add a `bvAttendedCount` to every existing `buildFamilyDashboardModel(...)` call (value `0` unless the test seeds attendance). Then add:

```ts
describe('bvState (issue #23 engagement rule)', () => {
  // Reuse the file's existing enrollment/donation fixture builders.
  it('active BV + attendance → enrolled', () => {
    const m = buildFamilyDashboardModel({ ...baseInput, bvAttendedCount: 1 });
    expect(m.bvState).toBe('enrolled');
    expect(m.enrolledPill.text).toBe('Enrolled');
    expect(m.confirmNudge).toBe(false);
  });
  it('active BV + completed donation for its eid → enrolled', () => {
    // donation fixture with eid === the active BV enrollment's eid
    const m = buildFamilyDashboardModel({ ...baseInput, donations: [bvDonation], bvAttendedCount: 0 });
    expect(m.bvState).toBe('enrolled');
  });
  it('active BV + neither → registered, amber pill, nudge on', () => {
    const m = buildFamilyDashboardModel({ ...baseInput, bvAttendedCount: 0 });
    expect(m.bvState).toBe('registered');
    expect(m.enrolledPill.text).toBe('Registered');
    expect(m.confirmNudge).toBe(true);
    expect(m.isEnrolled).toBe(true); // doc-exists semantics unchanged
  });
  it('no active BV enrollment → none', () => {
    const m = buildFamilyDashboardModel({ ...inputWithoutBv, bvAttendedCount: 0 });
    expect(m.bvState).toBe('none');
    expect(m.enrolledPill.text).toBe('Not enrolled');
  });
  it('legacyPaid confirms a legacy-period enrollment', () => {
    const m = buildFamilyDashboardModel({ ...legacyPeriodInput, legacyPaymentStatus: 'paid', bvAttendedCount: 0 });
    expect(m.bvState).toBe('enrolled');
  });
  it('N=2: a completed TABLA donation does not confirm BV', () => {
    const m = buildFamilyDashboardModel({ ...inputWithBvAndTabla, donations: [tablaDonation], bvAttendedCount: 0 });
    expect(m.bvState).toBe('registered');
  });
});
```
Existing tests that assert `enrolledPill.text === 'Enrolled'` on fixtures with no attendance/donation now expect `'Registered'` — update them deliberately (that IS the feature) and say so in the commit body.

- [ ] **Step 2: Run to verify failures.**
Run: `pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/dashboard-model.test.ts`
Expected: FAIL — `bvAttendedCount` unknown / `bvState` undefined.

- [ ] **Step 3: Implement in `dashboard-model.ts`.**
  - `DashboardModelInput`: add
    ```ts
    /** present+late BV attendance marks inside the active BV offering's window
     *  (computed by the loader via getFamilyBalaViharAttendance); 0 when none. */
    bvAttendedCount: number;
    ```
  - In `buildFamilyDashboardModel`, after `legacyPaid` is computed (~line 98):
    ```ts
    const bvConfirmed =
      bv !== null &&
      isEnrollmentConfirmed(bv, { attendedCount: input.bvAttendedCount, donations, legacyPaid });
    const bvState: 'enrolled' | 'registered' | 'none' =
      bv === null ? 'none' : bvConfirmed ? 'enrolled' : 'registered';
    const confirmNudge = bvState === 'registered';
    ```
  - Replace the two-state pill (lines ~129-131) with:
    ```ts
    const enrolledPill =
      bvState === 'enrolled'
        ? { text: 'Enrolled', bg: 'var(--accentSoft)', fg: 'var(--accentDeep)' }
        : bvState === 'registered'
          ? { text: 'Registered', bg: REGISTERED_BG, fg: REGISTERED_FG }
          : { text: 'Not enrolled', bg: 'var(--surface2)', fg: 'var(--muted)' };
    ```
    For `REGISTERED_BG/FG`: grep `packages/ui/src/styles/setu.css` for existing amber/warn tokens (`grep -n "warn\|amber" packages/ui/src/styles/setu.css`). Use the same CSS vars an existing amber chip uses (e.g. the roster payment "partial" chip or the `st--warn` stat tone). If no soft/deep warn pair exists, use the exact literal colors that chip uses. Do NOT invent new tokens.
  - Add `bvState` and `confirmNudge` to the returned model + the `FamilyDashboardModel` interface (documented like the neighbors). Import `isEnrollmentConfirmed` from `./enrollment-confirmation`.
  - `isEnrolled` and everything else: unchanged.

- [ ] **Step 4: Run to verify green**, then the neighbors that consume the model:
Run: `pnpm --filter @cmt/portal exec vitest run src/app/family src/app/api/setu/dashboard`
Expected: dashboard-model tests PASS; the dashboard route test will FAIL TO COMPILE if it constructs `DashboardModelInput` — if so, add `bvAttendedCount: 0` to its fixtures now (semantic route assertions come in Task 4).

- [ ] **Step 5: Commit.**
```bash
git add apps/portal/src/app/family/_helpers/dashboard-model.ts apps/portal/src/app/family/__tests__/dashboard-model.test.ts
git commit -m "feat(setu): three-state bvState (enrolled/registered/none) in dashboard model (issue #23)

Existing pill assertions updated: an active-but-unengaged BV enrollment now
reads Registered, per the issue #23 engagement rule."
```

---

### Task 3: Loader computes `bvAttendedCount` (adopts the orphan attendance helper)

**Files:**
- Modify: `apps/portal/src/app/family/_helpers/load-dashboard.ts`
- Test: extend `apps/portal/src/app/family/__tests__/dashboard-model.test.ts`? No — loader logic gets its own test ONLY if one already exists for it (check `src/app/family/__tests__/`). If none exists, the dashboard route test (Task 4) + E2E (Task 6) cover the wiring; do not invent a new loader test harness.

**Interfaces:**
- Consumes: `getFamilyBalaViharAttendance({ fid, legacyFid, oid, windowStart, windowEnd, children })` from `@/features/setu/attendance/get-family-attendance` (returns `ResolvedSummary` with `present`, `late`, ...). `selectBalaViharEnrollment` from `./select-bv-enrollment`. The `members: MemberDoc[]` parameter (currently `_members`, unused).
- Produces: `buildFamilyDashboardModel` is called with a real `bvAttendedCount`.

**Note:** `getFamilyBalaViharAttendance` currently has NO production callers (it was built for family-level BV attendance and orphaned). This task adopts it — read the file top-to-bottom first; do not modify it. The loader's docstring (lines ~30-33) says family attendance is "intentionally NOT loaded" — that comment is now obsolete for the count; update it.

- [ ] **Step 1: Implement** in `load-dashboard.ts`:
  - Rename the `_members` param to `members` (both call sites pass real members already: `family/page.tsx:95` and the dashboard route via `getSessionFamily`).
  - After the fan-out `Promise.all` resolves (line ~61) — alongside the `legacyPaymentStatus` second step, since both depend on `enrollments`:
    ```ts
    // Issue #23: "Enrolled" now means engaged. Count attended Sundays inside the
    // active BV enrollment's window so the model can derive bvState. One extra
    // narrow read, only when an active BV enrollment exists.
    const bv = selectBalaViharEnrollment(enrollments);
    let bvAttendedCount = 0;
    if (bv) {
      const byMid = new Map(members.map((m) => [m.mid, m]));
      const children = bv.enrolledMids.map((mid) => ({
        mid,
        legacySid: byMid.get(mid)?.legacySid ?? null,
      }));
      const toYmd = (d: Date) => d.toISOString().slice(0, 10);
      const summary = await getFamilyBalaViharAttendance({
        fid: family.fid,
        legacyFid: family.legacyFid,
        oid: bv.oid,
        windowStart: bv.offering ? toYmd(bv.offering.startDate) : null,
        windowEnd: bv.offering?.endDate ? toYmd(bv.offering.endDate) : null,
        children,
      });
      bvAttendedCount = summary.present + summary.late;
    }
    ```
    Run this `await` CONCURRENTLY with the `legacyPaymentStatus` read (both depend only on `enrollments`): wrap the two in one `Promise.all` rather than serializing. Add imports for `selectBalaViharEnrollment` and `getFamilyBalaViharAttendance`.
  - Pass `bvAttendedCount` into `buildFamilyDashboardModel({ ... })`.
  - Update the docstring lines ~30-33: family-level attendance is now read as a COUNT for the engagement rule; the per-date heatmap still lives on child profiles.

- [ ] **Step 2: Typecheck + the file's consumers.**
Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal exec vitest run src/app/family src/app/api/setu/dashboard`
Expected: PASS (route-test fixtures already carry `bvAttendedCount` from Task 2 Step 4 if they needed it; if the route test mocks `loadFamilyDashboard` itself, nothing changes here).

- [ ] **Step 3: Commit.**
```bash
git add apps/portal/src/app/family/_helpers/load-dashboard.ts
git commit -m "feat(setu): dashboard loader computes BV attended-count for bvState (issue #23)"
```

---

### Task 4: Dashboard API exposes `bvState` + mobile changelog

**Files:**
- Modify: `apps/portal/src/app/api/setu/dashboard/route.ts` (the `balaVihar: { ... }` block, ~lines 39-50)
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md` (prepend entry)
- Test: `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts` (extend)

**Interfaces:**
- Consumes: `model.bvState` (Task 2).
- Produces: `balaVihar.bvState: 'enrolled' | 'registered' | 'none'` in the 200 JSON. `isEnrolled` unchanged.

- [ ] **Step 1: Write the failing test.** In the route test, extend the existing 200-shape assertions (reuse its fixture pattern — it seeds via mocked loaders): assert `body.balaVihar.bvState === 'registered'` for a fixture with an active BV enrollment and no attendance/donation, and `'enrolled'` when the fixture includes a completed donation for the BV eid (or `bvAttendedCount ≥ 1`, whichever the fixture path supports), and `'none'` with no BV enrollment. Follow exactly how the existing test drives different model states.

- [ ] **Step 2: Run to verify it fails.**
Run: `pnpm --filter @cmt/portal exec vitest run src/app/api/setu/dashboard`
Expected: FAIL — `bvState` undefined in response.

- [ ] **Step 3: Implement.** In the route's `balaVihar` object add one line: `bvState: model.bvState,`. Then prepend to `MOBILE_API_CHANGELOG.md` (match the existing entry format exactly; SHA `PENDING`, repoint after commit):

```markdown
## `PENDING` · 2026-07-02 · dashboard `balaVihar` gains three-state `bvState` (issue #23)
- **GET `/api/setu/dashboard`** — `balaVihar` gains an additive **`bvState: 'enrolled' | 'registered' | 'none'`**. `'enrolled'` = the family has ENGAGED this year (attended ≥1 BV class in the enrollment's window OR any completed donation for that enrollment, OR legacy-roster paid for legacy offerings). `'registered'` = an active BV enrollment exists (self-enroll, promotion, or backfill) but no engagement yet. `'none'` = no active BV enrollment. **`isEnrolled` is UNCHANGED** (still "active BV enrollment doc exists") — do not re-derive it from `bvState`.
  - **Mobile:** add `bvState` to the dashboard schema; drive the BV pill from it (green "Enrolled" / amber "Registered" / grey "Not enrolled"). For `'registered'`, show the nudge copy "Attend your first class or complete your donation to confirm enrollment." + a donate CTA. No request-shape change; no other field changed.
```

- [ ] **Step 4: Run to verify green.** Same command + `pnpm --filter @cmt/portal typecheck`. Expected: PASS.

- [ ] **Step 5: Commit, then repoint the changelog SHA.**
```bash
git add apps/portal/src/app/api/setu/dashboard/ apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(setu): expose bvState in dashboard API + mobile changelog (issue #23)"
# then: replace PENDING with $(git rev-parse --short HEAD) in the changelog and amend:
git add apps/portal/docs/MOBILE_API_CHANGELOG.md && git commit --amend --no-edit
```

---

### Task 5: Family page — nudge + registered donate CTA (mobile & desktop)

**Files:**
- Modify: `apps/portal/src/app/family/page.tsx` (mobile branch ~lines 176-192; desktop branch ~lines 285-300)

**Interfaces:**
- Consumes: `model.bvState`, `model.confirmNudge`, `donateUrl` (all existing/Task 2).

**No unit test exists for this server page** (verify: `ls apps/portal/src/app/family/__tests__/` — only model/nudge tests). Do NOT build a page-render harness; Task 6's deployed-UAT E2E asserts the rendered result. Keep this task a pure JSX change.

- [ ] **Step 1: Mobile branch.** In the BV card (the `block md:hidden` tree), the current hint line reads:
```tsx
<div style={{ fontSize: 11, color: 'var(--muted)' }}>
  {isEnrolled
    ? 'Open a child’s profile to see their Sunday attendance.'
    : 'Enroll your children to join Sunday Bala Vihar classes.'}
</div>
```
Replace with a three-way branch + registered CTA (keep the existing `!isEnrolled` Enroll-now block as is):
```tsx
<div style={{ fontSize: 11, color: 'var(--muted)' }}>
  {model.bvState === 'enrolled'
    ? 'Open a child’s profile to see their Sunday attendance.'
    : model.bvState === 'registered'
      ? 'Attend your first class or complete your donation to confirm enrollment.'
      : 'Enroll your children to join Sunday Bala Vihar classes.'}
</div>
{model.confirmNudge && (
  <Link href={donateUrl} className="btn btn--p btn--block" style={{ marginTop: 12, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
    Give donation
  </Link>
)}
```
(This is the mobile dashboard's first donate CTA — the #23 gap.)

- [ ] **Step 2: Desktop branch.** Near the existing Give button (`{showGive && <Link href={donateUrl} …>Give donation</Link>}`, ~line 293), add the nudge line for registered families — same copy, rendered adjacent to the BV/donation card heading in that branch's existing typographic style (match a neighboring muted caption's className/style):
```tsx
{model.confirmNudge && (
  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
    Attend your first class or complete your donation to confirm enrollment.
  </div>
)}
```
The desktop Give button itself is untouched (`showGive` already true for registered families).

- [ ] **Step 3: Gates.**
Run: `pnpm --filter @cmt/portal exec vitest run src/app/family && pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: all PASS (no behavior asserted at unit level; compile+lint clean).

- [ ] **Step 4: Commit.**
```bash
git add apps/portal/src/app/family/page.tsx
git commit -m "feat(setu): Registered nudge + mobile donate CTA on family dashboard (issue #23)"
```

---

### Task 6: Welcome surfaces — Confirmed vs Registered

**Files:**
- Modify: `apps/portal/src/features/setu/roster/list-families.ts` + the roster row schema `packages/shared-domain/src/setu/roster.ts` + `apps/portal/src/features/setu/roster/roster-browser.tsx`
- Modify: `apps/portal/src/app/api/welcome/reports/[kind]/route.ts` (the `enrollment` kind)
- Test: existing roster/report test files next to each (find them: `ls apps/portal/src/features/setu/roster/__tests__ apps/portal/src/app/api/welcome/reports/[kind]/__tests__`)

**Interfaces:**
- Consumes: `isEnrollmentConfirmed` (Task 1). NOT the dashboard model (these surfaces are per-family-lite).
- Produces: `RosterFamilyRow.bvEngagement?: 'confirmed' | 'registered' | null` (nullable+optional — read-validated schema, same discipline as `publicFid`); enrollment report rows gain `confirmed`/`registered` counts.

- [ ] **Step 1 (roster): failing test.** Extend the roster test: a family whose active BV enrollment has a completed donation (or attendance) → row `bvEngagement: 'confirmed'`; active BV without engagement → `'registered'`; no BV → `null`.
- [ ] **Step 2 (roster): implement.** In `toRow` (list-families.ts:33) — it already reads members + payment per row. Add the BV check: reuse the enrollments/donations reads `deriveFamilyPayment` performs if they're accessible (READ `payment.ts` first — if it already loads the family's enrollments+donations, thread those through instead of re-reading; only add a `getFamilyBalaViharAttendance` call when the donation check alone is inconclusive, i.e. no confirming donation → check attendance). Set `bvEngagement` accordingly. Schema field: `bvEngagement: z.enum(['confirmed','registered']).nullable().optional()` in `RosterFamilyRowSchema`. Render a small chip next to the payment chip in `roster-browser.tsx` (reuse the exact chip classes the payment chip uses; amber for registered, green for confirmed).
- [ ] **Step 3 (report): failing test.** For `kind=enrollment`, assert the JSON gains per-program (or per-level, matching its existing grouping) `confirmed` and `registered` counts for `bala-vihar`, derived such that `confirmed + registered === enrolled count`.
- [ ] **Step 4 (report): implement — BULK.** In the enrollment branch of `[kind]/route.ts`: it already bulk-reads enrollments. Add TWO bulk reads joined in memory — `db.collectionGroup('attendanceEvents').get()`-equivalent (READ how the `attendance` kind in this same file bulk-loads teacher events and copy that exact pattern + the door check-ins source it uses) and `db.collectionGroup('donations').get()` (copy `build-csv-rows.ts:73`). Build per-fid `attendedCount` (within each BV enrollment's offering window) + donations list, then `isEnrollmentConfirmed` per active BV enrollment. NO per-family queries (the 45s CSV lesson). No new indexes (unfiltered collectionGroup gets need none).
- [ ] **Step 5: Gates.**
Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/roster src/app/api/welcome && pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint && pnpm --filter @cmt/shared-domain exec vitest run src/setu`
Expected: PASS.
- [ ] **Step 6: Commit.**
```bash
git add packages/shared-domain/src/setu/roster.ts apps/portal/src/features/setu/roster/ "apps/portal/src/app/api/welcome/reports/[kind]/"
git commit -m "feat(setu): Confirmed vs Registered on welcome roster + enrollment report (issue #23)"
```

---

### Task 7: Deterministic fixture + deployed-UAT E2E

**Files:**
- Modify: `apps/portal/scripts/seed-e2e-family.ts`
- Create: `apps/portal/e2e/setu/enrollment-state.spec.ts`

**Interfaces:** Consumes the deployed portal at `https://cmt-setu.vercel.app` + the seeded E2E family (password sign-in — never OTP).

**Context:** the 2026-27 rollover already ran in UAT, so the E2E family's current enrollment state is nondeterministic (it may hold a promoted 2026-27 active BV enrollment). The seed must FORCE a known state.

- [ ] **Step 1: Read first.** `seed-e2e-family.ts` end-to-end (it already writes a 2025-26 BV enrollment + check-in dates), `e2e/setu/dashboard.spec.ts` + `e2e/README.md` for the sign-in/storage-state pattern, and one mutation spec for the cleanup pattern.
- [ ] **Step 2: Seed changes (idempotent, `_test:true` tagging like every other write there):**
  - Ensure an ACTIVE `bala-vihar` 2026-27 enrollment exists for the family (eid `${fid}-bv-brampton-2026-27`, oid `bv-brampton-2026-27`, `enrolledVia:'promotion'`) — create-or-normalize, and ensure the old 2025-26 one is `status:'cancelled'` (matching what the real rollover produces).
  - DELETE any `_test:true` donations with that 2026-27 eid (restores "Registered" ground state on every run).
  - Add a flag `--confirm-bv`: when passed, write ONE `_test:true` completed donation (`amountCAD: 25`, `eid` = the 2026-27 eid, `status:'completed'`) — flips the family to Enrolled. Ensure no 2026-27 attendance is ever seeded (CHECKIN_DATES are all 2025-26 — verify and leave them).
- [ ] **Step 3: Write the spec** (`enrollment-state.spec.ts`), following the dashboard spec's auth/setup helpers:
  1. **Registered state** (ground state): `GET /api/setu/dashboard` (Bearer or cookie, follow `mobile-bearer.spec.ts`) → `balaVihar.bvState === 'registered'`, `isEnrolled === true`. UI: `/family` shows the `Registered` pill, the nudge text `Attend your first class or complete your donation to confirm enrollment.`, and — at a mobile viewport (`test.use({ viewport: { width: 390, height: 844 } })` for that test) — a visible `Give donation` link pointing at `/family/donate?eid=…`.
  2. **Enrolled via donation**: run the seed with the flag from the spec (`execSync('pnpm --filter @cmt/portal seed:e2e-family --confirm-bv', { stdio: 'inherit' })` in a `test.describe.serial` step or `beforeAll` of a second describe) → reload dashboard → pill `Enrolled`, API `bvState === 'enrolled'`.
  3. **Cleanup**: `afterAll` re-runs the seed WITHOUT the flag (which deletes the `_test` donation) so the suite is idempotent.
- [ ] **Step 4: Gates (local).**
Run: `pnpm --filter @cmt/portal typecheck && cd apps/portal && pnpm exec eslint scripts/seed-e2e-family.ts e2e/setu/enrollment-state.spec.ts`
Expected: clean. (The spec itself runs only against deployed UAT — the controller runs it after deploy.)
- [ ] **Step 5: Commit.**
```bash
git add apps/portal/scripts/seed-e2e-family.ts apps/portal/e2e/setu/enrollment-state.spec.ts
git commit -m "test(setu): deployed-UAT e2e for Registered/Enrolled engagement states (issue #23)"
```

---

### Task 8 (controller, after deploy): run the E2E + real-family walkthrough

Not a subagent task. After the branch reaches deployed UAT: `pnpm --filter @cmt/portal seed:e2e-family`, then run the `setu` Playwright project filtered to `enrollment-state.spec.ts` against `https://cmt-setu.vercel.app`; then the manual check — the reporter's real family `CMT-P672RGSS` shows **Registered** for 2026-27 (screenshot for issue #23). Update issue #23 with the outcome.

---

## Self-Review

**Spec coverage:** rule + all-enrolledVia (T1) · derived/no-schema-change (T1-T3, no doc writes anywhere) · three-state pill + nudge + mobile CTA (T2, T5) · additive API + changelog (T4) · welcome surfaces bulk (T6) · testing incl. eid-mismatch, year-scoping (T1/T2), N=2 (T2), deployed-UAT E2E + real family (T7/T8) · out-of-scope respected (no showGive gating change, no creation-path change). Legacy-paid confirmation covered (T1 legacyPaid input, T2 legacy test). No gaps found.

**Placeholder scan:** clean — every code step has code; discovery steps name exact files/greps and a defined fallback (pill tokens, payment.ts reuse, report bulk pattern).

**Type consistency:** `bvState: 'enrolled'|'registered'|'none'` and `confirmNudge: boolean` (T2) match T4/T5/T6 usage; `ConfirmationInputs { attendedCount, donations, legacyPaid }` (T1) matches T2/T6 call sites; `bvAttendedCount` input name consistent T2/T3.

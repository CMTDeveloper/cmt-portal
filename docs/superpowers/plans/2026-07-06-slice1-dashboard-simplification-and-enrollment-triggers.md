# Slice 1 — Family Dashboard Simplification + Enrollment Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the `/family` dashboard to three stacked blocks (Family · Action Items · one Bala Vihar section), amend the enrollment-confirmation rule so a deliberate Enroll click (or first attendance) counts as "Enrolled", hide Seva/Prasad/calendar from families, surface profile-completeness on the member pages, and mirror the new data additively in the mobile dashboard API.

**Architecture:** All BV/donation derivation stays in the pure `buildFamilyDashboardModel` (unit-tested with multi-enrollment fixtures); new per-child assembly (attendance ratios, class assignments, family counts) is composed in `loadFamilyDashboard` — the single loader shared verbatim by the `/family` server page AND `GET /api/setu/dashboard`, so web and mobile never drift. The `/family/page.tsx` is rebuilt to render only the three blocks; Seva/Prasad hide behind OFF-by-default `flags.ts` feature flags following the literal-`process.env` pattern.

**Tech Stack:** Next.js 16 App Router (Server Components, `connection()`, `use cache`), TypeScript with `exactOptionalPropertyTypes`, Firebase Admin (Firestore), Zod (read-validated doc schemas), Vitest (unit), Playwright (deployed-UAT E2E, `setu` project). Design spec: `docs/superpowers/specs/2026-07-06-slice1-dashboard-simplification-and-enrollment-triggers-design.md`.

## Global Constraints

- **UAT only.** Every DB/index/seed/E2E op targets `chinmaya-setu-uat`. Never write to prod `chinmaya-setu-715b8`; never `--force` an index deploy.
- **`@cmt/shared-domain` stays pure** — no React/Next/DOM imports; enforced by lint.
- **`exactOptionalPropertyTypes` is on** — never assign `undefined` to an optional; omit the key or use `null`.
- **`NEXT_PUBLIC_*` flags must be literal `process.env.NEXT_PUBLIC_FOO`** access in `flags.ts` — never dynamic indexing (it doesn't inline into the client bundle).
- **Every new `NEXT_PUBLIC_*` env var must be added to `turbo.json`'s `globalEnv`/`env` array** or the Vercel build sandbox strips it (local passes, Vercel fails).
- **Bulk collectionGroup reads, never per-family fan-out.**
- **Any `/api/setu/**` request/response shape change (or a `@cmt/shared-domain` schema it uses) needs a dated, SHA-keyed entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.**
- **Amount is irrelevant to confirmation** — donations are suggestions, not fees. Donation status (Pending/Complete/Off-portal) is tracked **independently** of enrollment state.
- **Never bypass `--no-verify`.** The pre-push hook (`typecheck && lint && test && build`) is the gate.
- **Commit author** is already `CMT Developer <developer@chinmayatoronto.org>` in local `.git/config`.
- Run unit tests with `pnpm --filter @cmt/portal test`. The deployed-UAT E2E is the separate `pnpm --filter @cmt/portal test:e2e` (Playwright) against `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`.

---

### Task 1: Enrollment-trigger amendment (Part A)

Widen the pure confirmation predicate so a deliberate Enroll click (`enrolledVia: 'family-initiated'`) or an auto-enroll from a kid's first attendance (`enrolledVia: 'first-attendance'`) both confirm enrollment on their own — in addition to the existing attendance/donation/legacy-paid triggers. "Registered" then only survives for `promotion`/`welcome-team` enrollments with zero engagement.

**Files:**
- Modify: `apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`
- Test: `apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts`

**Interfaces:**
- Consumes: `EnrollmentWithOffering` from `@/features/setu/enrollment/get-enrollments` (has `enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion'`); `DonationDoc` from `@cmt/shared-domain`.
- Produces: `isEnrollmentConfirmed(enrollment: Pick<EnrollmentWithOffering, 'eid' | 'enrolledVia'>, inputs: ConfirmationInputs): boolean`. **The param type widens from `Pick<…, 'eid'>` to `Pick<…, 'eid' | 'enrolledVia'>`** — every caller already passes a full `EnrollmentWithOffering` (`dashboard-model.ts:132` passes `bv`), so this is source-compatible.

- [ ] **Step 1: Extend the test with the two new confirming triggers and a still-Registered case**

Add these cases inside the existing `describe('isEnrollmentConfirmed', …)` block in `apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts`. The existing `bv` fixture is `{ eid: 'FAM1-bv-brampton-2026-27' }` — update it to also carry `enrolledVia`, and add per-case overrides:

```ts
// Replace the module-level fixture at the top of the file:
const bv = { eid: 'FAM1-bv-brampton-2026-27', enrolledVia: 'promotion' as const };

// …then add these tests inside describe('isEnrollmentConfirmed', () => { … }):
it('a family-initiated enrollment confirms with no engagement (clicked Enroll, $0 paid)', () => {
  const clicked = { eid: bv.eid, enrolledVia: 'family-initiated' as const };
  expect(isEnrollmentConfirmed(clicked, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(true);
});
it('a first-attendance enrollment confirms with no engagement (teacher auto-enrolled a kid)', () => {
  const auto = { eid: bv.eid, enrolledVia: 'first-attendance' as const };
  expect(isEnrollmentConfirmed(auto, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(true);
});
it('a promotion enrollment with zero engagement stays NOT confirmed (Registered)', () => {
  expect(isEnrollmentConfirmed(bv, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(false);
});
it('a welcome-team enrollment with zero engagement stays NOT confirmed (Registered)', () => {
  const wt = { eid: bv.eid, enrolledVia: 'welcome-team' as const };
  expect(isEnrollmentConfirmed(wt, { attendedCount: 0, donations: [], legacyPaid: false })).toBe(false);
});
```

The existing four cases (attendance-alone, donation-alone, legacyPaid-alone, different-eid/pending/general) already pass `bv` (now `promotion`) so they still exercise the non-`enrolledVia` triggers.

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `pnpm --filter @cmt/portal test -- enrollment-confirmation`
Expected: the two "confirms with no engagement" cases FAIL (predicate returns `false`); the promotion/welcome-team "stays NOT confirmed" cases PASS; the pre-existing cases PASS.

- [ ] **Step 3: Amend the predicate**

Replace the body of `isEnrollmentConfirmed` in `apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`. Widen the param type and add the two `enrolledVia` short-circuits first:

```ts
export function isEnrollmentConfirmed(
  enrollment: Pick<EnrollmentWithOffering, 'eid' | 'enrolledVia'>,
  inputs: ConfirmationInputs,
): boolean {
  // Slice 1 (2026-07-06): a DELIBERATE or ENGAGED enrollment confirms on its own.
  //  - 'family-initiated' = the family clicked Enroll (even with $0 paid).
  //  - 'first-attendance' = a child showed up and a teacher auto-enrolled them.
  // Both are affirmative signals the family means to attend, so they read
  // "Enrolled" immediately. Only 'promotion'/'welcome-team' enrollments (rollover
  // carry-forward / staff backfill) still require real engagement below to
  // graduate from "Registered" → "Enrolled" (issue #23's carry-you-forward state).
  if (enrollment.enrolledVia === 'family-initiated') return true;
  if (enrollment.enrolledVia === 'first-attendance') return true;
  if (inputs.attendedCount > 0) return true;
  if (inputs.legacyPaid) return true;
  return inputs.donations.some((d) => d.status === 'completed' && d.eid === enrollment.eid);
}
```

Also update the JSDoc block above the function to note the Slice-1 amendment (keep the issue #23 history, add: "Slice 1 2026-07-06 — 'family-initiated'/'first-attendance' confirm on their own; only 'promotion'/'welcome-team' still require engagement").

- [ ] **Step 4: Run the test to verify all pass**

Run: `pnpm --filter @cmt/portal test -- enrollment-confirmation`
Expected: PASS (all cases green).

- [ ] **Step 5: Run the model test (it consumes the predicate)**

Run: `pnpm --filter @cmt/portal test -- dashboard-model`
Expected: PASS. If any fixture used `enrolledVia: 'family-initiated'` with a Registered expectation, flip that fixture to `enrolledVia: 'promotion'` (the `makeEnrollment` default at `dashboard-model.test.ts:59` is `'family-initiated'` — any test asserting `bvState: 'registered'` must set `enrolledVia: 'promotion'` and zero engagement). Fix such fixtures inline and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/family/_helpers/enrollment-confirmation.ts apps/portal/src/app/family/__tests__/enrollment-confirmation.test.ts apps/portal/src/app/family/__tests__/dashboard-model.test.ts
git commit -m "feat(family): confirm enrollment on family-initiated/first-attendance (Slice 1 Part A)"
```

---

### Task 2: Feature flags for Seva / Prasad + calendar-link env (Part C foundation)

Add two OFF-by-default flags to hide Seva and Prasad from families, plus an optional external-calendar-URL env var. Register all three in `turbo.json` so Vercel builds see them.

**Files:**
- Modify: `apps/portal/src/lib/flags.ts`
- Modify: `turbo.json:44-46` (the `NEXT_PUBLIC_FEATURE_SETU_*` list in `globalEnv`/`env`)
- Test: `apps/portal/src/lib/__tests__/flags.test.ts` (create if absent)

**Interfaces:**
- Produces: `flags.setuSeva: boolean`, `flags.setuPrasad: boolean` on the exported `flags` const. Both default `false` (env unset ⇒ `false`).

- [ ] **Step 1: Write a failing test for the two new flags defaulting off**

Create/append `apps/portal/src/lib/__tests__/flags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { flags } from '../flags';

describe('flags', () => {
  it('setuSeva and setuPrasad default OFF when their env vars are unset', () => {
    // In the vitest env NEXT_PUBLIC_FEATURE_SETU_SEVA / _PRASAD are unset ⇒ false.
    expect(flags.setuSeva).toBe(false);
    expect(flags.setuPrasad).toBe(false);
  });
  it('exposes them as booleans', () => {
    expect(typeof flags.setuSeva).toBe('boolean');
    expect(typeof flags.setuPrasad).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- lib/__tests__/flags`
Expected: FAIL — `Property 'setuSeva' does not exist on type` (typecheck) or `undefined` at runtime.

- [ ] **Step 3: Add the flags**

In `apps/portal/src/lib/flags.ts`, add inside the `flags` object (after `setuTeacher`):

```ts
  // Slice 1 (2026-07-06): Seva + Prasad are hidden from FAMILIES entirely
  // (dashboard card, left-nav item, and the /family/seva|prasad routes) until the
  // owner decides to re-surface them. OFF by default. Admin/welcome Seva+Prasad
  // config is untouched — this only gates the family-facing surfaces.
  setuSeva: process.env.NEXT_PUBLIC_FEATURE_SETU_SEVA === 'true',
  setuPrasad: process.env.NEXT_PUBLIC_FEATURE_SETU_PRASAD === 'true',
```

- [ ] **Step 4: Register the env vars in turbo.json**

In `turbo.json`, add these three lines to the SAME array that currently lists `"NEXT_PUBLIC_FEATURE_SETU_AUTH"` / `"NEXT_PUBLIC_FEATURE_SETU_DONATIONS"` (around line 45-46):

```json
        "NEXT_PUBLIC_FEATURE_SETU_SEVA",
        "NEXT_PUBLIC_FEATURE_SETU_PRASAD",
        "NEXT_PUBLIC_FAMILY_CALENDAR_URL",
```

(`NEXT_PUBLIC_FAMILY_CALENDAR_URL` is consumed in Task 7 for the external calendar link; register it now so the build sees it whenever it's set.)

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @cmt/portal test -- lib/__tests__/flags && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/lib/flags.ts apps/portal/src/lib/__tests__/flags.test.ts turbo.json
git commit -m "feat(flags): add OFF-by-default setuSeva/setuPrasad + calendar-url env (Slice 1 Part C)"
```

---

### Task 3: Per-child Bala Vihar attendance helper

The dashboard's BV section shows each enrolled child's own attendance ratio (e.g. "Aarav 4/5"). The existing `getFamilyBalaViharAttendance` folds across children into ONE family summary — it can't answer per-child. Add a per-child helper that resolves each child independently and returns `{ present, total }` per mid.

**Files:**
- Create: `apps/portal/src/features/setu/attendance/get-per-child-attendance.ts`
- Test: `apps/portal/src/features/setu/attendance/__tests__/get-per-child-attendance.test.ts`

**Interfaces:**
- Consumes: `getAttendanceForFamily` from `@/features/setu/teacher/get-attendance`; `getCheckInAttendance`, `summarizeMemberCheckIns` from `./check-in-attendance`; `resolveMemberAttendance`, `summarizeResolvedMarks` from `./resolve-attendance`; the `FamilyBvAttendanceArgs` shape (fid, legacyFid, oid, windowStart, windowEnd, children:{mid,legacySid}[]) from `./get-family-attendance`.
- Produces: `getPerChildBalaViharAttendance(args: FamilyBvAttendanceArgs): Promise<Map<string, { present: number; total: number }>>` — keyed by mid. `present` counts present+late (matches the family "attended" semantics); `total` is that child's resolved mark count in-window. A child with no marks maps to `{ present: 0, total: 0 }`.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/attendance/__tests__/get-per-child-attendance.test.ts`. Mock the two read modules so the test is pure (mirror the mocking style already used in `get-family-attendance`'s tests — check that file's `__tests__` sibling for the exact `vi.mock` targets and adapt):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForFamily: vi.fn() }));
vi.mock('../check-in-attendance', async (orig) => {
  const actual = await orig<typeof import('../check-in-attendance')>();
  return { ...actual, getCheckInAttendance: vi.fn() };
});

import { getPerChildBalaViharAttendance } from '../get-per-child-attendance';
import { getAttendanceForFamily } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance } from '../check-in-attendance';

const mockedTeacher = vi.mocked(getAttendanceForFamily);
const mockedDoor = vi.mocked(getCheckInAttendance);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDoor.mockResolvedValue([]);
});

describe('getPerChildBalaViharAttendance', () => {
  it('returns an independent present/total per child (N=2, one present one absent same day)', async () => {
    mockedTeacher.mockResolvedValue([
      { mid: 'K1', pid: 'oid-1', date: '2025-09-07', status: 'present' },
      { mid: 'K2', pid: 'oid-1', date: '2025-09-07', status: 'absent' },
      { mid: 'K1', pid: 'oid-1', date: '2025-09-14', status: 'late' },
    ] as unknown as Awaited<ReturnType<typeof getAttendanceForFamily>>);

    const out = await getPerChildBalaViharAttendance({
      fid: 'FAM1', legacyFid: null, oid: 'oid-1',
      windowStart: '2025-09-01', windowEnd: '2026-06-15',
      children: [{ mid: 'K1', legacySid: null }, { mid: 'K2', legacySid: null }],
    });

    expect(out.get('K1')).toEqual({ present: 2, total: 2 }); // present + late both count as present
    expect(out.get('K2')).toEqual({ present: 0, total: 1 }); // one absent mark
  });

  it('ignores portal marks for a different oid', async () => {
    mockedTeacher.mockResolvedValue([
      { mid: 'K1', pid: 'other-oid', date: '2025-09-07', status: 'present' },
    ] as unknown as Awaited<ReturnType<typeof getAttendanceForFamily>>);
    const out = await getPerChildBalaViharAttendance({
      fid: 'FAM1', legacyFid: null, oid: 'oid-1',
      windowStart: null, windowEnd: null, children: [{ mid: 'K1', legacySid: null }],
    });
    expect(out.get('K1')).toEqual({ present: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- get-per-child-attendance`
Expected: FAIL with "Cannot find module '../get-per-child-attendance'".

- [ ] **Step 3: Implement the helper**

Create `apps/portal/src/features/setu/attendance/get-per-child-attendance.ts`:

```ts
import { getAttendanceForFamily } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import { resolveMemberAttendance, summarizeResolvedMarks } from './resolve-attendance';
import type { FamilyBvAttendanceArgs } from './get-family-attendance';

/**
 * Per-child Bala Vihar attendance ratios for the family dashboard's BV section.
 *
 * Unlike `getFamilyBalaViharAttendance` (which folds every child into ONE family
 * summary answering "did ANY child attend that Sunday?"), this resolves each
 * child INDEPENDENTLY — a sibling's absence never touches another child's ratio —
 * and returns `{ present, total }` per mid, so the UI can render "Aarav 4/5".
 * `present` counts present+late (same "attended" semantics as the family count).
 * Door records are window-scoped (door has no offering link); portal teacher
 * marks are oid-filtered. A child with no in-window marks maps to `{0,0}`.
 */
export async function getPerChildBalaViharAttendance(
  args: FamilyBvAttendanceArgs,
): Promise<Map<string, { present: number; total: number }>> {
  const [familyEvents, doorRecords] = await Promise.all([
    getAttendanceForFamily(args.fid),
    getCheckInAttendance(args.legacyFid),
  ]);

  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);

  const out = new Map<string, { present: number; total: number }>();
  for (const child of args.children) {
    const portalMarks = familyEvents
      .filter((e) => e.mid === child.mid && e.pid === args.oid)
      .map((e) => ({ date: e.date, status: e.status }));
    const doorMarks = summarizeMemberCheckIns(scopedDoor, child.legacySid).marks;
    const resolved = resolveMemberAttendance(portalMarks, doorMarks);
    const summary = summarizeResolvedMarks(resolved.marks);
    out.set(child.mid, { present: summary.present + summary.late, total: summary.total });
  }
  return out;
}
```

**Note:** confirm the exact field names on the teacher-event shape (`mid`, `pid`, `date`, `status`) by reading `get-family-attendance.ts:43-45` (this file mirrors that filter). If the door-mark helper signature differs, match `get-family-attendance.ts` exactly — this helper is a per-child de-fold of that same logic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- get-per-child-attendance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/attendance/get-per-child-attendance.ts apps/portal/src/features/setu/attendance/__tests__/get-per-child-attendance.test.ts
git commit -m "feat(attendance): per-child BV attendance ratios helper (Slice 1)"
```

---

### Task 4: Bala Vihar teacher-name resolver (class assignments)

The BV section's "Class Assignments" shows each enrolled child's level **name** (already denormalized free on the enrollment as `levelSnapshots[mid].levelName` — no read) plus their **teacher name(s)**. Teacher names require resolving `level.teacherRefs` (mids) → member display names via a bulk collection-group read. This task delivers ONLY the teacher-name resolver; the loader (Task 5) merges it with the free level name. **This task is independently droppable** — if deferred, the loader passes an empty teacher map and the UI renders level name with no teacher line.

**Files:**
- Create: `apps/portal/src/features/setu/attendance/get-bv-teacher-names.ts`
- Test: `apps/portal/src/features/setu/attendance/__tests__/get-bv-teacher-names.test.ts`

**Interfaces:**
- Consumes: `portalFirestore` from `@cmt/firebase-shared/admin/firestore`; `LevelDoc.teacherRefs` (array of mids) via `levels/{levelId}`; member display names via `collectionGroup('members').where('mid', 'in', mids)` (the `members.mid` collection-group field-override index is already UAT-deployed — CLAUDE.md Phase 2). Firestore `in` caps at 30 values; teacher counts are tiny, but chunk defensively.
- Produces: `getBvTeacherNames(levelIds: string[]): Promise<Map<string, string[]>>` — keyed by `levelId`, value = display names (`"First Last"`) of that level's `teacherRefs`, in `teacherRefs` order, missing members skipped. Unknown/blank levelIds are absent from the map.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/attendance/__tests__/get-bv-teacher-names.test.ts`. Mock `portalFirestore` with a minimal fake (mirror the fake-firestore style used elsewhere in `features/setu/**/__tests__`; if a shared fake exists, reuse it). Assert:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal in-memory fake: levels/{id}.teacherRefs, and a members collectionGroup
// keyed by mid. Adapt to the repo's existing fake-firestore util if present.
const levels: Record<string, { teacherRefs: string[] }> = {
  'brampton-level-2-p1': { teacherRefs: ['T1', 'T2'] },
  'brampton-shishu-p1': { teacherRefs: [] },
};
const membersByMid: Record<string, { firstName: string; lastName: string }> = {
  T1: { firstName: 'Meera', lastName: 'Rao' },
  T2: { firstName: 'Anil', lastName: 'Kumar' },
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: name === 'levels' && id in levels, data: () => levels[id] }),
      }),
    }),
    collectionGroup: (name: string) => ({
      where: (_f: string, _op: string, mids: string[]) => ({
        get: async () => ({
          docs: mids
            .filter((m) => name === 'members' && m in membersByMid)
            .map((m) => ({ data: () => ({ mid: m, ...membersByMid[m] }) })),
        }),
      }),
    }),
  }),
}));

import { getBvTeacherNames } from '../get-bv-teacher-names';

describe('getBvTeacherNames', () => {
  it('maps a level to its teachers\' display names in teacherRefs order', async () => {
    const out = await getBvTeacherNames(['brampton-level-2-p1']);
    expect(out.get('brampton-level-2-p1')).toEqual(['Meera Rao', 'Anil Kumar']);
  });
  it('a level with no teacherRefs maps to an empty array', async () => {
    const out = await getBvTeacherNames(['brampton-shishu-p1']);
    expect(out.get('brampton-shishu-p1')).toEqual([]);
  });
  it('an unknown levelId is absent from the map', async () => {
    const out = await getBvTeacherNames(['does-not-exist']);
    expect(out.has('does-not-exist')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- get-bv-teacher-names`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `apps/portal/src/features/setu/attendance/get-bv-teacher-names.ts`:

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** Firestore `in` caps at 30 values; chunk teacher mids defensively. */
function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Resolve each Bala Vihar level's assigned teacher display names for the family
 * dashboard's "Class Assignments" line. `teacherRefs` on a level are mids; the
 * teachers are members of (possibly other) families, so names come from a bulk
 * `collectionGroup('members').where('mid','in', …)` read — never a per-family
 * fan-out. The `members.mid` collection-group index is already UAT-deployed.
 *
 * Returns a Map keyed by levelId → display names in teacherRefs order. Missing
 * members are skipped; unknown/blank levelIds are absent from the map. Read-only.
 */
export async function getBvTeacherNames(levelIds: string[]): Promise<Map<string, string[]>> {
  const db = portalFirestore();
  const unique = [...new Set(levelIds.filter((id) => id && id.trim().length > 0))];
  if (unique.length === 0) return new Map();

  // 1) level docs → teacherRefs
  const levelDocs = await Promise.all(unique.map((id) => db.collection('levels').doc(id).get()));
  const refsByLevel = new Map<string, string[]>();
  const allMids = new Set<string>();
  for (let i = 0; i < unique.length; i++) {
    const d = levelDocs[i]!;
    if (!d.exists) continue;
    const refs = ((d.data() as { teacherRefs?: string[] } | undefined)?.teacherRefs ?? []).filter(Boolean);
    refsByLevel.set(unique[i]!, refs);
    refs.forEach((m) => allMids.add(m));
  }

  // 2) bulk member lookup → mid → "First Last"
  const nameByMid = new Map<string, string>();
  for (const batch of chunk([...allMids], 30)) {
    if (batch.length === 0) continue;
    const snap = await db.collectionGroup('members').where('mid', 'in', batch).get();
    for (const doc of snap.docs) {
      const m = doc.data() as { mid: string; firstName?: string; lastName?: string };
      nameByMid.set(m.mid, `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim());
    }
  }

  // 3) levelId → teacher names in teacherRefs order (skip unresolved / blank names)
  const out = new Map<string, string[]>();
  for (const [levelId, refs] of refsByLevel) {
    out.set(
      levelId,
      refs.map((mid) => nameByMid.get(mid)).filter((n): n is string => !!n && n.length > 0),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- get-bv-teacher-names`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/attendance/get-bv-teacher-names.ts apps/portal/src/features/setu/attendance/__tests__/get-bv-teacher-names.test.ts
git commit -m "feat(attendance): resolve BV level teacher names via bulk collectionGroup (Slice 1)"
```

---

### Task 5: Dashboard model + loader — actionItems, familyCounts, bvChildren

Extend the pure model with an `actionItems` array (derived from existing donation/enrollment fields), and extend the shared loader to assemble per-child `bvChildren` (level name + teacher names + attendance ratio) and `familyCounts` (children/adults). Keeping `bvChildren`/`familyCounts` on the loader's `FamilyDashboardData` (siblings of `upcoming`/`seva`/`prasad`) — NOT the pure model — keeps the model builder free of async assembly while still feeding both the web page and the mobile API from one place.

**Files:**
- Modify: `apps/portal/src/app/family/_helpers/dashboard-model.ts`
- Modify: `apps/portal/src/app/family/_helpers/load-dashboard.ts`
- Test: `apps/portal/src/app/family/__tests__/dashboard-model.test.ts`

**Interfaces:**
- Consumes: `getPerChildBalaViharAttendance` (Task 3), `getBvTeacherNames` (Task 4), `selectBalaViharEnrollment`, `isoToTorontoDateInput`, `MemberDoc.type`/`firstName`, `EnrollmentWithOffering.levelSnapshots[mid].levelId|levelName`.
- Produces:
  - On the model: `actionItems: ActionItem[]` where `export type ActionItem = { kind: 'donation'; title: string; ctaLabel: string }`.
  - On `FamilyDashboardData`: `bvChildren: BvChildView[]` and `familyCounts: { children: number; adults: number }`, where `export interface BvChildView { mid: string; firstName: string; levelName: string | null; teacherNames: string[]; attendance: { present: number; total: number } }`.

- [ ] **Step 1: Add the `ActionItem` type + model field to the test**

In `apps/portal/src/app/family/__tests__/dashboard-model.test.ts`, add a `describe('actionItems', …)` block. Use the existing `makeEnrollment`/`makeDonation` fixtures:

```ts
import { buildFamilyDashboardModel } from '../_helpers/dashboard-model';

describe('actionItems', () => {
  it('surfaces a donation action item when enrolled + portal-managed + unpaid', () => {
    const model = buildFamilyDashboardModel({
      enrollments: [BV_ENROLLMENT], donations: [], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([
      { kind: 'donation', title: 'Complete your Bala Vihar donation', ctaLabel: 'Donate' },
    ]);
  });
  it('has NO donation action item once the donation is complete', () => {
    const paid = makeDonation({ eid: BV_ENROLLMENT.eid, status: 'completed', amountCAD: 1000 });
    const model = buildFamilyDashboardModel({
      enrollments: [BV_ENROLLMENT], donations: [paid], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([]);
  });
  it('has NO donation action item when not enrolled', () => {
    const model = buildFamilyDashboardModel({
      enrollments: [], donations: [], programsById: new Map(),
      legacyPaymentStatus: null, bvAttendedCount: 0,
    });
    expect(model.actionItems).toEqual([]);
  });
});
```

(If `BV_ENROLLMENT`'s suggested amount makes `donationComplete` true at `givenForPeriod: 0`, it won't — `effectiveSuggestedAmount: 200 > 0` and `givenForPeriod 0 < 200` ⇒ incomplete ⇒ item present. Good.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- dashboard-model`
Expected: FAIL — `model.actionItems` is `undefined`.

- [ ] **Step 3: Add `actionItems` to the model**

In `apps/portal/src/app/family/_helpers/dashboard-model.ts`:

Add the exported type near the top (after imports):

```ts
/** A single actionable item on the dashboard's "Action Items" panel. Additive:
 *  Slice 2 will add a `{ kind: 'disclaimers'; … }` variant. Kept UI-path-free so
 *  the mobile API can serialize it and the client builds its own navigation. */
export type ActionItem = { kind: 'donation'; title: string; ctaLabel: string };
```

Add `actionItems: ActionItem[];` to the `FamilyDashboardModel` interface (after `enrolledPill`).

In `buildFamilyDashboardModel`, after `showGive`/`donationComplete` are computed and before the `return`, derive:

```ts
  // Derived action items (Slice 1). Donation is the only item today; it appears
  // only when the family is enrolled, the donation is portal-managed (showGive),
  // and it isn't already complete. Disclaimers (Slice 2) will append here.
  const actionItems: ActionItem[] = [];
  if (showGive && !donationComplete) {
    actionItems.push({ kind: 'donation', title: 'Complete your Bala Vihar donation', ctaLabel: 'Donate' });
  }
```

Add `actionItems,` to the returned object.

- [ ] **Step 4: Run the model test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- dashboard-model`
Expected: PASS.

- [ ] **Step 5: Extend the loader with `bvChildren` + `familyCounts`**

In `apps/portal/src/app/family/_helpers/load-dashboard.ts`:

Add imports:

```ts
import { getPerChildBalaViharAttendance } from '@/features/setu/attendance/get-per-child-attendance';
import { getBvTeacherNames } from '@/features/setu/attendance/get-bv-teacher-names';
```

Add the exported view type + extend `FamilyDashboardData`:

```ts
export interface BvChildView {
  mid: string;
  firstName: string;
  levelName: string | null;
  teacherNames: string[];
  attendance: { present: number; total: number };
}

export interface FamilyDashboardData {
  model: FamilyDashboardModel;
  upcoming: CalendarEntry[];
  seva: FamilySevaProgress;
  prasad: FamilyPrasadView | null;
  bvChildren: BvChildView[];
  familyCounts: { children: number; adults: number };
}
```

Compute `familyCounts` from `members` (cheap, no read) right after the first `Promise.all`:

```ts
  const familyCounts = {
    children: members.filter((m) => m.type === 'Child').length,
    adults: members.filter((m) => m.type === 'Adult').length,
  };
```

Extend the SECOND `Promise.all` (the one already gated on `bv`) to also compute per-child attendance + teacher names. Replace the existing 2-element second `Promise.all` with a 4-element one that keeps the existing `legacyPaymentStatus` + `bvAttendedCount` and adds the two new reads (all still gated on `bv`, all fail-soft):

```ts
  const [legacyPaymentStatus, bvAttendedCount, perChildAttendance, teacherNamesByLevel] =
    await Promise.all([
      isLegacyBvPeriod(enrollments) ? getLegacyPaymentStatus(family.legacyFid) : Promise.resolve(null),
      // (existing bvAttendedCount IIFE — leave it exactly as-is)
      (async (): Promise<number> => { /* …unchanged existing body… */ })(),
      // Per-child attendance ratios for the BV section. Fail-soft to an empty map.
      (async (): Promise<Map<string, { present: number; total: number }>> => {
        if (!bv) return new Map();
        try {
          const byMid = new Map(members.map((m): [string, MemberDoc] => [m.mid, m]));
          const children = bv.enrolledMids.map((mid) => ({ mid, legacySid: byMid.get(mid)?.legacySid ?? null }));
          return await getPerChildBalaViharAttendance({
            fid: family.fid,
            legacyFid: family.legacyFid,
            oid: bv.oid,
            windowStart: bv.offering ? isoToTorontoDateInput(bv.offering.startDate.toISOString()) : null,
            windowEnd: bv.offering?.endDate ? isoToTorontoDateInput(bv.offering.endDate.toISOString()) : null,
            children,
          });
        } catch (err) {
          console.warn('[load-dashboard] per-child BV attendance read failed — treating as empty', err);
          return new Map();
        }
      })(),
      // Teacher names per BV level (Task 4). Fail-soft to an empty map ⇒ the UI
      // shows level name with no teacher line. Reads only the levels this
      // family's enrolled children are actually in.
      (async (): Promise<Map<string, string[]>> => {
        if (!bv) return new Map();
        try {
          const levelIds = bv.enrolledMids
            .map((mid) => bv.levelSnapshots?.[mid]?.levelId ?? null)
            .filter((id): id is string => !!id);
          return await getBvTeacherNames(levelIds);
        } catch (err) {
          console.warn('[load-dashboard] BV teacher-name read failed — omitting teacher names', err);
          return new Map();
        }
      })(),
    ]);
```

Assemble `bvChildren` after the model is built (needs `bv` + members + the two maps):

```ts
  const byMidMember = new Map(members.map((m): [string, MemberDoc] => [m.mid, m]));
  const bvChildren: BvChildView[] = bv
    ? bv.enrolledMids.map((mid) => {
        const snap = bv.levelSnapshots?.[mid] ?? null;
        return {
          mid,
          firstName: byMidMember.get(mid)?.firstName ?? '',
          levelName: snap?.levelName ?? null,
          teacherNames: snap?.levelId ? (teacherNamesByLevel.get(snap.levelId) ?? []) : [],
          attendance: perChildAttendance.get(mid) ?? { present: 0, total: 0 },
        };
      })
    : [];
```

Return `{ model, upcoming, seva, prasad, bvChildren, familyCounts }`.

- [ ] **Step 6: Run the full family + attendance test suites**

Run: `pnpm --filter @cmt/portal test -- family/__tests__ features/setu/attendance`
Expected: PASS. Then `pnpm --filter @cmt/portal typecheck` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/family/_helpers/dashboard-model.ts apps/portal/src/app/family/_helpers/load-dashboard.ts apps/portal/src/app/family/__tests__/dashboard-model.test.ts
git commit -m "feat(family): actionItems + per-child bvChildren + familyCounts in dashboard model/loader (Slice 1)"
```

---

### Task 6: Rebuild the `/family` dashboard to three blocks (Part B)

Replace `apps/portal/src/app/family/page.tsx` with a three-block layout (Family · Action Items · one Bala Vihar section) on BOTH the mobile (`block md:hidden`) and desktop (`hidden md:block`) branches. Remove the email/phone nudge, volunteering nudge, Seva card, Prasad card, other-program cards, and the Upcoming/calendar card. Move the donate action into the BV section. Keep `PendingJoinRequestsPanel` (a genuine manager action item).

**Files:**
- Modify (full rewrite): `apps/portal/src/app/family/page.tsx`

**Interfaces:**
- Consumes: `loadFamilyDashboard` → `{ model, bvChildren, familyCounts }` (Task 5); `model.actionItems`, `model.donateUrl`, `model.enrolledPill`, `model.bvState`, `model.donation.showGive`, `model.teacherManaged`, `model.legacyPaid`, `model.enrollPeriodLabel`, `model.isEnrolled`, `model.kidsEnrolled`; `getCurrentFamily()` → `{ family, members, currentMid, isManager }`.

- [ ] **Step 1: Rewrite the page**

Replace the ENTIRE contents of `apps/portal/src/app/family/page.tsx` with:

```tsx
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuLogo, SetuAvatar } from '@cmt/ui';
import { CspRoot, Stat, MetricCard } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';
import { mockFamily } from '@/features/family/data/mock';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { PendingJoinRequestsPanel } from '@/features/family/components/pending-join-requests-panel';
import { loadFamilyDashboard, type BvChildView } from './_helpers/load-dashboard';
import {
  buildFamilyDashboardModel,
  type FamilyDashboardModel,
  type ActionItem,
} from './_helpers/dashboard-model';

/** The web href for an action item. Kept out of the model so the mobile API
 *  stays UI-path-free; the web maps each kind to its route here. Written as an
 *  if-chain (not a bare single-case switch) so it always returns a string under
 *  noImplicitReturns as new ActionItem kinds are added in Slice 2. */
function actionHref(item: ActionItem, model: FamilyDashboardModel): string {
  if (item.kind === 'donation') return model.donateUrl;
  return model.donateUrl; // fallback — unreachable today (donation is the only kind)
}

export default async function FamilyDashboardPage() {
  await connection();

  let managerName = 'Family member';
  let memberCount = mockFamily.members.length;
  let displayMembers: { name: string; mid?: string }[] = mockFamily.members.map((m) => ({ name: m.name }));
  let isManager = false;
  let model: FamilyDashboardModel = buildFamilyDashboardModel({
    enrollments: [], donations: [], programsById: new Map(), legacyPaymentStatus: null, bvAttendedCount: 0,
  });
  let bvChildren: BvChildView[] = [];
  let familyCounts = { children: 0, adults: 0 };

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) managerName = `${currentMember.firstName} ${currentMember.lastName}`;
      isManager = data.isManager;
      memberCount = data.members.length;
      displayMembers = data.members.map((m) => ({ name: `${m.firstName} ${m.lastName}`, mid: m.mid }));
      const dash = await loadFamilyDashboard(data.family, data.members);
      model = dash.model;
      bvChildren = dash.bvChildren;
      familyCounts = dash.familyCounts;
    }
  }

  const { isEnrolled, kidsEnrolled, enrollPeriodLabel, enrolledPill, actionItems } = model;
  const { complete: donationComplete } = model.donation;

  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto',
  });

  const donationPaid = model.legacyPaid || donationComplete;
  const donationStatus = model.teacherManaged ? 'Off-portal' : donationPaid ? 'Paid' : isEnrolled ? 'Pending' : 'Not enrolled';
  const donationStatusTone: 'ok' | 'warn' | 'err' = model.teacherManaged ? 'warn' : donationPaid ? 'ok' : 'err';

  const hasActions = actionItems.length > 0 || isManager;

  // Shared BV section body (identical logic on both layouts).
  const bvSection = (
    <>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Academic year" value={enrollPeriodLabel ?? '—'} />
        <Stat label="Registration" value={model.bvState === 'enrolled' ? 'Enrolled' : model.bvState === 'registered' ? 'Registered' : 'Not enrolled'} />
        <Stat label="Donation" value={donationStatus} />
      </div>
      {model.donation.showGive && !donationComplete && (
        <Link href={model.donateUrl} className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: 18 }}>
          Complete donation
        </Link>
      )}
      {bvChildren.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Children</div>
          {bvChildren.map((c) => (
            <div key={c.mid} className="between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.firstName || 'Child'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {c.levelName ?? 'Level pending'}
                  {c.teacherNames.length > 0 ? ` · ${c.teacherNames.join(', ')}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--accentDeep)' }}>
                {c.attendance.total > 0 ? `${c.attendance.present}/${c.attendance.total}` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
      {!isEnrolled && (
        <Link href="/family/enroll" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>
          Enroll now
        </Link>
      )}
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 22 }}>
              <SetuLogo size={18} />
              <SetuAvatar name={managerName} size={32} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>{todayLabel}</p>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                {firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}
              </h1>
            </div>

            {/* Block 1 — Family */}
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Family · {familyCounts.children} {familyCounts.children === 1 ? 'child' : 'children'} · {familyCounts.adults} {familyCounts.adults === 1 ? 'adult' : 'adults'}</span>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Manage family</Link>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {displayMembers.map((m, i) => {
                  const avatar = (<div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}><SetuAvatar name={m.name} size={36} /></div>);
                  return (
                    <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                      {m.mid ? <Link href={`/family/members/${m.mid}/profile`} className="focus-ring" title={m.name} style={{ display: 'inline-flex', borderRadius: '50%' }}>{avatar}</Link> : avatar}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Block 2 — Action Items */}
            {hasActions && (
              <div style={{ marginBottom: 12 }}>
                {isManager && <PendingJoinRequestsPanel compact />}
                {actionItems.map((item) => (
                  <div key={item.kind} className="card" style={{ padding: 16, marginTop: isManager ? 12 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{item.title}</div>
                    <Link href={actionHref(item, model)} className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>{item.ctaLabel}</Link>
                  </div>
                ))}
              </div>
            )}

            {/* Block 3 — Bala Vihar */}
            <div className="card" style={{ padding: 16 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em></span>
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
              </div>
              {bvSection}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header className="between" style={{ marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{todayLabel}</p>
            <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}</h1>
          </div>
        </header>

        {/* Block 1 — Family */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
          <MetricCard label="Children" value={String(familyCounts.children)} sub={`${familyCounts.adults} adult${familyCounts.adults !== 1 ? 's' : ''}`} />
          <MetricCard label="Bala Vihar" value={model.bvState === 'enrolled' ? 'Enrolled' : model.bvState === 'registered' ? 'Registered' : 'Not yet'} sub={enrollPeriodLabel ?? 'no active period'} />
          <MetricCard label="Donation" value={donationStatus} sub={enrollPeriodLabel ?? 'Bala Vihar'} tone={donationStatusTone} />
        </div>
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div className="between">
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Family · {memberCount} member{memberCount !== 1 ? 's' : ''}</h3>
            <Link href="/family/members" className="btn btn--s" style={{ textDecoration: 'none' }}>Manage family</Link>
          </div>
        </div>

        {/* Block 2 — Action Items */}
        {hasActions && (
          <div style={{ marginBottom: 18 }}>
            {isManager && <PendingJoinRequestsPanel />}
            {actionItems.length > 0 && (
              <div className="card" style={{ padding: 24, marginTop: isManager ? 18 : 0 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Action items</h3>
                <div className="col" style={{ gap: 12 }}>
                  {actionItems.map((item) => (
                    <div key={item.kind} className="between">
                      <span style={{ fontSize: 13 }}>{item.title}</span>
                      <Link href={actionHref(item, model)} className="btn btn--p" style={{ textDecoration: 'none' }}>{item.ctaLabel}</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Block 3 — Bala Vihar */}
        <div className="card" style={{ padding: 24 }}>
          <div className="between" style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</h3>
            <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
          </div>
          {bvSection}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint (catches unused imports and boundary violations)**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: PASS. If lint flags a now-unused helper import (`should-show-contacts-nudge`, `deriveSevaCardView`, etc.), it's because the rewrite dropped them — that's intended; the removed imports are gone from the new file. Leave the underlying helper FILES in place (do not delete) — only the page stops importing them.

- [ ] **Step 3: Run the family page-adjacent tests**

Run: `pnpm --filter @cmt/portal test -- family`
Expected: PASS. (There is no direct render test for `page.tsx`; the model/loader tests cover the logic. If a snapshot/DOM test references removed elements, update it.)

- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/app/family/page.tsx
git commit -m "feat(family): rebuild dashboard to 3 blocks — Family, Action Items, Bala Vihar (Slice 1 Part B)"
```

---

### Task 7: Hide Seva/Prasad routes + nav, calendar external link (Part C)

Guard `/family/seva` and `/family/prasad` behind their flags (redirect to `/family` when off), remove the Seva item from the family nav when off, and make the nav Calendar entry link out to the yearly PDF when `NEXT_PUBLIC_FAMILY_CALENDAR_URL` is set (otherwise unchanged).

**Files:**
- Modify: `apps/portal/src/app/family/seva/page.tsx`
- Modify: `apps/portal/src/app/family/prasad/page.tsx`
- Modify: `apps/portal/src/features/family/components/desktop-sidebar.tsx`
- Modify: `apps/portal/src/features/family/components/mobile-bottom-nav.tsx`
- Test: `apps/portal/src/features/family/components/__tests__/nav-programs.test.tsx` (extend — it already tests family nav items)

**Interfaces:**
- Consumes: `flags.setuSeva`, `flags.setuPrasad` (Task 2); `process.env.NEXT_PUBLIC_FAMILY_CALENDAR_URL` (literal access).

- [ ] **Step 1: Guard the two family routes**

At the very top of the default export in `apps/portal/src/app/family/seva/page.tsx`, before any data read, add:

```ts
import { redirect } from 'next/navigation';
import { flags } from '@/lib/flags';
// …inside the async page component, first line:
if (!flags.setuSeva) redirect('/family');
```

Do the same in `apps/portal/src/app/family/prasad/page.tsx` with `flags.setuPrasad`. (Both `flags.setuSeva`/`setuPrasad` are `false` by default, so families hitting these routes bounce to `/family`.)

- [ ] **Step 2: Gate the Seva nav item + calendar external link (desktop sidebar)**

In `apps/portal/src/features/family/components/desktop-sidebar.tsx`, replace the module-level `FAMILY_NAV_ITEMS` constant with a builder that filters Seva out when the flag is off and swaps the Calendar href when an external URL is configured. Add `import { flags } from '@/lib/flags';` at the top, then:

```ts
const FAMILY_CALENDAR_URL = process.env.NEXT_PUBLIC_FAMILY_CALENDAR_URL;

function familyNavItems(): [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] {
  const items: [SidebarTab, string, keyof typeof SetuIcon, string, boolean?][] = [
    ['home', 'Home', 'home', '/family'],
    ['family', 'My family', 'people', '/family/members'],
    ['programs', 'Programs', 'grid', '/family/programs'],
  ];
  if (flags.setuSeva) items.push(['seva', 'Seva', 'heart', '/family/seva']);
  // Calendar links out to the yearly PDF when configured (owner decision B8);
  // otherwise it keeps the in-portal route. External is signalled by an absolute
  // http(s) href, which the render step below opens in a new tab.
  items.push(['calendar', 'Calendar', 'calendar', FAMILY_CALENDAR_URL ?? '/family/calendar']);
  items.push(['security', 'Sign-in security', 'shield', '/family/settings/security']);
  return items;
}
```

Replace the `const navItems = role === 'welcome-team' ? WELCOME_NAV_ITEMS : FAMILY_NAV_ITEMS;` line with `const navItems = role === 'welcome-team' ? WELCOME_NAV_ITEMS : familyNavItems();`.

In the `navItems.map(…)` render, make an absolute `http` href render as a plain `<a target="_blank" rel="noopener noreferrer">` instead of `<Link>`:

```tsx
          const isExternal = /^https?:\/\//.test(href);
          return disabled ? (
            /* …unchanged disabled branch… */
          ) : isExternal ? (
            <a key={id} href={href} target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 'var(--radiusSm)', background: 'transparent', color: 'var(--body-text)',
              fontWeight: 500, textDecoration: 'none',
            }}>
              <Icon /> {label}
            </a>
          ) : (
            /* …unchanged internal <Link> branch… */
          );
```

- [ ] **Step 3: Gate Seva in the mobile "More" sheet + calendar external link**

In `apps/portal/src/features/family/components/mobile-bottom-nav.tsx`, add `import { flags } from '@/lib/flags';`, then replace the static `MORE_ITEMS` const with a filtered builder:

```ts
const FAMILY_CALENDAR_URL = process.env.NEXT_PUBLIC_FAMILY_CALENDAR_URL;

function moreItems(): { label: string; icon: keyof typeof SetuIcon; href: string; external?: boolean }[] {
  const items: { label: string; icon: keyof typeof SetuIcon; href: string; external?: boolean }[] = [];
  if (flags.setuSeva) items.push({ label: 'Seva', icon: 'heart', href: '/family/seva' });
  items.push(
    FAMILY_CALENDAR_URL
      ? { label: 'Calendar', icon: 'calendar', href: FAMILY_CALENDAR_URL, external: true }
      : { label: 'Calendar', icon: 'calendar', href: '/family/calendar' },
  );
  items.push({ label: 'Sign-in security', icon: 'shield', href: '/family/settings/security' });
  return items;
}
```

In `MobileBottomNav`, compute `const MORE_ITEMS = moreItems();` at the top of the component body, and in the `.map`, render `m.external` items as `<a target="_blank" rel="noopener noreferrer">` (keeping the same styles) instead of `<Link>`.

- [ ] **Step 4: Extend the nav test**

In `apps/portal/src/features/family/components/__tests__/nav-programs.test.tsx`, add assertions that the family sidebar does NOT render a "Seva" link by default (flag off). Follow the file's existing render+query pattern:

```tsx
it('hides the Seva nav item from families when setuSeva is off (default)', () => {
  render(<DesktopSidebar role="family" />);
  expect(screen.queryByText('Seva')).toBeNull();
});
```

(If the test file mocks `flags`, set `setuSeva: false`. If it imports the real `flags`, the vitest env leaves the env var unset ⇒ `false`, so the query is null without extra mocking.)

- [ ] **Step 5: Run nav tests + typecheck**

Run: `pnpm --filter @cmt/portal test -- nav-programs desktop-sidebar && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/family/seva/page.tsx apps/portal/src/app/family/prasad/page.tsx apps/portal/src/features/family/components/desktop-sidebar.tsx apps/portal/src/features/family/components/mobile-bottom-nav.tsx apps/portal/src/features/family/components/__tests__/nav-programs.test.tsx
git commit -m "feat(family): hide Seva/Prasad routes+nav, external calendar link (Slice 1 Part C)"
```

---

### Task 8: Profile completeness on the member pages (Part D)

Show a "Complete / Missing info" indicator per member on the My-Family roster (`/family/members`) and on the per-member profile, using the shared required-fields matrix. This replaces the removed dashboard nudges.

**Files:**
- Modify: `apps/portal/src/app/family/members/member-display.ts` (add `missingCount` to `DisplayMember`)
- Modify: `apps/portal/src/app/family/members/page.tsx` (render the chip)
- Test: `apps/portal/src/app/family/members/__tests__/member-display.test.ts` (create/extend)

**Interfaces:**
- Consumes: `whatsMissingForMember` / `isMemberComplete` from `@cmt/shared-domain` (the `member-required-fields` helper); `MemberDoc`.
- Produces: `DisplayMember` gains `missingCount: number` (0 ⇒ complete).

- [ ] **Step 1: Write the failing test for `memberToDisplay` missingCount**

Read `member-display.ts` first to learn `memberToDisplay(member, currentMid)`'s current return shape and the `MemberDoc` fixture style. Then in `apps/portal/src/app/family/members/__tests__/member-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { memberToDisplay } from '../member-display';
import type { MemberDoc } from '@cmt/shared-domain';

function member(over: Partial<MemberDoc>): MemberDoc {
  return {
    mid: 'FAM1-03', fid: 'FAM1', type: 'Child', firstName: 'Aarav', lastName: 'Shah',
    gender: 'Male', foodAllergies: 'None', schoolGrade: '3', birthMonthYear: '2017-05',
    // …fill remaining required MemberDoc fields to satisfy the type (copy the
    // canonical fixture from an existing members test),
    ...over,
  } as MemberDoc;
}

describe('memberToDisplay missingCount', () => {
  it('is 0 for a fully-complete child', () => {
    expect(memberToDisplay(member({}), 'FAM1-01').missingCount).toBe(0);
  });
  it('counts a child missing schoolGrade + birthMonthYear as 2', () => {
    const m = member({ schoolGrade: null, birthMonthYear: null });
    expect(memberToDisplay(m, 'FAM1-01').missingCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- member-display`
Expected: FAIL — `missingCount` is `undefined`.

- [ ] **Step 3: Add `missingCount` to `memberToDisplay`**

In `apps/portal/src/app/family/members/member-display.ts`: add `import { whatsMissingForMember } from '@cmt/shared-domain';`, add `missingCount: number;` to the `DisplayMember` interface, and set `missingCount: whatsMissingForMember(member).length` in the returned object (the function already receives the full `MemberDoc`, which is assignable to `MemberCompletenessInput`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal test -- member-display`
Expected: PASS.

- [ ] **Step 5: Render the chip on the roster page**

In `apps/portal/src/app/family/members/page.tsx`, add a small "Missing info" chip on each member card (both mobile and desktop branches) when `m.missingCount > 0`, linking to that member's edit screen. Mobile — inside the member `<Link>`'s text column, after the `m.type` line:

```tsx
{m.missingCount > 0 && (
  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--warn, #a06410)', fontWeight: 600 }}>
    {m.missingCount} field{m.missingCount !== 1 ? 's' : ''} to complete
  </div>
)}
```

Desktop — add a chip next to the member's name/type, before the action buttons:

```tsx
{m.missingCount > 0 && (
  <Link href={`/family/members/${m.mid}/edit`} className="pill" style={{ background: 'var(--setu-warn-soft)', color: 'var(--warn, #a06410)', textDecoration: 'none', fontSize: 11 }}>
    Complete info ({m.missingCount})
  </Link>
)}
```

The mock-path members (non-setuAuth) set `missingCount: 0` — add `missingCount: 0` to the mock mapping at `members/page.tsx:16-29` so the type is satisfied.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint`
Expected: PASS.

```bash
git add apps/portal/src/app/family/members/member-display.ts apps/portal/src/app/family/members/page.tsx apps/portal/src/app/family/members/__tests__/member-display.test.ts
git commit -m "feat(family): show per-member 'missing info' completeness chip (Slice 1 Part D)"
```

---

### Task 9: Mobile API parity + changelog (Part E)

Serialize the new dashboard data (`bvChildren`, `familyCounts`, `actionItems`) additively in `GET /api/setu/dashboard`, and append the SHA-keyed `MOBILE_API_CHANGELOG.md` entry. `bvState` semantics widen (Part A) — call that out too.

**Files:**
- Modify: `apps/portal/src/app/api/setu/dashboard/route.ts`
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`
- Test: `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts` (create/extend if a route test exists; otherwise add a focused one)

**Interfaces:**
- Consumes: `loadFamilyDashboard` → `{ model, bvChildren, familyCounts }`; `model.actionItems`.
- Produces: the 200 JSON gains `family.counts: { children, adults }`, `balaVihar.children: BvChildView[]`, and top-level `actionItems: ActionItem[]`. All additive; no existing field changes.

- [ ] **Step 1: Add the fields to the route**

In `apps/portal/src/app/api/setu/dashboard/route.ts`, destructure the new loader fields and add them to the JSON. Change `const { model, upcoming, seva, prasad } = …` to include `bvChildren, familyCounts`, then:

- add `counts: familyCounts,` inside the `family: { … }` object;
- add `children: bvChildren,` inside the `balaVihar: { … }` object;
- add a top-level `actionItems: model.actionItems,` (alongside `otherPrograms`).

`bvChildren` and `actionItems` are already plain-serializable (no Date, no CSS). Confirm no field is a `Map` (they aren't — `bvChildren` is an array, `actionItems` is an array).

- [ ] **Step 2: Add/extend a route test asserting the new fields (N=2 children)**

If `apps/portal/src/app/api/setu/dashboard/__tests__/route.test.ts` exists, extend it; else create it mocking `flags.setuAuth = true`, `getSessionFamily`, and `loadFamilyDashboard` to return a 2-child `bvChildren` + a donation `actionItems`. Assert the response JSON includes `body.family.counts`, `body.balaVihar.children.length === 2`, and `body.actionItems[0].kind === 'donation'`. Follow the mocking pattern of the nearest existing `api/setu/**/__tests__/route.test.ts`. **Remember to mock `next/cache` `revalidateTag`** if the route or its deps touch it (they don't here, but the loader's deps might) — see the E2E/route testing memory.

- [ ] **Step 3: Run the route test + typecheck**

Run: `pnpm --filter @cmt/portal test -- api/setu/dashboard && pnpm --filter @cmt/portal typecheck`
Expected: PASS.

- [ ] **Step 4: Append the MOBILE_API_CHANGELOG entry**

Prepend a new entry at the top of the change list in `apps/portal/docs/MOBILE_API_CHANGELOG.md` (newest first, after the intro block). Use the pending commit SHA placeholder `<SHA>` — it will be filled with the actual commit hash (leave a note to update it post-commit, matching the file's convention):

```markdown
## `<SHA>` · 2026-07-06 · dashboard gains per-child BV assignments/attendance, family counts, action items; bvState semantics widen (Slice 1)
- **GET `/api/setu/dashboard`** — additive fields:
  - `family.counts: { children: number; adults: number }` — the family's child/adult split.
  - `balaVihar.children: Array<{ mid, firstName, levelName: string | null, teacherNames: string[], attendance: { present: number; total: number } }>` — per enrolled child, their level name, assigned teacher name(s), and Sunday attendance ratio (present+late over total in-window).
  - `actionItems: Array<{ kind: 'donation'; title: string; ctaLabel: string }>` — the family's outstanding actions (donation only today; more `kind`s coming in Slice 2). No web paths — the client builds its own navigation from `kind`.
  - **`balaVihar.bvState` semantics WIDEN** (Part A): `'enrolled'` now also covers a `family-initiated` (clicked Enroll, even $0) or `first-attendance` (teacher auto-enrolled) enrollment, in addition to the prior engaged/donated/legacy-paid triggers. Values unchanged (`'enrolled' | 'registered' | 'none'`); only more families read `'enrolled'`. `'registered'` now only occurs for `promotion`/`welcome-team` carry-forwards with zero engagement.
  - **All additive** — no existing field changed; `isEnrolled` unchanged.
  - **Mobile:** add `family.counts`, `balaVihar.children`, and `actionItems` to the dashboard schema. Render the 3-block layout (Family · Action Items · Bala Vihar). Drive the BV pill from `bvState` (green Enrolled / amber Registered / grey Not enrolled) — no code change needed for the widened semantics, but the amber "Registered" state will now appear for fewer families.
```

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/dashboard/route.ts apps/portal/src/app/api/setu/dashboard/__tests__ apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(api): dashboard gains bvChildren/familyCounts/actionItems additively (Slice 1 Part E)"
```

- [ ] **Step 6: Backfill the changelog SHA**

After the commit lands, replace `<SHA>` in `MOBILE_API_CHANGELOG.md` with the actual short hash of the Task-9 commit (or the final Slice-1 squash/merge commit, per repo convention), and amend:

```bash
git add apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit --amend --no-edit
```

---

### Task 10: Deployed-UAT E2E (verification gate — DO NOT run until the owner resumes)

Write the Playwright spec that exercises the rebuilt dashboard against real deployed UAT: a `family-initiated` (clicked-Enroll, $0) family reads **Enrolled** with donation **Pending** and a **Complete donation** button in the BV section; the dashboard shows the Family card + Manage family and does NOT render Seva/Prasad/programs/calendar cards or the email/phone nudge; a `promotion`-only family still reads **Registered**. Reuse the issue #23 seed fixture, extended for `enrolledVia` + a level/teacher assignment.

**This task's spec is WRITTEN now but RUN at the resume gate** — per the session rhythm (same as issue #23), pause before live-UAT verification and let the owner trigger the run.

**Files:**
- Modify: `apps/portal/scripts/seed-e2e-family.ts` (add an `--enrolled-via <mode>` flag + optional level assignment)
- Create: `apps/portal/e2e/setu/dashboard-slice1.spec.ts`
- Reference: `apps/portal/e2e/setu/enrollment-state.spec.ts` (issue #23 — the sibling pattern), `apps/portal/e2e/auth-helpers.ts` (post-reseed re-auth).

**Interfaces:**
- Consumes: the `setu` Playwright project, `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`, password sign-in, `_test:true` fixtures; `signInFamilyAndSaveStorage` from `e2e/auth-helpers.ts` after any mid-suite reseed (a reseed bumps `tokensValidAfterTime` and kills the session — memory `feedback_e2e_reseed_invalidates_session`).

- [ ] **Step 1: Add an `--enrolled-via` flag (+ optional level snapshot) to the seed**

In `apps/portal/scripts/seed-e2e-family.ts`, read `--enrolled-via` from `process.argv` (values `family-initiated | promotion`, default the existing `promotion` for the active BV — line ~309) and thread it into the active-BV `ensureEnrollment` call. Also write a `levelSnapshots[childMid] = { schoolGrade, levelId, levelName }` on the active BV enrollment so the "Class Assignments" line has data (pick a real UAT level for the seed's location, or a synthetic `levelName: 'Level 2'` with `levelId: null` — `null` levelId means no teacher lookup, which still renders the level name). Keep it idempotent.

- [ ] **Step 2: Write the E2E spec**

Create `apps/portal/e2e/setu/dashboard-slice1.spec.ts`. Structure it as serial phases (mirror `enrollment-state.spec.ts`), re-authenticating in each phase's `beforeAll` after any `execSync` reseed:

```ts
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { signInFamilyAndSaveStorage } from '../auth-helpers';

const SEED = 'pnpm --filter @cmt/portal seed:e2e-family';

test.describe.serial('Slice 1 dashboard', () => {
  test.describe('family-initiated → Enrolled + Pending', () => {
    test.beforeAll(async ({ request }) => {
      execSync(`${SEED} -- --enrolled-via family-initiated`, { stdio: 'inherit' });
      await signInFamilyAndSaveStorage(request); // reseed killed the session
    });

    test('dashboard shows Enrolled, donation Pending, Complete donation button in BV section', async ({ page }) => {
      await page.goto('/family');
      await expect(page.getByText('Bala Vihar')).toBeVisible();
      await expect(page.getByText('Enrolled')).toBeVisible();
      await expect(page.getByRole('link', { name: /complete donation/i })).toBeVisible();
    });

    test('dashboard does NOT render Seva, Prasad, or an email/phone nudge', async ({ page }) => {
      await page.goto('/family');
      await expect(page.getByText(/seva/i)).toHaveCount(0);
      await expect(page.getByText(/prasad/i)).toHaveCount(0);
      await expect(page.getByText(/add your (email|phone|other contacts)/i)).toHaveCount(0);
    });

    test('dashboard shows the Family card + Manage family', async ({ page }) => {
      await page.goto('/family');
      await expect(page.getByRole('link', { name: /manage family/i })).toBeVisible();
    });
  });

  test.describe('promotion-only → still Registered', () => {
    test.beforeAll(async ({ request }) => {
      execSync(`${SEED} -- --enrolled-via promotion`, { stdio: 'inherit' });
      await signInFamilyAndSaveStorage(request);
    });
    test('a promotion enrollment with no engagement reads Registered', async ({ page }) => {
      await page.goto('/family');
      await expect(page.getByText('Registered')).toBeVisible();
    });
  });
});
```

Adjust selectors to the actual rendered text/roles from Task 6 (the `getByText('Seva')` guard passes because the flag is OFF in UAT unless `NEXT_PUBLIC_FEATURE_SETU_SEVA=true` is set there — confirm it is NOT set in the UAT Vercel env before relying on the assertion; if Seva is somehow on in UAT, scope the assertion to the dashboard region).

- [ ] **Step 3: Typecheck the spec (do NOT run the suite yet)**

Run: `pnpm --filter @cmt/portal typecheck`
Expected: PASS. **Stop here — do not run `test:e2e`.** Commit the spec + seed change:

```bash
git add apps/portal/scripts/seed-e2e-family.ts apps/portal/e2e/setu/dashboard-slice1.spec.ts
git commit -m "test(e2e): Slice 1 dashboard — Enrolled-on-click, hides, family card (write-only, run at gate)"
```

- [ ] **Step 4: PAUSE — hand back to the owner for the live-UAT verification gate**

Report: plan complete, all unit tests green, E2E written but not run. Ask the owner to confirm before running the deployed-UAT E2E (`pnpm --filter @cmt/portal test:e2e -- dashboard-slice1` with `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`), because it seeds/mutates UAT and shares the 5-per-15-min sign-in limiter. This is the issue-#23 rhythm: **pause before live-UAT verify.**

---

## Post-implementation (after the owner approves the UAT run)

- Run the deployed-UAT E2E; fix any integration-layer surprises (index enforcement, cache/redirect gates) the mocked unit tests can't see (`verifying-setu-changes-in-uat` skill).
- Update `docs/runbooks/production-cutover-checklist.md`: §14 dated entry noting the two new OFF-by-default flags (`NEXT_PUBLIC_FEATURE_SETU_SEVA/PRASAD`) + the optional `NEXT_PUBLIC_FAMILY_CALENDAR_URL`, the widened `bvState` semantics (a prod deploy flips more families to "Enrolled"), and the additive dashboard-API fields. No new Firestore indexes are introduced (the `members.mid` collection-group index used by `getBvTeacherNames` is already deployed).
- Confirm the MOBILE_API_CHANGELOG `<SHA>` was backfilled.

## Notes / deferred (from the spec)

- **Teacher names (Task 4) are droppable.** If the reviewer or a UAT surprise makes the level/member reads too heavy for the dashboard, ship level-name-only: the loader already fails-soft to an empty teacher map, so removing the Task-4 wiring leaves the UI rendering level names with no teacher line and nothing else breaks.
- **Calendar external link** activates only when `NEXT_PUBLIC_FAMILY_CALENDAR_URL` is set; until the owner provides the PDF URL, the nav Calendar entry keeps its in-portal route (the dashboard calendar card is removed regardless).
- **Action Items is thin** until Slice 2 adds the disclaimer item — acceptable (donation is the main one). The `ActionItem` union is built to extend.
- **Seva/Prasad reads still run in the loader** (the API keeps returning `seva`/`prasad`/`upcoming` additively for mobile); only the web dashboard stops rendering them. Trim later if the extra latency matters.
```
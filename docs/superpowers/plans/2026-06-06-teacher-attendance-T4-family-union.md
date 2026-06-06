# Teacher Attendance T4 — Family-facing attendance union Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three family-facing Bala Vihar attendance surfaces (the child profile per-program attendance, the family-dashboard BV card, the member-detail page) show the **union** of teacher-marked `attendanceEvents` (authoritative) and door self-check-ins — instead of door-only today — using the T1 resolver, while preserving the `selectBalaViharEnrollment`/programKey N=2 safety.

**Architecture:** BV keeps `attendanceMode: 'check-in'` (a flip to `'teacher'` would *drop* door check-ins). The pure `resolveMemberAttendance` (T1) merges per-member portal marks (win) with door check-ins. Per-member surfaces (child profile, member detail) resolve a single member. The **family** dashboard is "did any enrolled child attend that Sunday" — so a new family reader resolves **per child, then folds by date (best status across children)**, which avoids the cross-child overwrite trap (child A teacher-absent must not erase child B door-present). All three surfaces keep their existing offering-window scoping (door has no offering link) and their existing UI; only the data source changes.

**Tech Stack:** Next.js 16 (server components), TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest, the T1 `resolve-attendance.ts` / `get-member-attendance.ts` / `get-attendance.ts` readers.

---

## Standing constraints (do not violate)

- **Portal writes UAT only**; door reads are read-only via the T1 seam. T4 adds **no writes** and **no new Firestore index** (reuses `attendanceEvents (fid, date DESC)` and `(mid, date DESC)`, already deployed).
- **N=2 lint tripwire** (`apps/portal/eslint.config.js`): in `app/family/page.tsx` and `app/family/members/**/page.tsx`, NEVER write `e.status === 'active'` inline — always go through `selectBalaViharEnrollment()` / `buildFamilyDashboardModel()`. Calling those helpers is the sanctioned path.
- **N=2 correctness:** any family-level fold must treat each child's attendance independently (portal-wins is *per child*); a teacher-absent for one child must never erase a door-present for a sibling on the same date. Add a 2-child fixture proving it.
- `exactOptionalPropertyTypes` ON — never assign `undefined` to optional; use `null` / conditional spread.
- **Run the FULL `pnpm --filter @cmt/portal lint`** before every commit (the recurring unused-`describe`/import trap). Pre-push hook runs `typecheck && lint && test && build`; never `--no-verify`.
- Spawn all subagents on **Opus**.

## File structure

**Modify:**
- `apps/portal/src/features/setu/attendance/resolve-attendance.ts` — export `STATUS_RANK`, `summarizeResolvedMarks`, `EMPTY_RESOLVED_SUMMARY` (internal refactor; `resolveMemberAttendance` reuses them).
- `apps/portal/src/features/setu/attendance/get-member-attendance.ts` — add optional `windowStart`/`windowEnd` (scope the door side).
- `apps/portal/src/features/setu/members/get-child-profile.ts` — union the `check-in` branch.
- `apps/portal/src/app/family/members/[mid]/page.tsx` — swap door-only read for `getMemberUnifiedAttendance`; adapt `AttendanceSummaryBlock`.
- `apps/portal/src/app/family/_helpers/dashboard-model.ts` — input takes `bvAttendance: ResolvedSummary` (was `rawCheckIns`); attendance section formats it.
- `apps/portal/src/app/family/page.tsx` — compute the BV union via the new reader, pass `bvAttendance` into the model.

**Create:**
- `apps/portal/src/features/setu/attendance/get-family-attendance.ts` — `getFamilyBalaViharAttendance(args)` family-level union reader.
- `apps/portal/src/features/setu/attendance/__tests__/get-family-attendance.test.ts`.

**Test (update):** `resolve-attendance.test.ts` (stays green post-refactor), `get-member-attendance.test.ts` (window), `get-child-profile.test.ts` (union), `app/family/__tests__/dashboard-model.test.ts` (input shape).

---

## Task 1: resolve-attendance refactor + family-level union reader

**Files:**
- Modify: `apps/portal/src/features/setu/attendance/resolve-attendance.ts`
- Create: `apps/portal/src/features/setu/attendance/get-family-attendance.ts`
- Create: `apps/portal/src/features/setu/attendance/__tests__/get-family-attendance.test.ts`
- Test (regression): `apps/portal/src/features/setu/attendance/__tests__/resolve-attendance.test.ts` (must stay green unchanged)

- [ ] **Step 1: Refactor `resolve-attendance.ts`** — export the rank, the summarizer, and an empty constant; have `resolveMemberAttendance` reuse them. Replace the file's body from `STATUS_RANK` downward with:

```ts
// When a member has more than one portal mark on the same date (e.g. enrolled
// in two levels under one program), the attended status wins deterministically
// — present > late > absent — so a stray absent can never silently overwrite an
// attendance. (Guards the N=2 / one→many trap; door marks are unique per date.)
export const STATUS_RANK: Record<SetuAttendanceStatus, number> = { present: 2, late: 1, absent: 0 };

/** Build a ResolvedSummary from already-merged marks (any order). */
export function summarizeResolvedMarks(marks: ReadonlyArray<ResolvedMark>): ResolvedSummary {
  const sorted = [...marks].sort((a, b) => a.date.localeCompare(b.date));
  const present = sorted.filter((m) => m.status === 'present').length;
  const late = sorted.filter((m) => m.status === 'late').length;
  const absent = sorted.filter((m) => m.status === 'absent').length;
  const total = sorted.length;
  const attendedPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return { present, late, absent, total, attendedPct, marks: sorted };
}

/** A zero-attendance summary (no BV enrollment / no data). */
export const EMPTY_RESOLVED_SUMMARY: ResolvedSummary = {
  present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [],
};

/**
 * Merge a member's portal attendance marks (authoritative) with their door
 * check-ins into one timeline. Per date: a portal mark wins; otherwise a door
 * check-in maps to 'present' and a door recorded-but-not-checked-in maps to
 * 'absent'. Portal marks are richer (present/late/absent); door is binary.
 */
export function resolveMemberAttendance(
  portalMarks: ReadonlyArray<{ date: string; status: SetuAttendanceStatus }>,
  doorMarks: ReadonlyArray<{ date: string; present: boolean }>,
): ResolvedSummary {
  const byDate = new Map<string, ResolvedMark>();

  // Door first (lower precedence).
  for (const d of doorMarks) {
    byDate.set(d.date, { date: d.date, status: d.present ? 'present' : 'absent', source: 'door' });
  }
  // Portal overrides door. Among multiple same-date portal marks, the
  // higher-ranked (more-attended) status wins — never insertion order.
  for (const p of portalMarks) {
    const existing = byDate.get(p.date);
    const portalWins =
      !existing ||
      existing.source === 'door' ||
      STATUS_RANK[p.status] > STATUS_RANK[existing.status];
    if (portalWins) {
      byDate.set(p.date, { date: p.date, status: p.status, source: 'portal' });
    }
  }

  return summarizeResolvedMarks([...byDate.values()]);
}
```

Leave the imports + the `ResolvedSource`/`ResolvedMark`/`ResolvedSummary` type declarations (lines 1–18) unchanged.

- [ ] **Step 2: Run the resolver regression test (must stay green unchanged)**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/resolve-attendance.test.ts`
Expected: PASS (the refactor is behavior-preserving).

- [ ] **Step 3: Write the failing family-reader test** (`get-family-attendance.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFamilyEvents, mockDoor } = vi.hoisted(() => ({ mockFamilyEvents: vi.fn(), mockDoor: vi.fn() }));
vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForFamily: mockFamilyEvents }));
vi.mock('../check-in-attendance', async () => {
  const actual = await vi.importActual<typeof import('../check-in-attendance')>('../check-in-attendance');
  return { ...actual, getCheckInAttendance: mockDoor };
});

import { getFamilyBalaViharAttendance } from '../get-family-attendance';

beforeEach(() => { vi.clearAllMocks(); });

const ARGS = {
  fid: 'CMT-F', legacyFid: '4421', oid: 'o-bv',
  windowStart: '2025-09-01', windowEnd: '2026-06-30',
  children: [
    { mid: 'CMT-F-02', legacySid: 'S8' },
    { mid: 'CMT-F-03', legacySid: 'S9' },
  ],
};

it('N=2: a teacher-absent for one child never erases a sibling door-present on the same date', async () => {
  // Date D: child -02 teacher-marked ABSENT; child -03 door-checked-in PRESENT.
  mockFamilyEvents.mockResolvedValue([
    { aid: 'a', mid: 'CMT-F-02', fid: 'CMT-F', levelId: 'l', pid: 'o-bv', date: '2025-10-05', status: 'absent', isGuest: false },
  ]);
  mockDoor.mockResolvedValue([
    { date: '2025-10-05', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
  ]);
  const s = await getFamilyBalaViharAttendance(ARGS);
  // Family attended that Sunday because -03 was present, despite -02's absent.
  const d = s.marks.find((m) => m.date === '2025-10-05');
  expect(d?.status).toBe('present');
  expect(s.present).toBe(1);
  expect(s.total).toBe(1);
});

it('portal teacher mark wins over door for the SAME child', async () => {
  mockFamilyEvents.mockResolvedValue([
    { aid: 'a', mid: 'CMT-F-03', fid: 'CMT-F', levelId: 'l', pid: 'o-bv', date: '2025-10-12', status: 'late', isGuest: false },
  ]);
  mockDoor.mockResolvedValue([
    { date: '2025-10-12', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
  ]);
  const s = await getFamilyBalaViharAttendance(ARGS);
  const d = s.marks.find((m) => m.date === '2025-10-12');
  expect(d).toMatchObject({ status: 'late', source: 'portal' });
});

it('filters portal events to the offering oid and door records to the window', async () => {
  mockFamilyEvents.mockResolvedValue([
    { aid: 'a', mid: 'CMT-F-03', fid: 'CMT-F', levelId: 'l', pid: 'o-OTHER', date: '2025-10-19', status: 'present', isGuest: false }, // wrong oid → excluded
  ]);
  mockDoor.mockResolvedValue([
    { date: '2024-01-01', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // before window → excluded
    { date: '2025-11-02', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // in window
  ]);
  const s = await getFamilyBalaViharAttendance(ARGS);
  expect(s.marks.map((m) => m.date)).toEqual(['2025-11-02']);
  expect(s.present).toBe(1);
});

it('returns an empty summary when there are no children', async () => {
  mockFamilyEvents.mockResolvedValue([]);
  mockDoor.mockResolvedValue([]);
  const s = await getFamilyBalaViharAttendance({ ...ARGS, children: [] });
  expect(s).toEqual({ present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [] });
});
```

- [ ] **Step 4: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/get-family-attendance.test.ts`
Expected: FAIL — module `../get-family-attendance` not found.

- [ ] **Step 5: Implement the family reader** (`get-family-attendance.ts`)

```ts
import { getAttendanceForFamily } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import {
  resolveMemberAttendance,
  summarizeResolvedMarks,
  STATUS_RANK,
  type ResolvedMark,
  type ResolvedSummary,
} from './resolve-attendance';

export interface FamilyBvAttendanceArgs {
  fid: string;
  legacyFid: string | null;
  /** The BV enrollment's offering id (oid) — only portal events for it count. */
  oid: string;
  /** Door-side window (YMD) from the BV offering; null = unbounded that side. */
  windowStart: string | null;
  windowEnd: string | null;
  /** The BV-enrolled children (mid + legacySid for the door link). */
  children: ReadonlyArray<{ mid: string; legacySid: string | null }>;
}

/**
 * Family-level BV attendance = the UNION of teacher `attendanceEvents` and door
 * self-check-ins, answering "did ANY enrolled child attend that Sunday?". Each
 * child is resolved INDEPENDENTLY (portal wins per child) and then folded by
 * date taking the best status across children — so one child's teacher-absent
 * can never erase a sibling's door-present (the N=2 trap). Door records are
 * window-scoped (door has no offering link); portal events are oid-filtered.
 */
export async function getFamilyBalaViharAttendance(args: FamilyBvAttendanceArgs): Promise<ResolvedSummary> {
  const [familyEvents, doorRecords] = await Promise.all([
    getAttendanceForFamily(args.fid),
    getCheckInAttendance(args.legacyFid),
  ]);

  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);

  const byDate = new Map<string, ResolvedMark>();
  for (const child of args.children) {
    const portalMarks = familyEvents
      .filter((e) => e.mid === child.mid && e.pid === args.oid)
      .map((e) => ({ date: e.date, status: e.status }));
    const doorMarks = summarizeMemberCheckIns(scopedDoor, child.legacySid).marks;
    const resolved = resolveMemberAttendance(portalMarks, doorMarks);
    for (const m of resolved.marks) {
      const cur = byDate.get(m.date);
      if (!cur || STATUS_RANK[m.status] > STATUS_RANK[cur.status]) byDate.set(m.date, m);
    }
  }

  return summarizeResolvedMarks([...byDate.values()]);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/get-family-attendance.test.ts src/features/setu/attendance/__tests__/resolve-attendance.test.ts`
Expected: PASS (both files).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/attendance/resolve-attendance.ts apps/portal/src/features/setu/attendance/get-family-attendance.ts apps/portal/src/features/setu/attendance/__tests__/get-family-attendance.test.ts
git commit -m "feat(attendance): family-level BV attendance union reader (T4)"
```

---

## Task 2: window-scope `getMemberUnifiedAttendance`

The per-member reader (used by the member-detail page) must scope the door side to the offering window, matching the existing surfaces.

**Files:**
- Modify: `apps/portal/src/features/setu/attendance/get-member-attendance.ts`
- Test: `apps/portal/src/features/setu/attendance/__tests__/get-member-attendance.test.ts`

- [ ] **Step 1: Add the failing window test** (append to `get-member-attendance.test.ts`; mirror the existing mocks in that file)

```ts
it('scopes the door side to the window when windowStart/windowEnd are given', async () => {
  // (Adapt to the file's existing mock setup for getAttendanceForMember + getCheckInAttendance.)
  // getAttendanceForMember → [] ; getCheckInAttendance → two door dates, one outside the window.
  mockGetAttendanceForMember.mockResolvedValue([]);
  mockGetCheckInAttendance.mockResolvedValue([
    { date: '2024-01-01', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // before window
    { date: '2025-11-02', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] }, // in window
  ]);
  const s = await getMemberUnifiedAttendance({
    mid: 'CMT-F-03', legacyFid: '4421', legacySid: 'S9', pid: 'o-bv',
    windowStart: '2025-09-01', windowEnd: '2026-06-30',
  });
  expect(s.marks.map((m) => m.date)).toEqual(['2025-11-02']);
  expect(s.total).toBe(1);
});
```
(If the existing test file uses different mock variable names, match them. The intent: a door date outside `[windowStart, windowEnd]` is excluded.)

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/get-member-attendance.test.ts`
Expected: FAIL — window args are ignored today, so the out-of-window date is still counted.

- [ ] **Step 3: Implement window scoping** (edit `get-member-attendance.ts`)

Add the two optional fields to the args interface:
```ts
export interface MemberUnifiedAttendanceArgs {
  mid: string;
  legacyFid: string | null;
  legacySid: string | null;
  /** When set, only portal events for this offering id (oid) are counted. */
  pid?: string | null;
  /** Door-side window (YMD) from the offering; null/omitted = unbounded. */
  windowStart?: string | null;
  windowEnd?: string | null;
}
```
And scope the door records before summarizing:
```ts
export async function getMemberUnifiedAttendance(
  args: MemberUnifiedAttendanceArgs,
): Promise<ResolvedSummary> {
  const [events, doorRecords] = await Promise.all([
    getAttendanceForMember(args.mid),
    getCheckInAttendance(args.legacyFid),
  ]);
  const portalMarks = events
    .filter((e) => (args.pid ? e.pid === args.pid : true))
    .map((e) => ({ date: e.date, status: e.status }));
  const start = args.windowStart ?? '0000-01-01';
  const end = args.windowEnd ?? '9999-12-31';
  const scopedDoor = doorRecords.filter((r) => r.date >= start && r.date <= end);
  const doorMarks = summarizeMemberCheckIns(scopedDoor, args.legacySid).marks;
  return resolveMemberAttendance(portalMarks, doorMarks);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/get-member-attendance.test.ts`
Expected: PASS (the new window test + all pre-existing tests, which pass no window → unbounded → unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/attendance/get-member-attendance.ts apps/portal/src/features/setu/attendance/__tests__/get-member-attendance.test.ts
git commit -m "feat(attendance): window-scope the per-member unified attendance door side (T4)"
```

---

## Task 3: union the child-profile `check-in` branch

**Files:**
- Modify: `apps/portal/src/features/setu/members/get-child-profile.ts`
- Test: `apps/portal/src/features/setu/members/__tests__/get-child-profile.test.ts`

- [ ] **Step 1: Update the test for union behavior** (edit `get-child-profile.test.ts`)

The current `bala-vihar` (`check-in`) assertions expect door-only counts (attended 3, total 4). Add teacher `attendanceEvents` for the BV offering and assert the **union**. In the "composes three active programs" test, change the BV oid to `o-bv` and add a portal mark for `o-bv` that the union must fold in. Specifically, add to the `mockGetAttendanceForMember` array a BV-offering portal mark on a date NOT in the door set, e.g.:
```ts
{ aid: 'b1', mid: MID, fid: FID, levelId: 'l1', pid: 'o-bv', date: '2025-10-05', status: 'present', isGuest: false },
```
Then update the BV expectations: door had present 3 of recorded 4 (`2025-09-07,14,28` present; `21` absent); the union adds `2025-10-05` present → attended 4, total 5:
```ts
const bv = result!.programs.find((p) => p.programKey === 'bala-vihar')!;
expect(bv.attendance.mode).toBe('check-in');
expect(bv.attendance.available).toBe(true);
expect(bv.attendance.attended).toBe(4); // 3 door + 1 teacher (new date)
expect(bv.attendance.total).toBe(5);    // 4 door dates ∪ 1 teacher date
```
Recompute the blended `overallAttendedPct`: tabla (2/3) + bv (4/5) = 6/8 = 75% → update `expect(result!.stats.overallAttendedPct).toBe(75)`.

Add a NEW test proving union + no-legacySid-but-teacher-marks availability:
```ts
it('check-in BV is available from teacher marks even when legacySid is null (union)', async () => {
  mockGetFamilyByFid.mockResolvedValue(makeFamily({ legacySid: null }) as never);
  mockListPrograms.mockResolvedValue([makeProgram('bala-vihar', 'check-in')] as never);
  mockGetEnrollments.mockResolvedValue([
    makeEnrollment({ eid: 'e-bv', oid: 'o-bv', programKey: 'bala-vihar' }),
  ] as never);
  mockGetAttendanceForMember.mockResolvedValue([
    { aid: 'b1', mid: MID, fid: FID, levelId: 'l1', pid: 'o-bv', date: '2025-10-05', status: 'present', isGuest: false },
  ] as never);
  mockGetCheckInAttendance.mockResolvedValue([] as never);

  const result = await getChildProfile(MID);
  const bv = result!.programs[0]!;
  expect(bv.attendance.available).toBe(true);   // teacher mark makes it available despite null sid
  expect(bv.attendance.attended).toBe(1);
  expect(bv.attendance.total).toBe(1);
  expect(bv.attendance.note).toBeNull();
});
```
Keep the existing "unavailable with a note when legacySid is null" test BUT it must now ALSO have no portal marks (it already mocks `getAttendanceForMember → []`), so it still yields unavailable — leave it as-is (it already passes `[]` for member records).

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/members/__tests__/get-child-profile.test.ts`
Expected: FAIL (BV branch still door-only → attended 3/total 4, blended 71).

- [ ] **Step 3: Implement the union** (edit `get-child-profile.ts`)

Add the resolver import:
```ts
import { resolveMemberAttendance } from '@/features/setu/attendance/resolve-attendance';
```
Replace the `if (mode === 'check-in') { ... }` block (lines ~81–96) with:
```ts
if (mode === 'check-in') {
  const off = e.offering;
  const portalMarks = memberRecords
    .filter((r) => r.pid === e.oid)
    .map((r) => ({ date: r.date, status: r.status }));
  const scoped = off
    ? checkIns.filter((r) => {
        const start = isoToTorontoDateInput(off.startDate.toISOString());
        const end = off.endDate ? isoToTorontoDateInput(off.endDate.toISOString()) : '9999-12-31';
        return r.date >= start && r.date <= end;
      })
    : checkIns;
  const doorMarks = summarizeMemberCheckIns(scoped, member!.legacySid).marks;
  const resolved = resolveMemberAttendance(portalMarks, doorMarks);
  // Available if the door link exists OR a teacher has marked this child for the
  // offering — so a child without a legacySid still shows teacher-marked dates.
  if (!member!.legacySid && portalMarks.length === 0) {
    return { mode, available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: "Attendance isn't linked for this member yet." };
  }
  const marks = resolved.marks.map((m) => ({ date: m.date, present: m.status !== 'absent' }));
  return {
    mode,
    available: true,
    attended: resolved.present + resolved.late,
    total: resolved.total,
    attendedPct: resolved.attendedPct,
    marks,
    note: null,
  };
}
```
(`summarizeMemberCheckIns` tolerates a null sid → empty door marks; the union then rests on portal marks.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/members/__tests__/get-child-profile.test.ts`
Expected: PASS (union counts + the new availability test + the unchanged tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/members/get-child-profile.ts apps/portal/src/features/setu/members/__tests__/get-child-profile.test.ts
git commit -m "feat(child-profile): union teacher marks with door check-ins for BV attendance (T4)"
```

---

## Task 4: union the member-detail page

**Files:**
- Modify: `apps/portal/src/app/family/members/[mid]/page.tsx`

- [ ] **Step 1: Swap the read + adapt the block.** Replace the door-only import (line 9) and the `AttendanceSummaryBlock` (lines 21–41) and the fetch/scope block (lines 60–74).

Imports (line 9 area):
```ts
import { getMemberUnifiedAttendance } from '@/features/setu/attendance/get-member-attendance';
import type { ResolvedSummary } from '@/features/setu/attendance/resolve-attendance';
```
(Remove the now-unused `getCheckInAttendance, summarizeMemberCheckIns, type CheckInSummary` import. Keep `getEnrollments`, `selectBalaViharEnrollment`, `isoToTorontoDateInput`.)

Replace `AttendanceSummaryBlock`:
```tsx
function AttendanceSummaryBlock({ summary, hasSid }: { summary: ResolvedSummary; hasSid: boolean }) {
  const attended = summary.present + summary.late;
  const lastDate = summary.marks.length > 0 ? summary.marks[summary.marks.length - 1]!.date : null;
  return (
    <>
      <SectionLabel>Bala Vihar attendance</SectionLabel>
      {summary.total === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
          {hasSid
            ? 'No attendance recorded yet — it appears once Sunday classes begin.'
            : "Per-child attendance isn't linked for this member yet."}
        </div>
      ) : (
        <DetailGroup rows={[
          ['Attended', `${attended} of ${summary.total} Sundays`],
          ['Last class', lastDate ?? '—'],
        ]}/>
      )}
    </>
  );
}
```
(When there are teacher marks but no sid, `summary.total > 0` so it renders the rows — the union surfaces even without a door link.)

Replace the fetch/scope block (lines 60–74) with:
```ts
    const [enrollments] = await Promise.all([getEnrollments(data.family.fid)]);
    const bv = selectBalaViharEnrollment(enrollments);
    const off = bv?.offering ?? null;
    const attendanceSummary = await getMemberUnifiedAttendance({
      mid,
      legacyFid: data.family.legacyFid,
      legacySid: member.legacySid,
      pid: bv?.oid ?? null,
      windowStart: off ? isoToTorontoDateInput(off.startDate.toISOString()) : null,
      windowEnd: off?.endDate ? isoToTorontoDateInput(off.endDate.toISOString()) : null,
    });
```
Both `<AttendanceSummaryBlock summary={attendanceSummary} hasSid={Boolean(member.legacySid)}/>` call sites (mobile line ~128 + desktop line ~187) stay unchanged (the prop name `summary` is the same; its type is now `ResolvedSummary`).

> N=2 lint: this file is covered by the tripwire. We never write `e.status === 'active'` inline — `selectBalaViharEnrollment` is the sanctioned helper. Good.

- [ ] **Step 2: Typecheck + lint the page**

Run: `pnpm --filter @cmt/portal exec tsc --noEmit && pnpm --filter @cmt/portal lint`
Expected: clean (no unused `CheckInSummary`/`getCheckInAttendance`; no inline status compare).

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/src/app/family/members/[mid]/page.tsx"
git commit -m "feat(member-detail): union teacher marks with door check-ins for BV attendance (T4)"
```

---

## Task 5: union the family dashboard

**Files:**
- Modify: `apps/portal/src/app/family/_helpers/dashboard-model.ts`
- Modify: `apps/portal/src/app/family/page.tsx`
- Test: `apps/portal/src/app/family/__tests__/dashboard-model.test.ts`

- [ ] **Step 1: Update the model test for the new input** (edit `dashboard-model.test.ts`)

Replace the `CheckInRecord` import + `checkIn`/`CHECK_INS` fixtures with a `ResolvedSummary` import + a `bvAttendance` fixture builder. Change the `input()` default from `rawCheckIns: CHECK_INS` to `bvAttendance: <2 present marks>`:
```ts
import type { ResolvedSummary } from '@/features/setu/attendance/resolve-attendance';

function resolved(marks: { date: string; status: 'present' | 'late' | 'absent'; source?: 'portal' | 'door' }[]): ResolvedSummary {
  const sorted = [...marks].sort((a, b) => a.date.localeCompare(b.date)).map((m) => ({ ...m, source: m.source ?? 'door' }));
  const present = sorted.filter((m) => m.status === 'present').length;
  const late = sorted.filter((m) => m.status === 'late').length;
  const absent = sorted.filter((m) => m.status === 'absent').length;
  const total = sorted.length;
  return { present, late, absent, total, attendedPct: total ? Math.round(((present + late) / total) * 100) : 0, marks: sorted };
}
const BV_ATTENDANCE = resolved([{ date: '2025-10-05', status: 'present' }, { date: '2026-01-11', status: 'present' }]);
```
`input()` default becomes:
```ts
return {
  enrollments: [TABLA_ENROLLMENT, BV_ENROLLMENT],
  donations: [],
  programsById: PROGRAMS,
  bvAttendance: BV_ATTENDANCE,
  classSundaysHeld: 30,
  legacyPaymentStatus: null,
  ...overrides,
};
```
Update the assertions:
- The "REGRESSION: attendance is scoped to the BV window" test → rename to "formats the passed BV attendance union": keep `expect(m.attendance.hasAttendance).toBe(true); expect(m.attendance.summary.attended).toBe(2); expect(m.attendance.total).toBe(30);` (window-scoping now lives in the reader's test, Task 1).
- The "no BV enrollment" test asserted `m.attendance.summary.attended).toBe(2)` with rawCheckIns unscoped — keep `bvAttendance: BV_ATTENDANCE` and the same `attended).toBe(2)` (the model just formats it; whether a non-BV family even computes a union is the page's job, but the model formats whatever it's given).
- The "empty family" test: change `rawCheckIns: []` → `bvAttendance: resolved([])` and keep `expect(m.attendance.hasAttendance).toBe(false)`.

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/dashboard-model.test.ts`
Expected: FAIL (the model still expects `rawCheckIns`).

- [ ] **Step 3: Edit `dashboard-model.ts`** — swap the input + format the resolved summary.

Imports: remove `summarizeFamilyCheckIns, type CheckInRecord, type CheckInSummary`; add:
```ts
import type { ResolvedSummary } from '@/features/setu/attendance/resolve-attendance';
```
`DashboardModelInput`: replace the `rawCheckIns` field with:
```ts
  /** Family-level BV attendance union (teacher marks ∪ door check-ins), already
   *  window-scoped to the BV offering by the caller. */
  bvAttendance: ResolvedSummary;
```
`FamilyDashboardModel.attendance` type → make the summary a minimal shape the page already consumes (`attended` + `marks`):
```ts
  attendance: {
    summary: { attended: number; marks: { date: string; present: boolean }[] };
    hasAttendance: boolean;
    total: number;
    pct: number;
  };
```
In `buildFamilyDashboardModel`: destructure `bvAttendance` instead of `rawCheckIns`; delete the `offering`-based `scoped`/`summarizeFamilyCheckIns` block (lines ~106, 120–133) and replace with:
```ts
  const attended = bvAttendance.present + bvAttendance.late;
  const hasAttendance = bvAttendance.total > 0;
  const attendanceTotal = classSundaysHeld > 0 ? classSundaysHeld : bvAttendance.total;
  const attendancePct = attendanceTotal > 0 ? Math.round((attended / attendanceTotal) * 100) : 0;
  const attendanceMarks = bvAttendance.marks.map((m) => ({ date: m.date, present: m.status !== 'absent' }));
```
(Remove the now-unused `const offering = bv?.offering ?? null;` line.) Update the return's `attendance`:
```ts
    attendance: {
      summary: { attended, marks: attendanceMarks },
      hasAttendance,
      total: attendanceTotal,
      pct: attendancePct,
    },
```
(`isLegacyBvPeriod` + `torontoYmd` stay exported and unchanged. `selectBalaViharEnrollment` still used for `bv`.)

- [ ] **Step 4: Edit `app/family/page.tsx`** — compute the union, pass it in.

Add imports:
```ts
import { selectBalaViharEnrollment } from './_helpers/select-bv-enrollment';
import { getFamilyBalaViharAttendance } from '@/features/setu/attendance/get-family-attendance';
import { EMPTY_RESOLVED_SUMMARY } from '@/features/setu/attendance/resolve-attendance';
import { torontoYmd } from './_helpers/dashboard-model';
```
(Remove the `getCheckInAttendance` import if it's now otherwise unused on the page.)

In the data-fetch block, replace `getCheckInAttendance(data.family.legacyFid)` in the `Promise.all` (line ~118) — drop `rawCheckIns` from that array — and after the array, compute the union:
```ts
      const [{ upcoming }, classSundays] = await Promise.all([
        getUpcoming(data.family.location, 'bala-vihar', undefined, 3),
        getClassDatesHeld(data.family.location, 'bala-vihar'),
      ]);
      upcomingEntries = upcoming;

      const bvEnrollment = selectBalaViharEnrollment(enrollments);
      let bvAttendance = EMPTY_RESOLVED_SUMMARY;
      if (bvEnrollment) {
        const off = bvEnrollment.offering;
        const children = bvEnrollment.enrolledMids
          .map((cmid) => data.members.find((mm) => mm.mid === cmid))
          .filter((mm): mm is NonNullable<typeof mm> => Boolean(mm))
          .map((mm) => ({ mid: mm.mid, legacySid: mm.legacySid }));
        bvAttendance = await getFamilyBalaViharAttendance({
          fid: data.family.fid,
          legacyFid: data.family.legacyFid,
          oid: bvEnrollment.oid,
          windowStart: off ? torontoYmd(off.startDate) : null,
          windowEnd: off?.endDate ? torontoYmd(off.endDate) : null,
          children,
        });
      }

      model = buildFamilyDashboardModel({
        enrollments,
        donations,
        programsById,
        bvAttendance,
        classSundaysHeld: classSundays.length,
        legacyPaymentStatus,
      });
```
The destructure `const { summary: ci, hasAttendance, total: attendanceTotal, pct: attendancePct } = model.attendance;` (line 148) and the heatmap `ci.marks.map((m) => ... m.present ...)` (lines ~403–414) + `ci.attended` (mobile line 213/217, desktop) all stay unchanged — `summary` still exposes `{ attended, marks: {date, present}[] }`.

> N=2 lint: `selectBalaViharEnrollment(enrollments)` is the sanctioned helper; no inline `status === 'active'`. The `.filter((mm): mm is …)` is a type guard, not a status compare. Good.

- [ ] **Step 5: Run the model test + typecheck + lint**

Run:
```
pnpm --filter @cmt/portal exec vitest run src/app/family/__tests__/dashboard-model.test.ts
pnpm --filter @cmt/portal exec tsc --noEmit
pnpm --filter @cmt/portal lint
```
Expected: model test PASS; tsc clean; lint clean (no unused `getCheckInAttendance`/`summarizeFamilyCheckIns`/`CheckInRecord`; no N=2 tripwire).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/family/_helpers/dashboard-model.ts apps/portal/src/app/family/page.tsx apps/portal/src/app/family/__tests__/dashboard-model.test.ts
git commit -m "feat(dashboard): union teacher marks with door check-ins for the BV card (T4)"
```

---

## Task 6: full gate + final review

- [ ] **Step 1: Full pre-push gate**

Run:
```
pnpm --filter @cmt/portal exec tsc --noEmit
pnpm --filter @cmt/portal lint
pnpm --filter @cmt/portal test
```
Expected: all green. Fix any unused-import / strict-optional issues (do NOT skip the full lint).

- [ ] **Step 2: Final cross-slice code review** — dispatch `oh-my-claudecode:code-reviewer` (opus) over the T4 diff. Confirm: read-only (no writes/index), per-child-resolve-then-fold correctness (the N=2 fixture), window-scoping preserved on all three surfaces, `selectBalaViharEnrollment`/programKey pinning intact, no N=2 lint regressions, `available` semantics for teacher-only-marks, marks `{date,present}` mapping (late→present) consistent, no dead `rawCheckIns`/door-only imports left. Address HIGH/MEDIUM, then re-run the gate.

- [ ] **Step 3: Controller pushes** the T4 commits at the checkpoint (`git push` runs the full pre-push hook).

---

## Self-review (controller, before dispatch)

**Spec coverage** (design §"Family-facing reconciliation (v1)" + slice T4):
- Child profile per-program BV attendance = union → Task 3. ✓
- Dashboard BV card = union → Tasks 1 + 5. ✓
- Member-detail page = union → Tasks 2 + 4. ✓
- Portal wins per date; door present→present → resolver (reused). ✓
- N≥2 / programKey safety: `selectBalaViharEnrollment` kept on dashboard + member page; per-child-resolve-then-fold in the family reader (2-child fixture) → Tasks 1, 4, 5. ✓
- Unified reader consumed (was dead) → all tasks. ✓

**Placeholder scan:** full code in every code step; the only "adapt to existing mocks" notes are for appending to pre-existing test files (Task 2/3/5) where the file's mock setup is already established. ✓

**Type consistency:** `ResolvedSummary`/`ResolvedMark` (resolve-attendance) flow into `getFamilyBalaViharAttendance` (Task 1) → dashboard model input (Task 5) and `getMemberUnifiedAttendance` (Task 2) → member page block (Task 4). Model `attendance.summary` = `{attended, marks:{date,present}[]}` matches page's `ci.attended`/`ci.marks`. Child-profile `ChildProgramAttendance.marks` = `{date,present}[]` unchanged. `STATUS_RANK`/`summarizeResolvedMarks`/`EMPTY_RESOLVED_SUMMARY` exported in Task 1, consumed in Tasks 1/5. ✓

**Decision logged:** BV stays `attendanceMode: 'check-in'` (NOT flipped to `'teacher'`) — a flip would route the child-profile `teacher` branch which reads `attendanceEvents` only, dropping door check-ins. The union keeps both sources. Family-level uses OR-across-children (best status per date) via per-child resolution — never a single merged bucket (which would let a teacher-absent erase a sibling's door-present).

## Known follow-ups (not this slice)
- Surface `late` distinctly (and a door/teacher source dot) on family heatmaps — today late folds to "present" in the `{date,present}` mapping. Cosmetic; data already carries it.
- T5 — rollout (flag flip `NEXT_PUBLIC_FEATURE_SETU_TEACHER=true`, teacher-assignment validation, UAT walkthrough, infra check). Separate plan.
- Manual UAT walkthrough (agent can't OTP): a family with a teacher-marked-but-not-door-checked-in Sunday sees it counted on the dashboard + child profile + member page; a 2-child family where one was teacher-absent and the other door-present shows the Sunday attended.

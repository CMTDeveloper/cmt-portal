# Teacher Attendance — T1 (door-data bridge + unified resolver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the portal read the door app's live check-in data (`family-check-ins` in prod `715b8`) **read-only**, and provide a pure resolver that merges those door check-ins with the portal's own `attendanceEvents` into one unified per-member attendance view (portal marks win). Foundational data layer — **no UI** (that's T2–T4).

**Architecture:** Add a read-only `masterFirestore()` to `@cmt/firebase-shared` (mirrors the existing `masterRtdb()`). A portal-side **seam** `checkInSourceFirestore()` returns the master app's Firestore today (portal on UAT, door data on `715b8`) and **auto-collapses** to the portal's own Firestore once the portal itself runs on `715b8` (detected by `PORTAL_FIREBASE_PROJECT_ID === MASTER_FIREBASE_PROJECT_ID`) — no manual flip, no new env var. `getCheckInAttendance` is re-pointed through the seam. A pure `resolveMemberAttendance(portalMarks, doorMarks)` merges the two stores (portal status wins per date; door check-in → present; door recorded-but-not-checked-in → absent), and `getMemberUnifiedAttendance(...)` composes the source readers + resolver for a single member (consumed by T4).

**Tech Stack:** Next.js 16, Firebase Admin (firebase-admin/firestore), Vitest, TypeScript `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. Spec: `docs/superpowers/specs/2026-06-06-teacher-attendance-redesign-design.md`.

## Cross-cutting (hard rules — do not skip)
- **Read-only door access.** The portal NEVER writes `family-check-ins` / `guest-families` (the door app owns them in `715b8`). `masterFirestore()` is "read-only by convention" exactly like `masterRtdb()` — only read those collections. We write only our own `attendanceEvents` (not in this slice).
- **Never deploy indexes to `715b8`.** No new query in this slice needs a `715b8` composite index (`getCheckInAttendance` reads a single family's `checkIns` subcollection with no `where`/`orderBy` that needs one — it sorts in memory). Do not add any `715b8` index.
- **The seam is the only place that decides which project holds door data.** All door reads go through `checkInSourceFirestore()`. Do not call `masterFirestore()`/`portalFirestore()` directly from door readers.
- **`exactOptionalPropertyTypes`** — never assign `undefined` to an optional; use conditional spread or `?? null`.
- T2–T4 (UI slices) carry the user's hard UX bar (best-in-class mobile + desktop, designer pass). T1 has no UI.

## Key facts (verified — build on these)
- `packages/firebase-shared/src/admin/apps.ts`: `getPortalApp()` (portal project, UAT now) + `getMasterApp()` (master project = prod `715b8`, has `databaseURL`). `_resetAppsForTesting()`.
- `packages/firebase-shared/src/admin/firestore.ts`: currently exports `portalFirestore()` = `getFirestore(getPortalApp())`, plus `FieldValue`, `Timestamp`.
- `packages/firebase-shared/src/admin/rtdb.ts`: `masterRtdb()` = `getDatabase(getMasterApp())`, with a comment block declaring RTDB read-only by convention. Mirror this style.
- `apps/portal/src/features/setu/attendance/check-in-attendance.ts`: `getCheckInAttendance(legacyFid)` reads `family-check-ins/{legacyFid}/checkIns/*` via `portalFirestore()` → `CheckInRecord[]` (`{ date, checkedInBy, students:[{sid,isCheckedIn}] }`, newest first). Also `summarizeMemberCheckIns(records, legacySid)` → `CheckInSummary` whose `.marks` is `{ date, present }[]` ascending. **This is the file to re-point onto the seam.**
- `apps/portal/src/features/setu/teacher/get-attendance.ts`: `getAttendanceForMember(mid)` → `AttendanceRecord[]` (`{ aid, mid, fid, levelId, pid, date, status: 'present'|'late'|'absent', isGuest }`, newest first).
- `@cmt/shared-domain` exports the attendance status union as **`SetuAttendanceStatus`** (`'present'|'late'|'absent'`) — used by `attendance-marker.tsx`. Import it; don't redefine.
- Env: both `PORTAL_FIREBASE_PROJECT_ID` and `MASTER_FIREBASE_PROJECT_ID` are always present in `process.env` (admin creds). Today they differ (UAT vs `715b8`); after the portal moves to prod they'll be equal.
- Tests: `pnpm --filter @cmt/firebase-shared exec vitest run <path>` and `pnpm --filter @cmt/portal exec vitest run <path>`. Typecheck per package with its own `tsc --noEmit`.

## File structure
**Create:**
- `apps/portal/src/features/setu/attendance/check-in-source.ts` (+ `__tests__/check-in-source.test.ts`) — the seam.
- `apps/portal/src/features/setu/attendance/resolve-attendance.ts` (+ `__tests__/resolve-attendance.test.ts`) — pure resolver + types.
- `apps/portal/src/features/setu/attendance/get-member-attendance.ts` (+ `__tests__/get-member-attendance.test.ts`) — composing per-member reader.

**Modify:**
- `packages/firebase-shared/src/admin/firestore.ts` — add `masterFirestore()`.
- `apps/portal/src/features/setu/attendance/check-in-attendance.ts` — read via `checkInSourceFirestore()` instead of `portalFirestore()`.
- `apps/portal/src/features/setu/attendance/__tests__/check-in-attendance.test.ts` (if it exists) — mock the seam instead of `portalFirestore`.

> **Slice-boundary note:** the spec's T1 also listed a door **guest** reader (`readDoorGuestCheckIns`). It's deferred to **T3**, where it ships with the grade→level matching that consumes it (cleaner, tested together). T1 delivers the family-check-in read path + the resolver.

---

## Task 1: `masterFirestore()` (read-only Firestore on the master app / `715b8`)

**Files:** modify `packages/firebase-shared/src/admin/firestore.ts`.

- [ ] **Step 1 — implement.** Replace the file contents with:
```ts
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp, getMasterApp } from './apps';

export { FieldValue, Timestamp };

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}

/**
 * READ-ONLY Firestore on the master app (prod `chinmaya-setu-715b8`) — the home
 * of the standalone check-in app's `family-check-ins` / `guest-families`.
 * Read-only by convention, exactly like `masterRtdb()`: the portal never writes
 * the door app's collections. Used only via the `checkInSourceFirestore()` seam.
 */
export function masterFirestore(): Firestore {
  return getFirestore(getMasterApp());
}
```

- [ ] **Step 2 — typecheck.** Run: `pnpm --filter @cmt/firebase-shared exec tsc --noEmit` → 0 errors.
  (No standalone unit test: this is a one-line wrapper mirroring the untested `portalFirestore()`; the seam test in Task 2 exercises it via mocking. Typecheck is the gate.)

- [ ] **Step 3 — commit:**
```bash
git add packages/firebase-shared/src/admin/firestore.ts
git commit -m "feat(firebase-shared): masterFirestore() read-only handle to 715b8

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `checkInSourceFirestore()` seam + re-point `getCheckInAttendance`

**Files:** create `apps/portal/src/features/setu/attendance/check-in-source.ts` + `__tests__/check-in-source.test.ts`; modify `apps/portal/src/features/setu/attendance/check-in-attendance.ts` (+ its test if present).

- [ ] **Step 1 — failing seam test** `apps/portal/src/features/setu/attendance/__tests__/check-in-source.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPortal, mockMaster } = vi.hoisted(() => ({
  mockPortal: vi.fn(() => 'PORTAL_FS'),
  mockMaster: vi.fn(() => 'MASTER_FS'),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: mockPortal,
  masterFirestore: mockMaster,
}));

import { checkInSourceFirestore } from '../check-in-source';

const origPortal = process.env.PORTAL_FIREBASE_PROJECT_ID;
const origMaster = process.env.MASTER_FIREBASE_PROJECT_ID;

beforeEach(() => { mockPortal.mockClear(); mockMaster.mockClear(); });
afterEach(() => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = origPortal;
  process.env.MASTER_FIREBASE_PROJECT_ID = origMaster;
});

it('reads from the MASTER app when portal and master are different projects (portal on UAT)', () => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'chinmaya-setu-uat';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  expect(checkInSourceFirestore()).toBe('MASTER_FS');
  expect(mockMaster).toHaveBeenCalledTimes(1);
  expect(mockPortal).not.toHaveBeenCalled();
});

it('reads from the PORTAL app once the portal runs on the same project as the door data', () => {
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'chinmaya-setu-715b8';
  expect(checkInSourceFirestore()).toBe('PORTAL_FS');
  expect(mockPortal).toHaveBeenCalledTimes(1);
  expect(mockMaster).not.toHaveBeenCalled();
});
```
Confirm RED: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/check-in-source.test.ts`.

- [ ] **Step 2 — implement** `apps/portal/src/features/setu/attendance/check-in-source.ts`:
```ts
import { masterFirestore, portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * READ-ONLY Firestore handle to the standalone check-in app's data
 * (`family-check-ins` / `guest-families`). The door app writes these in prod
 * `chinmaya-setu-715b8`.
 *
 * - Today the portal runs on UAT, so the door data lives in a *different*
 *   project → read it via the master app (`masterFirestore()`).
 * - Once the portal itself runs on `715b8` (its project id equals the master
 *   project id), read it from the portal app directly so we don't depend on
 *   master creds. This collapse is automatic — no env flip needed.
 *
 * Either way we only READ these collections; we never write them.
 */
export function checkInSourceFirestore(): Firestore {
  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID;
  const masterProject = process.env.MASTER_FIREBASE_PROJECT_ID;
  if (portalProject && masterProject && portalProject === masterProject) {
    return portalFirestore();
  }
  return masterFirestore();
}
```
Confirm GREEN on the seam test.

- [ ] **Step 3 — re-point `getCheckInAttendance`.** In `apps/portal/src/features/setu/attendance/check-in-attendance.ts`:
  - change the import `import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';` → `import { checkInSourceFirestore } from './check-in-source';`
  - change the read call `await portalFirestore()` → `await checkInSourceFirestore()` (only the one call inside `getCheckInAttendance`). Leave everything else (the summarize helpers) unchanged.

- [ ] **Step 4 — update the existing check-in-attendance test (if present).** Check for `apps/portal/src/features/setu/attendance/__tests__/check-in-attendance.test.ts`. If it exists and mocks `@cmt/firebase-shared/admin/firestore`'s `portalFirestore`, switch it to mock `../check-in-source`'s `checkInSourceFirestore` instead (same fake-firestore chain). If no such test exists, skip. Run whatever attendance tests exist + the new seam test:
  `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance` → all green.

- [ ] **Step 5 — typecheck + commit.** `pnpm --filter @cmt/portal exec tsc --noEmit` → 0.
```bash
git add "apps/portal/src/features/setu/attendance/check-in-source.ts" "apps/portal/src/features/setu/attendance/__tests__/check-in-source.test.ts" "apps/portal/src/features/setu/attendance/check-in-attendance.ts"
# also add the check-in-attendance test if you modified it
git commit -m "feat(teacher-attendance): checkInSourceFirestore seam; read door check-ins read-only

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: pure `resolveMemberAttendance` resolver

**Files:** create `apps/portal/src/features/setu/attendance/resolve-attendance.ts` + `__tests__/resolve-attendance.test.ts`.

- [ ] **Step 1 — failing test** `apps/portal/src/features/setu/attendance/__tests__/resolve-attendance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveMemberAttendance } from '../resolve-attendance';

describe('resolveMemberAttendance', () => {
  it('returns an empty summary for no marks', () => {
    expect(resolveMemberAttendance([], [])).toEqual({
      present: 0, late: 0, absent: 0, total: 0, attendedPct: 0, marks: [],
    });
  });

  it('maps a door check-in to present and a door no-show to absent', () => {
    const out = resolveMemberAttendance([], [
      { date: '2026-01-04', present: true },
      { date: '2026-01-11', present: false },
    ]);
    expect(out.marks).toEqual([
      { date: '2026-01-04', status: 'present', source: 'door' },
      { date: '2026-01-11', status: 'absent', source: 'door' },
    ]);
    expect(out).toMatchObject({ present: 1, absent: 1, total: 2, attendedPct: 50 });
  });

  it('lets a portal mark WIN over a door check-in on the same date', () => {
    const out = resolveMemberAttendance(
      [{ date: '2026-01-04', status: 'late' }],
      [{ date: '2026-01-04', present: true }],
    );
    expect(out.marks).toEqual([{ date: '2026-01-04', status: 'late', source: 'portal' }]);
    expect(out).toMatchObject({ present: 0, late: 1, absent: 0, total: 1, attendedPct: 100 });
  });

  it('unions dates from both sources and sorts ascending; late+present both count as attended (N=2)', () => {
    const out = resolveMemberAttendance(
      [{ date: '2026-01-18', status: 'absent' }, { date: '2026-01-04', status: 'late' }],
      [{ date: '2026-01-11', present: true }],
    );
    expect(out.marks.map((m) => m.date)).toEqual(['2026-01-04', '2026-01-11', '2026-01-18']);
    expect(out.marks.map((m) => m.source)).toEqual(['portal', 'door', 'portal']);
    // attended = present(1, the door one) + late(1) = 2 of 3 → 67%
    expect(out).toMatchObject({ present: 1, late: 1, absent: 1, total: 3, attendedPct: 67 });
  });
});
```
Confirm RED.

- [ ] **Step 2 — implement** `apps/portal/src/features/setu/attendance/resolve-attendance.ts`:
```ts
import type { SetuAttendanceStatus } from '@cmt/shared-domain';

export type ResolvedSource = 'portal' | 'door';

export interface ResolvedMark {
  date: string; // YYYY-MM-DD
  status: SetuAttendanceStatus; // present | late | absent
  source: ResolvedSource;
}

export interface ResolvedSummary {
  present: number;
  late: number;
  absent: number;
  total: number;
  attendedPct: number; // (present + late) / total, rounded
  marks: ResolvedMark[]; // ascending by date
}

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
  // Portal overrides.
  for (const p of portalMarks) {
    byDate.set(p.date, { date: p.date, status: p.status, source: 'portal' });
  }

  const marks = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const present = marks.filter((m) => m.status === 'present').length;
  const late = marks.filter((m) => m.status === 'late').length;
  const absent = marks.filter((m) => m.status === 'absent').length;
  const total = marks.length;
  const attendedPct = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return { present, late, absent, total, attendedPct, marks };
}
```
Confirm GREEN: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/resolve-attendance.test.ts`.

- [ ] **Step 3 — typecheck + commit.** `pnpm --filter @cmt/portal exec tsc --noEmit` → 0.
```bash
git add "apps/portal/src/features/setu/attendance/resolve-attendance.ts" "apps/portal/src/features/setu/attendance/__tests__/resolve-attendance.test.ts"
git commit -m "feat(teacher-attendance): resolveMemberAttendance — merge portal marks + door check-ins

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `getMemberUnifiedAttendance` composing reader

**Files:** create `apps/portal/src/features/setu/attendance/get-member-attendance.ts` + `__tests__/get-member-attendance.test.ts`.

- [ ] **Step 1 — failing test** `apps/portal/src/features/setu/attendance/__tests__/get-member-attendance.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetEvents, mockGetCheckIns } = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockGetCheckIns: vi.fn(),
}));
vi.mock('@/features/setu/teacher/get-attendance', () => ({ getAttendanceForMember: mockGetEvents }));
vi.mock('../check-in-attendance', async (importOriginal) => {
  // keep the REAL summarizeMemberCheckIns; only stub the Firestore read.
  const actual = await importOriginal<typeof import('../check-in-attendance')>();
  return { ...actual, getCheckInAttendance: mockGetCheckIns };
});

import { getMemberUnifiedAttendance } from '../get-member-attendance';

beforeEach(() => { mockGetEvents.mockReset(); mockGetCheckIns.mockReset(); });

it('merges portal events (filtered by pid) with door check-ins for the member', async () => {
  // portal: two events, one for a different offering that must be filtered out
  mockGetEvents.mockResolvedValue([
    { aid: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', levelId: 'L', pid: 'o-bv', date: '2026-01-04', status: 'late', isGuest: false },
    { aid: 'a2', mid: 'CMT-F1-02', fid: 'CMT-F1', levelId: 'L', pid: 'o-other', date: '2026-01-11', status: 'present', isGuest: false },
  ]);
  // door: family check-in records (newest-first shape from getCheckInAttendance)
  mockGetCheckIns.mockResolvedValue([
    { date: '2026-01-11', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
    { date: '2026-01-04', checkedInBy: null, students: [{ sid: 'S9', isCheckedIn: true }] },
  ]);

  const out = await getMemberUnifiedAttendance({ mid: 'CMT-F1-02', legacyFid: '4421', legacySid: 'S9', pid: 'o-bv' });

  // 2026-01-04: portal 'late' wins over door present. 2026-01-11: portal event was o-other (filtered) → door present.
  expect(out.marks).toEqual([
    { date: '2026-01-04', status: 'late', source: 'portal' },
    { date: '2026-01-11', status: 'present', source: 'door' },
  ]);
  expect(out).toMatchObject({ present: 1, late: 1, total: 2, attendedPct: 100 });
  expect(mockGetEvents).toHaveBeenCalledWith('CMT-F1-02');
  expect(mockGetCheckIns).toHaveBeenCalledWith('4421');
});

it('returns an empty summary when there is no legacySid and no portal events', async () => {
  mockGetEvents.mockResolvedValue([]);
  mockGetCheckIns.mockResolvedValue([]);
  const out = await getMemberUnifiedAttendance({ mid: 'CMT-F1-02', legacyFid: null, legacySid: null });
  expect(out).toMatchObject({ total: 0, marks: [] });
});
```
Confirm RED.

- [ ] **Step 2 — implement** `apps/portal/src/features/setu/attendance/get-member-attendance.ts`:
```ts
import { getAttendanceForMember } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from './check-in-attendance';
import { resolveMemberAttendance, type ResolvedSummary } from './resolve-attendance';

export interface MemberUnifiedAttendanceArgs {
  mid: string;
  legacyFid: string | null;
  legacySid: string | null;
  /** When set, only portal events for this offering id (oid) are counted. */
  pid?: string | null;
}

/**
 * One member's unified attendance = portal `attendanceEvents` (authoritative)
 * merged with the door app's `family-check-ins`. The composing reader the family
 * surfaces (child profile, dashboard) and teacher student view consume.
 */
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
  const doorMarks = summarizeMemberCheckIns(doorRecords, args.legacySid).marks; // {date, present}[]
  return resolveMemberAttendance(portalMarks, doorMarks);
}
```
Confirm GREEN: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/get-member-attendance.test.ts`.

- [ ] **Step 3 — typecheck + commit.** `pnpm --filter @cmt/portal exec tsc --noEmit` → 0.
```bash
git add "apps/portal/src/features/setu/attendance/get-member-attendance.ts" "apps/portal/src/features/setu/attendance/__tests__/get-member-attendance.test.ts"
git commit -m "feat(teacher-attendance): getMemberUnifiedAttendance composing reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## T1 verification (before done)
- [ ] `pnpm --filter @cmt/firebase-shared exec tsc --noEmit` + `pnpm --filter @cmt/portal exec tsc --noEmit` → 0.
- [ ] `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance` → all green (seam, resolver, composing reader, existing check-in-attendance).
- [ ] `pnpm lint` clean on touched files.
- [ ] Grep check: door readers reach Firestore ONLY through `checkInSourceFirestore()` (no direct `portalFirestore()`/`masterFirestore()` in `check-in-attendance.ts`); nothing writes `family-check-ins`/`guest-families`.
- [ ] Final review pass (spec-compliance + code-quality, Opus) over the slice.
- [ ] Push (full pre-push gate: typecheck + lint + test + build).
- [ ] Update resume-note memory: T1 shipped; the seam auto-collapses when the portal moves to `715b8`; T2 (teacher screen) next.

## Not in T1 (later slices)
- T2: redesigned teacher level-attendance screen (mobile-first, present/late/absent, door overlay pre-fill).
- T3: door **guest** reader + grade→level matching + in-class quick-add (visitors).
- T4: family-facing union (child profile + dashboard BV attendance use `getMemberUnifiedAttendance`).
- T5: rollout (flag, teacher-assignment validation, infra confirm, UAT walkthrough).
- Later phase: history backfill/sync `715b8` → portal `attendanceEvents`.

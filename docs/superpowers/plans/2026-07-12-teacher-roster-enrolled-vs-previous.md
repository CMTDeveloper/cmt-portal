# Teacher roster: Enrolled vs Previous students — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the teacher attendance roster into a main "Enrolled students" list (confirmed enrollments only) and a secondary "Previous students" list (active-but-unconfirmed rollover carry-forwards), where marking a previous student present confirms their existing family enrollment and moves them + siblings into the Enrolled lists.

**Architecture:** Reuse the existing issue #23 `isEnrollmentConfirmed` rule to partition each level's active enrollments. A new per-level bulk helper computes the set of confirmed fids; the pure `buildRoster` uses it to split members into `members` (confirmed) and `previousStudents` (unconfirmed). The attendance stats + absent-sweep stay scoped to `members`, so previous students are never auto-absented. A dedicated route/page lets a teacher mark a previous student present, which writes one `present` attendance event that confirms the already-active enrollment.

**Tech Stack:** Next.js 16 App Router, Firebase Admin Firestore (`chinmaya-setu-uat`), Vitest, Playwright (deployed-UAT E2E), TypeScript (`exactOptionalPropertyTypes` on).

**Spec:** `docs/superpowers/specs/2026-07-12-teacher-roster-enrolled-vs-previous-design.md`

## Global Constraints

- **Never use the em dash character `—`; use a plain hyphen `-`.** (Applies to all code, comments, copy, commit messages.)
- **UAT only.** All DB ops (E2E, index deploys) target `chinmaya-setu-uat`. Never touch prod `chinmaya-setu-715b8`. Never `--force` an index deploy.
- **No schema change, no data migration, no rollover change, no new Firestore index.** This is a read-model + presentation change. The plan still runs the index audit (project rule #8) before ship.
- `exactOptionalPropertyTypes` is enabled - never assign `undefined` to an optional; omit the key or use `null`.
- **Reuse `isEnrollmentConfirmed`** (`apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`) - do NOT re-derive the confirmed rule. Confirmation = family-initiated OR first-attendance enrolledVia, OR attended ≥1 present/late this year, OR a completed donation tied to the enrollment's eid, OR legacy-paid.
- **Bulk reads scoped to one level's pid** - no cross-level fan-out. Per-family reads are acceptable only within the existing per-level loop (one level ≈ ≤130 families), short-circuited so the expensive donation/legacy reads only fire when cheaper signals are inconclusive.
- **`/api/setu/teacher/*` is already teacher-gated** in `can-access-route.ts:67` (`isTeacher`) - new routes under that prefix need NO new `canAccessRoute` rule. Every new route still re-checks `canTeachLevel(session, levelId)`.
- **N≥2 testing (project rule #6):** every read test uses ≥2 confirmed and ≥2 previous students, plus a two-sibling family that confirms together.
- **Every user-facing route gets a deployed-UAT E2E** with a realistic multi-instance ACTIVE fixture (project rule #7).
- **Any `/api/setu/**` shape change** gets a dated, SHA-keyed entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.
- **Commit author** is the repo-local `CMT Developer <developer@chinmayatoronto.org>`. Never add a Co-Authored-By / agent trailer. Commit only; the controller pushes at slice boundaries.
- Run tests with `pnpm --filter @cmt/portal exec vitest run <path>`. Typecheck with `pnpm --filter @cmt/portal typecheck`.

## File Structure

**New:**
- `apps/portal/src/features/setu/teacher/roster-confirmation.ts` - `deriveConfirmedFidsForLevel(...)`, the per-level bulk confirmed-fid set.
- `apps/portal/src/features/setu/teacher/previous-students-view.ts` - `getLevelPreviousStudentsView(...)`, the read model for the Previous students page.
- `apps/portal/src/features/setu/teacher/confirm-previous.ts` - `confirmPreviousStudent(...)`, writes the present mark for one previous student.
- `apps/portal/src/app/api/setu/teacher/attendance/confirm-previous/route.ts` - `POST` handler.
- `apps/portal/src/features/setu/teacher/components/previous-students-panel.tsx` - client list + mark-present.
- `apps/portal/src/app/teacher/levels/[levelId]/previous/page.tsx` - route wrapper (mirrors visitors page).
- Tests colocated in `__tests__/` beside each unit.
- `apps/portal/e2e/setu/teacher/previous-students.spec.ts` - deployed-UAT E2E.

**Modified:**
- `apps/portal/src/features/setu/teacher/roster.ts` - `buildRoster` split + `deriveRoster` gains an opt-in `{ withConfirmation }` option.
- `apps/portal/src/features/setu/teacher/level-attendance-view.ts` - pass `{ withConfirmation: true }`, add `previousCount`.
- `apps/portal/src/features/setu/teacher/save-attendance.ts` - pass `{ withConfirmation: true }` so the main save's roster gate (and thus the absent-sweep) covers ONLY confirmed students.
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` - "Enrolled students (N)" heading + "Previous students (N)" button + `previousCount` prop.
- `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx` - pass `previousCount`.
- `apps/portal/docs/MOBILE_API_CHANGELOG.md`, `docs/runbooks/production-cutover-checklist.md`.

**Deliberately NOT modified (opt-in default preserves them):** `deriveRoster` defaults to
`withConfirmation: false`, which puts every active-enrolled member in `members` and leaves
`previousStudents` empty - exactly today's behavior. So the two other `deriveRoster` consumers
stay unchanged and un-regressed:
- `apps/portal/src/features/setu/teacher/student-detail.ts:49` (`canTeacherSeeStudent`) - a teacher must still be able to open ANY roster student's detail, confirmed or not; default-false keeps all members in the set.
- `apps/portal/src/app/welcome/levels/[levelId]/page.tsx:29` - the welcome-team level roster keeps showing the full enrolled roster.
A test in each task asserts these paths are unaffected.

---

### Task 1: Per-level confirmed-fid helper (`deriveConfirmedFidsForLevel`)

**Files:**
- Create: `apps/portal/src/features/setu/teacher/roster-confirmation.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts`

**Interfaces:**
- Consumes: `isEnrollmentConfirmed` from `@/app/family/_helpers/enrollment-confirmation`; `paymentSourceOf` from `@cmt/shared-domain`; `getLegacyPaymentStatus` from `@/features/setu/donations/legacy-payment`.
- Produces:
  ```ts
  export interface LevelEnrollment {
    fid: string; eid: string; oid: string;
    enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion' | 'kiosk';
    enrolledMids: string[];
    legacyFid: string | null;
  }
  export async function deriveConfirmedFidsForLevel(
    db: FirebaseFirestore.Firestore,
    pid: string,
    enrollments: LevelEnrollment[],
  ): Promise<Set<string>>; // set of confirmed fids
  ```

**Confirmation logic** (reuse `isEnrollmentConfirmed` per enrollment; short-circuit expensive reads):
1. Read all attendance events for the pid once: `db.collection('attendanceEvents').where('pid','==',pid).get()`; build `attendedMids = Set` of `mid` where `status` is `'present'` or `'late'` (top-level collection, single-field `where` is auto-indexed; filter status in memory - do NOT add a status to the query, that would need a composite index).
2. Read the offering once for its payment source: `db.collection('offerings').doc(pid).get()`; `const source = paymentSourceOf(od.paymentSource !== undefined ? { paymentSource: od.paymentSource } : {})`.
3. For each enrollment, in order of increasing cost:
   - If `enrolledVia` is `'family-initiated'` or `'first-attendance'` → confirmed (no reads).
   - Else if any `enrolledMids[i]` is in `attendedMids` → confirmed.
   - Else read that family's completed donations `db.collection('families').doc(fid).collection('donations').where('status','==','completed').get()` and legacy status (only when `source === 'legacy'` and `legacyFid` present, via `getLegacyPaymentStatus(legacyFid)`), then call `isEnrollmentConfirmed({ eid, enrolledVia }, { attendedCount: 0, donations, legacyPaid })`.
   - Collect `fid` into the result set when confirmed.

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/teacher/__tests__/roster-confirmation.test.ts
import { describe, it, expect, vi } from 'vitest';
import { deriveConfirmedFidsForLevel, type LevelEnrollment } from '../roster-confirmation';

vi.mock('@/features/setu/donations/legacy-payment', () => ({
  getLegacyPaymentStatus: vi.fn(async (lf: string) => (lf === 'legacy-PAID' ? 'paid' : 'partial')),
}));

// Minimal fake Firestore covering the 3 read shapes this helper uses.
function fakeDb(opts: {
  attendance: Array<{ mid: string; status: string }>;
  paymentSource?: string;
  donationsByFid?: Record<string, Array<{ status: string; eid: string }>>;
}) {
  return {
    collection(name: string) {
      if (name === 'attendanceEvents') {
        return { where: () => ({ get: async () => ({ docs: opts.attendance.map((d) => ({ data: () => d })) }) }) };
      }
      if (name === 'offerings') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ paymentSource: opts.paymentSource ?? 'portal' }) }) }) };
      }
      if (name === 'families') {
        return {
          doc: (fid: string) => ({
            collection: () => ({
              where: () => ({ get: async () => ({ docs: (opts.donationsByFid?.[fid] ?? []).map((d) => ({ data: () => d })) }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as FirebaseFirestore.Firestore;
}

const base = (o: Partial<LevelEnrollment>): LevelEnrollment => ({
  fid: 'F', eid: 'F-o', oid: 'o', enrolledVia: 'promotion', enrolledMids: ['F-01'], legacyFid: null, ...o,
});

describe('deriveConfirmedFidsForLevel', () => {
  it('confirms family-initiated and first-attendance without any reads', async () => {
    const db = fakeDb({ attendance: [] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'A', eid: 'A-o', enrolledMids: ['A-01'], enrolledVia: 'family-initiated' }),
      base({ fid: 'B', eid: 'B-o', enrolledMids: ['B-01'], enrolledVia: 'first-attendance' }),
    ]);
    expect(set).toEqual(new Set(['A', 'B']));
  });

  it('confirms a promotion enrollment once any enrolled mid has a present/late mark', async () => {
    const db = fakeDb({ attendance: [{ mid: 'C-02', status: 'present' }] });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'C', eid: 'C-o', enrolledMids: ['C-01', 'C-02'] }), // C-02 attended
      base({ fid: 'D', eid: 'D-o', enrolledMids: ['D-01'] }),        // no signal
    ]);
    expect(set).toEqual(new Set(['C']));
  });

  it('confirms via a completed donation tied to the eid, and via legacy-paid', async () => {
    const db = fakeDb({
      attendance: [],
      paymentSource: 'legacy',
      donationsByFid: { E: [{ status: 'completed', eid: 'E-o' }] },
    });
    const set = await deriveConfirmedFidsForLevel(db, 'o', [
      base({ fid: 'E', eid: 'E-o' }),                                   // donation
      base({ fid: 'G', eid: 'G-o', legacyFid: 'legacy-PAID' }),         // legacy-paid
      base({ fid: 'H', eid: 'H-o', legacyFid: 'legacy-partial' }),      // nothing → not confirmed
    ]);
    expect(set).toEqual(new Set(['E', 'G']));
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/roster-confirmation.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `roster-confirmation.ts`**

```ts
import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';

export interface LevelEnrollment {
  fid: string;
  eid: string;
  oid: string;
  enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion' | 'kiosk';
  enrolledMids: string[];
  legacyFid: string | null;
}

/**
 * The set of fids whose active enrollment for THIS level's period is
 * engagement-confirmed (issue #23 `isEnrollmentConfirmed`). Scoped to one pid;
 * reads are short-circuited so the per-family donation / legacy reads only fire
 * when the cheaper enrolledVia + attendance signals are inconclusive. Door
 * self-check-ins are intentionally NOT a confirmation signal here (same tradeoff
 * as the reports helper) - a teacher mark resolves it.
 */
export async function deriveConfirmedFidsForLevel(
  db: FirebaseFirestore.Firestore,
  pid: string,
  enrollments: LevelEnrollment[],
): Promise<Set<string>> {
  const confirmed = new Set<string>();
  if (enrollments.length === 0) return confirmed;

  // 1. Attendance (present/late) for the whole period - single-field, auto-indexed.
  const evSnap = await db.collection('attendanceEvents').where('pid', '==', pid).get();
  const attendedMids = new Set<string>();
  for (const d of evSnap.docs) {
    const e = d.data() as { mid?: unknown; status?: unknown };
    if (e.status === 'present' || e.status === 'late') attendedMids.add(String(e.mid ?? ''));
  }

  // 2. Offering payment source (legacy vs portal) - one doc get.
  const offSnap = await db.collection('offerings').doc(pid).get();
  const od = (offSnap.exists ? offSnap.data() : {}) as { paymentSource?: unknown };
  const source = paymentSourceOf(
    od.paymentSource !== undefined ? { paymentSource: od.paymentSource as never } : {},
  );

  for (const enr of enrollments) {
    // Cheap signals first (no reads).
    if (enr.enrolledVia === 'family-initiated' || enr.enrolledVia === 'first-attendance') {
      confirmed.add(enr.fid);
      continue;
    }
    if (enr.enrolledMids.some((mid) => attendedMids.has(mid))) {
      confirmed.add(enr.fid);
      continue;
    }
    // Expensive signals only when still inconclusive.
    const donSnap = await db
      .collection('families')
      .doc(enr.fid)
      .collection('donations')
      .where('status', '==', 'completed')
      .get();
    const donations = donSnap.docs.map((d) => d.data() as DonationDoc);
    const legacyPaid =
      source === 'legacy' && enr.legacyFid
        ? (await getLegacyPaymentStatus(enr.legacyFid)) === 'paid'
        : false;
    if (isEnrollmentConfirmed({ eid: enr.eid, enrolledVia: enr.enrolledVia }, { attendedCount: 0, donations, legacyPaid })) {
      confirmed.add(enr.fid);
    }
  }
  return confirmed;
}
```

- [ ] **Step 4: Run tests to verify they pass** — same command → PASS (3 tests). Also `pnpm --filter @cmt/portal typecheck`.

- [ ] **Step 5: Commit** — `git add` the two files; `git commit -m "feat(teacher): per-level confirmed-fid helper reusing isEnrollmentConfirmed"`.

---

### Task 2: Split `buildRoster` and wire `deriveRoster`

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/roster.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/roster.test.ts`

**Interfaces:**
- Consumes: `deriveConfirmedFidsForLevel`, `LevelEnrollment` from Task 1.
- Produces:
  - `buildRoster(level, families, events, date, now, confirmedFids: Set<string>)` and `RosterResult` gaining `previousStudents: RosterMember[]` and `previousTotal: number`. `members`/`total`/`markedCount` describe the members bucket only.
  - `deriveRoster(levelId, date, now?, opts?: { withConfirmation?: boolean })`. **Default `withConfirmation` is `false`** - confirmed set = ALL fids, so every enrolled member lands in `members` and `previousStudents` is empty (today's behavior, preserving `student-detail` + welcome consumers). When `true`, the real confirmed set is computed and the roster splits.

**Detail:** In `buildRoster`, after matching a member to the level, route it to `members` if `confirmedFids.has(fam.fid)` else to `previousStudents`. Sort both the same way. `total`/`markedCount` count `members` only. In `deriveRoster`: capture `eid`, `oid`, `enrolledVia`, `enrolledMids` per fid while building `enrolledMidsByFid` (currently only fid/location/enrolledMids are read at `roster.ts:125-131`); after families load (so `legacyFid` is known), compute the confirmed set only when `opts.withConfirmation` is true (else use `new Set(all fids)`), and pass it into `buildRoster`.

- [ ] **Step 1: Write the failing test** (append to `roster.test.ts`)

```ts
describe('buildRoster split: enrolled vs previous', () => {
  const fams: RosterFamily[] = [
    // confirmed families (fids in the set)
    { fid: 'CMT-A', legacyFid: null, enrolledMids: ['CMT-A-02'], members: [child('CMT-A-02', 'Apple', '2')] },
    { fid: 'CMT-B', legacyFid: null, enrolledMids: ['CMT-B-03'], members: [child('CMT-B-03', 'Berry', '3')] },
    // previous families (NOT in the set) - one is a two-sibling family
    { fid: 'CMT-C', legacyFid: null, enrolledMids: ['CMT-C-02', 'CMT-C-03'], members: [child('CMT-C-02', 'Cherry', '2'), child('CMT-C-03', 'Cherry', '3')] },
    { fid: 'CMT-D', legacyFid: null, enrolledMids: ['CMT-D-02'], members: [child('CMT-D-02', 'Date', '2')] },
  ];

  it('routes confirmed families to members and unconfirmed to previousStudents', () => {
    const confirmed = new Set(['CMT-A', 'CMT-B']);
    const r = buildRoster(level2, fams, [], '2026-01-18', NOW, confirmed);
    expect(r.members.map((m) => m.mid).sort()).toEqual(['CMT-A-02', 'CMT-B-03']);
    expect(r.total).toBe(2);
    // both of the two-sibling family's kids land in previous, together
    expect(r.previousStudents.map((m) => m.mid).sort()).toEqual(['CMT-C-02', 'CMT-C-03', 'CMT-D-02']);
    expect(r.previousTotal).toBe(3);
  });

  it('stats (total, markedCount) count only confirmed members', () => {
    const confirmed = new Set(['CMT-A', 'CMT-B']);
    const events: RosterEventInput[] = [{ mid: 'CMT-A-02', status: 'present', isGuest: false }];
    const r = buildRoster(level2, fams, events, '2026-01-18', NOW, confirmed);
    expect(r.markedCount).toBe(1);
    expect(r.total).toBe(2);
  });
});
```

Also update the existing `buildRoster(...)` calls in this file to pass a `confirmedFids` set that confirms every family (e.g. `new Set(families.map((f) => f.fid))`) so the prior assertions (which expect everyone in `members`) still hold.

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/roster.test.ts` → FAIL (`buildRoster` takes 5 args / no `previousStudents`).

- [ ] **Step 3: Implement the split.** Add to `RosterResult`:

```ts
export interface RosterResult {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string;
  pid: string;
  date: string;
  members: RosterMember[];
  previousStudents: RosterMember[];
  markedCount: number;
  total: number;
  previousTotal: number;
}
```

Change `buildRoster` signature + body:

```ts
export function buildRoster(
  level: Pick<LevelDoc, 'levelId' | 'levelName' | 'location' | 'pid' | 'levelKind' | 'gradeBand'>,
  families: RosterFamily[],
  events: RosterEventInput[],
  date: string,
  now: Date,
  confirmedFids: Set<string>,
): RosterResult {
  const statusByMid = new Map<string, SetuAttendanceStatus>();
  for (const e of events) {
    if (!e.isGuest) statusByMid.set(e.mid, e.status);
  }

  const members: RosterMember[] = [];
  const previousStudents: RosterMember[] = [];
  for (const fam of families) {
    const bucket = confirmedFids.has(fam.fid) ? members : previousStudents;
    for (const m of fam.members) {
      if (!fam.enrolledMids.includes(m.mid)) continue;
      if (!memberMatchesLevel(m, level, now)) continue;
      const status: RosterStatus = statusByMid.get(m.mid) ?? 'unaccounted';
      bucket.push({
        mid: m.mid, fid: fam.fid, firstName: m.firstName, lastName: m.lastName,
        type: m.type, schoolGrade: m.schoolGrade,
        hasSafetyInfo: Boolean(m.foodAllergies && m.foodAllergies.trim().length > 0),
        status, legacySid: m.legacySid, legacyFid: fam.legacyFid,
      });
    }
  }

  const byName = (a: RosterMember, b: RosterMember) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  members.sort(byName);
  previousStudents.sort(byName);
  const markedCount = members.filter((m) => m.status !== 'unaccounted').length;

  return {
    levelId: level.levelId, levelName: level.levelName, ageLabel: levelGradeSummary(level),
    location: level.location ?? '', pid: level.pid, date,
    members, previousStudents, markedCount, total: members.length, previousTotal: previousStudents.length,
  };
}
```

In `deriveRoster`, capture enrollment metadata and compute the set. Replace the enrollment-loop block (`roster.ts:124-132`) so it also records `eid/oid/enrolledVia`:

```ts
  const enrolledMidsByFid = new Map<string, string[]>();
  const enrMetaByFid = new Map<string, { eid: string; oid: string; enrolledVia: LevelEnrollment['enrolledVia']; enrolledMids: string[] }>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as { fid?: string; location?: string; enrolledMids?: string[]; eid?: string; oid?: string; enrolledVia?: LevelEnrollment['enrolledVia'] };
    if (e.location !== level.location || typeof e.fid !== 'string') continue;
    const mids = e.enrolledMids ?? [];
    const existing = enrolledMidsByFid.get(e.fid) ?? [];
    enrolledMidsByFid.set(e.fid, [...new Set([...existing, ...mids])]);
    enrMetaByFid.set(e.fid, { eid: e.eid ?? `${e.fid}-${e.oid ?? level.pid}`, oid: e.oid ?? level.pid, enrolledVia: e.enrolledVia ?? 'promotion', enrolledMids: mids });
  }
```

Change the `deriveRoster` signature to accept the opt-in option:

```ts
export async function deriveRoster(
  levelId: string,
  date: string,
  now: Date = new Date(),
  opts: { withConfirmation?: boolean } = {},
): Promise<RosterResult | null> {
```

Then after `families` are loaded (they carry `legacyFid`), compute the confirmed set only when requested, and pass it to `buildRoster`:

```ts
  const fids2 = [...enrMetaByFid.keys()];
  let confirmedFids: Set<string>;
  if (opts.withConfirmation) {
    const legacyFidByFid = new Map(families.map((f) => [f.fid, f.legacyFid]));
    const levelEnrollments = [...enrMetaByFid.entries()].map(([fid, m]) => ({
      fid, eid: m.eid, oid: m.oid, enrolledVia: m.enrolledVia, enrolledMids: m.enrolledMids,
      legacyFid: legacyFidByFid.get(fid) ?? null,
    }));
    confirmedFids = await deriveConfirmedFidsForLevel(db, level.pid, levelEnrollments);
  } else {
    // Default: everyone confirmed → all members, previousStudents empty (unchanged behavior).
    confirmedFids = new Set(fids2);
  }

  return buildRoster(level, families, events, date, now, confirmedFids);
```

Add imports at the top of `roster.ts`: `import { deriveConfirmedFidsForLevel, type LevelEnrollment } from './roster-confirmation';`.

- [ ] **Step 4: Run tests to verify they pass** — the roster test file → PASS. `pnpm --filter @cmt/portal typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(teacher): split roster into confirmed members + previous students"`.

---

### Task 3: Turn confirmation ON for the two teacher-save paths + expose `previousCount`

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/level-attendance-view.ts`
- Modify: `apps/portal/src/features/setu/teacher/save-attendance.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/level-attendance-view.test.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/save-attendance.test.ts`

**Interfaces:** `AttendanceView` gains `previousCount: number`. Both `getLevelAttendanceView` and `saveAttendance` now call `deriveRoster(levelId, date, ..., { withConfirmation: true })`, so `members` is confirmed-only on both paths. (The attendance page passes `previousCount` to the marker in Task 7, together with the marker's new prop, to keep the tree typecheck-clean between tasks.)

- [ ] **Step 1: Write the failing tests**
  - `level-attendance-view.test.ts`: extend the first test's mocked `deriveRoster` return to include `previousStudents: [{ mid: 'P-02', fid: 'P', firstName: 'Prev', lastName: 'One', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null }], previousTotal: 1`, and assert `expect(view!.previousCount).toBe(1);`. Add `previousStudents: [], previousTotal: 0` to the other two mocked returns so they typecheck.
  - `save-attendance.test.ts`: add a test that `saveAttendance` is invoked with `withConfirmation: true` and that a mark for a mid NOT in the (confirmed) `members` is skipped. Extend the existing mocked `deriveRoster` return there to include `previousStudents: [{ mid: 'PREV-02', ... }], previousTotal: 1` and assert that posting `marks: { 'PREV-02': 'present' }` lands `PREV-02` in `result.skipped` (it is not on the confirmed roster). If the existing test already mocks `deriveRoster`, extend its return; otherwise mirror the mock harness in `level-attendance-view.test.ts`.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/level-attendance-view.test.ts src/features/setu/teacher/__tests__/save-attendance.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `level-attendance-view.ts`: change `const roster = await deriveRoster(levelId, date);` to `const roster = await deriveRoster(levelId, date, undefined, { withConfirmation: true });`. Add `previousCount: number;` to the `AttendanceView` interface and `previousCount: roster.previousStudents.length,` to the returned object.
  - `save-attendance.ts`: change `const roster = await deriveRoster(levelId, date, params.now);` to `const roster = await deriveRoster(levelId, date, params.now, { withConfirmation: true });`. No other change - the existing gate (`fidByMid` from `roster.members`, `skipped` for misses) now scopes both the accepted marks AND the absent-sweep to confirmed students.

- [ ] **Step 4: Run tests to verify they pass** — both test files → PASS. `pnpm --filter @cmt/portal typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(teacher): confirmation-scoped roster for attendance view + save"`.

---

### Task 4: Previous-students read model (`getLevelPreviousStudentsView`)

**Files:**
- Create: `apps/portal/src/features/setu/teacher/previous-students-view.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/previous-students-view.test.ts`

**Interfaces:**
```ts
export interface PreviousStudentRow { mid: string; fid: string; firstName: string; lastName: string; schoolGrade: string | null; }
export interface PreviousStudentsView { levelId: string; levelName: string; ageLabel: string; date: string; students: PreviousStudentRow[]; }
export async function getLevelPreviousStudentsView(levelId: string, date: string): Promise<PreviousStudentsView | null>;
```
Reuses `deriveRoster`: returns `null` when the roster is null, else maps `roster.previousStudents` to `PreviousStudentRow`.

- [ ] **Step 1: Write the failing test**

```ts
import { it, expect, vi, beforeEach } from 'vitest';
const { mockDerive } = vi.hoisted(() => ({ mockDerive: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
import { getLevelPreviousStudentsView } from '../previous-students-view';

beforeEach(() => mockDerive.mockReset());

it('maps previousStudents to rows (N=2, includes a two-sibling family)', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 2', ageLabel: 'Gr 2 & 3', location: 'Brampton', pid: 'o', date: '2026-01-18',
    members: [], total: 0, markedCount: 0, previousTotal: 3,
    previousStudents: [
      { mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', type: 'Child', schoolGrade: 'Grade 2', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'C-03', fid: 'C', firstName: 'Cody', lastName: 'Cherry', type: 'Child', schoolGrade: 'Grade 3', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
      { mid: 'D-02', fid: 'D', firstName: 'Dan', lastName: 'Date', type: 'Child', schoolGrade: 'Grade 2', hasSafetyInfo: false, status: 'unaccounted', legacyFid: null, legacySid: null },
    ],
  });
  const view = await getLevelPreviousStudentsView('L', '2026-01-18');
  expect(view!.students.map((s) => s.mid)).toEqual(['C-02', 'C-03', 'D-02']);
  expect(view!.students[0]).toEqual({ mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', schoolGrade: 'Grade 2' });
});

it('returns null when the level is missing', async () => {
  mockDerive.mockResolvedValue(null);
  expect(await getLevelPreviousStudentsView('nope', '2026-01-18')).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { deriveRoster } from './roster';

export interface PreviousStudentRow { mid: string; fid: string; firstName: string; lastName: string; schoolGrade: string | null; }
export interface PreviousStudentsView { levelId: string; levelName: string; ageLabel: string; date: string; students: PreviousStudentRow[]; }

/** Read model for the Previous students page: active-but-unconfirmed carry-forwards for a level. */
export async function getLevelPreviousStudentsView(levelId: string, date: string): Promise<PreviousStudentsView | null> {
  // MUST pass withConfirmation:true, else previousStudents is always empty.
  const roster = await deriveRoster(levelId, date, undefined, { withConfirmation: true });
  if (!roster) return null;
  return {
    levelId: roster.levelId,
    levelName: roster.levelName,
    ageLabel: roster.ageLabel,
    date: roster.date,
    students: roster.previousStudents.map((m) => ({
      mid: m.mid, fid: m.fid, firstName: m.firstName, lastName: m.lastName, schoolGrade: m.schoolGrade,
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(teacher): previous-students read model"`.

---

### Task 5: `confirmPreviousStudent` action

**Files:**
- Create: `apps/portal/src/features/setu/teacher/confirm-previous.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/confirm-previous.test.ts`

**Interfaces:**
```ts
export interface ConfirmPreviousParams { levelId: string; mid: string; date: string; markedByUid: string; markedByMid: string | null; now?: Date; }
export type ConfirmPreviousResult =
  | { ok: true; fid: string }
  | { ok: false; reason: 'level-not-found' | 'not-a-previous-student' };
export async function confirmPreviousStudent(params: ConfirmPreviousParams): Promise<ConfirmPreviousResult>;
```

**Detail:** Call `deriveRoster(levelId, date, now)`; if null → `level-not-found`. Find the `mid` in `roster.previousStudents`; if absent → `not-a-previous-student` (guards against marking a confirmed student or a bogus mid through this path). Write a single `present` attendance event using the same shape as `saveAttendance` (composite `attendanceAid(levelId, mid, date)`, `merge: true`, include `pid: roster.pid`, `fid`, `isGuest: false`, `markedByUid`, `markedByMid`, server timestamps). Return `{ ok: true, fid }`. It writes exactly ONE event and performs NO absent sweep.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDerive } = vi.hoisted(() => ({ mockDerive: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));

const setMock = vi.fn();
const batchMock = { set: setMock, commit: vi.fn(async () => undefined) };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ batch: () => batchMock, collection: () => ({ doc: (id: string) => ({ id }) }) }),
  FieldValue: { serverTimestamp: () => 'ts' },
}));
vi.mock('@cmt/shared-domain', () => ({ attendanceAid: (l: string, m: string, d: string) => `${l}:${m}:${d}` }));

import { confirmPreviousStudent } from '../confirm-previous';

beforeEach(() => { mockDerive.mockReset(); setMock.mockReset(); });

const roster = (prev: Array<{ mid: string; fid: string }>) => ({
  levelId: 'L', pid: 'o', date: '2026-01-18', members: [], previousStudents: prev, total: 0, previousTotal: prev.length, markedCount: 0,
  levelName: 'Level 2', ageLabel: 'Gr 2 & 3', location: 'Brampton',
});

it('writes one present event for a previous student and returns the fid', async () => {
  mockDerive.mockResolvedValue(roster([{ mid: 'C-02', fid: 'C' }, { mid: 'D-02', fid: 'D' }]));
  const res = await confirmPreviousStudent({ levelId: 'L', mid: 'C-02', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: true, fid: 'C' });
  expect(setMock).toHaveBeenCalledTimes(1);
  const written = setMock.mock.calls[0]![1];
  expect(written).toMatchObject({ mid: 'C-02', fid: 'C', pid: 'o', status: 'present', isGuest: false });
});

it('rejects a mid that is not a previous student (no write)', async () => {
  mockDerive.mockResolvedValue(roster([{ mid: 'C-02', fid: 'C' }]));
  const res = await confirmPreviousStudent({ levelId: 'L', mid: 'X-99', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: false, reason: 'not-a-previous-student' });
  expect(setMock).not.toHaveBeenCalled();
});

it('returns level-not-found when the roster is null', async () => {
  mockDerive.mockResolvedValue(null);
  const res = await confirmPreviousStudent({ levelId: 'nope', mid: 'C-02', date: '2026-01-18', markedByUid: 'u', markedByMid: 't' });
  expect(res).toEqual({ ok: false, reason: 'level-not-found' });
});
```

- [ ] **Step 2: Run it to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { attendanceAid } from '@cmt/shared-domain';
import { deriveRoster } from './roster';

export interface ConfirmPreviousParams {
  levelId: string; mid: string; date: string; markedByUid: string; markedByMid: string | null; now?: Date;
}
export type ConfirmPreviousResult =
  | { ok: true; fid: string }
  | { ok: false; reason: 'level-not-found' | 'not-a-previous-student' };

/**
 * Mark ONE previous (unconfirmed carry-forward) student present. Writes a single
 * `present` attendance event - which confirms the family's already-active
 * enrollment via the `attendedCount > 0` rule, so the student + siblings surface
 * in their Enrolled lists on the next load. No enrollment doc is created/mutated,
 * and no absent sweep runs (unlike the main roster save).
 */
export async function confirmPreviousStudent(params: ConfirmPreviousParams): Promise<ConfirmPreviousResult> {
  const { levelId, mid, date, markedByUid, markedByMid } = params;
  // MUST pass withConfirmation:true so previousStudents is populated.
  const roster = await deriveRoster(levelId, date, params.now, { withConfirmation: true });
  if (!roster) return { ok: false, reason: 'level-not-found' };

  const row = roster.previousStudents.find((m) => m.mid === mid);
  if (!row) return { ok: false, reason: 'not-a-previous-student' };

  const db = portalFirestore();
  const now = FieldValue.serverTimestamp();
  const aid = attendanceAid(levelId, mid, date);
  const batch = db.batch();
  batch.set(
    db.collection('attendanceEvents').doc(aid),
    { aid, levelId, mid, fid: row.fid, pid: roster.pid, date, status: 'present', isGuest: false, markedByUid, markedByMid, markedAt: now, updatedAt: now },
    { merge: true },
  );
  await batch.commit();
  return { ok: true, fid: row.fid };
}
```

- [ ] **Step 4: Run tests to verify they pass** — PASS (3 tests). `pnpm --filter @cmt/portal typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(teacher): confirmPreviousStudent writes a single present mark"`.

---

### Task 6: `POST /api/setu/teacher/attendance/confirm-previous`

**Files:**
- Create: `apps/portal/src/app/api/setu/teacher/attendance/confirm-previous/route.ts`
- Test: `apps/portal/src/app/api/setu/teacher/attendance/confirm-previous/__tests__/route.test.ts`

**Interfaces:** Request body `{ levelId: string; mid: string; date: string }`. Auth mirrors the existing attendance route: `readSessionFromHeaders` + `isTeacher` (403 `teacher-required`) + `canTeachLevel` (404 `not-found` / 403 `not-your-class`). Success `{ ok: true, fid }`; `not-a-previous-student` → 400.

- [ ] **Step 1: Write the failing test** — mock `@/lib/auth/headers` (`readSessionFromHeaders`), `@cmt/shared-domain` (`isTeacher`), `@/features/setu/teacher/guard` (`canTeachLevel`), and `@/features/setu/teacher/confirm-previous` (`confirmPreviousStudent`). Assert: non-teacher → 403; `canTeachLevel='forbidden'` → 403 `not-your-class`; happy path returns 200 `{ ok: true, fid: 'C' }`; a bad body (missing `mid`) → 400. Follow the shape of the existing attendance route test if present; otherwise construct `new Request('http://x', { method: 'POST', body: JSON.stringify({...}), headers: { 'Content-Type': 'application/json' } })`.

- [ ] **Step 2: Run it to verify it fails** — FAIL (route module not found).

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { confirmPreviousStudent } from '@/features/setu/teacher/confirm-previous';

const BodySchema = z.object({
  levelId: z.string().min(1),
  mid: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  const { levelId, mid, date } = parsed.data;

  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await confirmPreviousStudent({ levelId, mid, date, markedByUid: session.uid, markedByMid: session.mid });
  if (!result.ok) {
    const status = result.reason === 'level-not-found' ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, fid: result.fid });
}
```

- [ ] **Step 4: Run tests to verify they pass** — PASS. `pnpm --filter @cmt/portal typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat(teacher): POST confirm-previous route (teacher-gated)"`.

---

### Task 7: Attendance marker - "Enrolled students" heading + "Previous students (N)" button

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx`
- Modify: `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx`
- Test: `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx` (create if absent)

**Interfaces:** `AttendanceMarkerProps` gains `previousCount: number` (required). The attendance page passes `previousCount={view.previousCount}` to `<AttendanceMarker>`. Adding the required prop and the page wiring in the SAME task keeps the tree typecheck-clean. Render a "Previous students (N)" `Link` to `/teacher/levels/${levelId}/previous?date=${date}` in the header nav row beside the existing "Visitors →" link (at `attendance-marker.tsx:308-325`), rendered only when `previousCount > 0`. Add an "Enrolled students (N)" heading (`value = total`) directly above the student list (just before the list container that starts after the filter pills, ~line 460+). Use the existing `sectionHeading`-style inline style already used elsewhere (fontSize 12, weight 700, uppercase, `var(--muted)`), value in `var(--ink)`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceMarker } from '../attendance-marker';
import type { AttendanceViewRow } from '@/features/setu/teacher/level-attendance-view';

const rows: AttendanceViewRow[] = [
  { mid: 'A-02', fid: 'A', firstName: 'Ann', lastName: 'Apple', schoolGrade: 'Grade 2', hasSafetyInfo: false, status: null, source: 'default', checkedInAtDoor: false },
  { mid: 'B-03', fid: 'B', firstName: 'Bob', lastName: 'Berry', schoolGrade: 'Grade 3', hasSafetyInfo: false, status: null, source: 'default', checkedInAtDoor: false },
];

describe('AttendanceMarker previous-students entry point', () => {
  it('shows a Previous students button with the count when previousCount > 0', () => {
    render(<AttendanceMarker levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" today="2026-06-30" rows={rows} total={2} previousCount={5} />);
    const link = screen.getByRole('link', { name: /previous students \(5\)/i });
    expect(link.getAttribute('href')).toBe('/teacher/levels/L/previous?date=2026-01-18');
    expect(screen.getByText(/enrolled students \(2\)/i)).toBeTruthy();
  });

  it('hides the Previous students button when previousCount is 0', () => {
    render(<AttendanceMarker levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" today="2026-06-30" rows={rows} total={2} previousCount={0} />);
    expect(screen.queryByRole('link', { name: /previous students/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx` → FAIL (`previousCount` not a prop / button absent).

- [ ] **Step 3: Implement** — add `previousCount` to `AttendanceMarkerProps` and destructure it in the component signature. In the header nav row, wrap the existing "Visitors →" link and a new conditional link in a flex container:

```tsx
<div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
  {previousCount > 0 && (
    <Link
      href={`/teacher/levels/${levelId}/previous?date=${date}`}
      style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)', background: 'var(--accentSoft)', borderRadius: 10, padding: '9px 12px', minHeight: 44, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      Previous students ({previousCount})
    </Link>
  )}
  <Link href={`/teacher/levels/${levelId}/visitors?date=${date}`} style={{ /* existing Visitors styles */ }}>
    Visitors →
  </Link>
</div>
```

Add the "Enrolled students (N)" heading just above the roster list (after the filter-pills row, before the mapped rows):

```tsx
<h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 8px' }}>
  Enrolled students ({total})
</h2>
```

- [ ] **Step 4: Wire the attendance page** — in `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx`, add `previousCount={view.previousCount}` to the `<AttendanceMarker .../>` props (alongside the existing `rows`/`total` props).

- [ ] **Step 5: Run tests + typecheck** — the marker test → PASS; `pnpm --filter @cmt/portal typecheck` → clean (the required prop is now supplied by the only caller).

- [ ] **Step 6: Commit** — `git commit -m "feat(teacher): Enrolled-students heading + Previous-students button on the marker"`.

---

### Task 8: PreviousStudentsPanel + `/previous` page

**Files:**
- Create: `apps/portal/src/features/setu/teacher/components/previous-students-panel.tsx`
- Create: `apps/portal/src/app/teacher/levels/[levelId]/previous/page.tsx`
- Test: `apps/portal/src/features/setu/teacher/components/__tests__/previous-students-panel.test.tsx`

**Interfaces:** `PreviousStudentsPanel({ levelId, levelName, ageLabel, date, initial }: { levelId: string; levelName: string; ageLabel: string; date: string; initial: PreviousStudentRow[] })`. The page (mirror `visitors/page.tsx`) verifies the session + `canTeachLevel`, calls `getLevelPreviousStudentsView`, and renders the panel with `initial={view.students}`.

**Panel behavior:** render each row (avatar initial, name, grade pill) with a "Mark present" button. On click → `POST /api/setu/teacher/attendance/confirm-previous { levelId, mid, date }`. On success: toast "Added to this year's class" and optimistically remove ALL rows sharing that row's `fid` (siblings confirm together). On failure: toast an error, keep the row. A back link "← Back to attendance" to `/teacher/levels/${levelId}/attendance?date=${date}`. Empty state when `initial` is empty: "No returning students - everyone on this roster is enrolled." A one-line explainer under the title: "Returning from last year. Mark one present to add their family to this year's class."

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));
import { PreviousStudentsPanel } from '../previous-students-panel';

const initial = [
  { mid: 'C-02', fid: 'C', firstName: 'Cara', lastName: 'Cherry', schoolGrade: 'Grade 2' },
  { mid: 'C-03', fid: 'C', firstName: 'Cody', lastName: 'Cherry', schoolGrade: 'Grade 3' },
  { mid: 'D-02', fid: 'D', firstName: 'Dan', lastName: 'Date', schoolGrade: 'Grade 2' },
];

beforeEach(() => { toastMock.success.mockReset(); toastMock.error.mockReset(); vi.restoreAllMocks(); });

it('marks a previous student present and removes the whole family from the list', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true, fid: 'C' }) } as Response);
  const user = userEvent.setup();
  render(<PreviousStudentsPanel levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" initial={initial} />);
  expect(screen.getByText('Cara Cherry')).toBeTruthy();
  await user.click(screen.getAllByRole('button', { name: /mark present/i })[0]!);
  await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  // both Cherry siblings gone; the Date family remains
  expect(screen.queryByText('Cara Cherry')).toBeNull();
  expect(screen.queryByText('Cody Cherry')).toBeNull();
  expect(screen.getByText('Dan Date')).toBeTruthy();
});

it('renders the empty state when there are no previous students', () => {
  render(<PreviousStudentsPanel levelId="L" levelName="Level 2" ageLabel="Gr 2 & 3" date="2026-01-18" initial={[]} />);
  expect(screen.getByText(/everyone on this roster is enrolled/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement the panel** (`'use client'`; model styling on `visitors-panel.tsx` rows). Core logic:

```tsx
'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';

interface Row { mid: string; fid: string; firstName: string; lastName: string; schoolGrade: string | null; }
interface Props { levelId: string; levelName: string; ageLabel: string; date: string; initial: Row[]; }

export function PreviousStudentsPanel({ levelId, levelName, ageLabel, date, initial }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, startTransition] = useTransition();
  const [busyMid, setBusyMid] = useState<string | null>(null);

  function markPresent(row: Row) {
    setBusyMid(row.mid);
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/attendance/confirm-previous', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, mid: row.mid, date }),
        });
        if (!res.ok) { toast.error('Could not mark present - please try again.'); return; }
        toast.success(`${row.firstName} added to this year's class.`);
        setRows((prev) => prev.filter((r) => r.fid !== row.fid)); // siblings confirm together
      } catch {
        toast.error('Network error - please try again.');
      } finally {
        setBusyMid(null);
      }
    });
  }
  // ...render: header with back link + title "Previous students" + explainer;
  //    empty state when rows.length === 0 ("No returning students - everyone on this roster is enrolled.");
  //    else a card list, each row: avatar initial, "First Last", grade pill, a
  //    "Mark present" button (disabled when pending && busyMid === row.mid).
}
```

Render the list with the same row card styling as `visitors-panel.tsx` (avatar circle, name, grade pill, right-aligned primary button). Reuse `initial(name)` helper style (first glyph uppercase).

- [ ] **Step 4: Implement the page** `apps/portal/src/app/teacher/levels/[levelId]/previous/page.tsx` (mirror `visitors/page.tsx` exactly, swapping the helper + component):

```tsx
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import type { WithRole } from '@cmt/shared-domain';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelPreviousStudentsView } from '@/features/setu/teacher/previous-students-view';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';
import { PreviousStudentsPanel } from '@/features/setu/teacher/components/previous-students-panel';

export const metadata = { title: 'Previous students - CMT Teacher' };

export default async function PreviousStudentsPage({ params, searchParams }: { params: Promise<{ levelId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { levelId } = await params;
  const { date: dateParam } = await searchParams;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const claims = (sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null) as (WithRole & { mid?: string | null }) | null;
  if (!claims) return <p style={{ color: 'var(--err)', fontSize: 14 }}>Please sign in.</p>;
  const access = await canTeachLevel(claims, levelId);
  if (access === 'level-not-found') return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  if (access === 'forbidden') return <p style={{ color: 'var(--err)', fontSize: 14 }}>You’re not assigned to this class.</p>;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mostRecentSunday();
  const view = await getLevelPreviousStudentsView(levelId, date);
  if (!view) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  return <PreviousStudentsPanel levelId={view.levelId} levelName={view.levelName} ageLabel={view.ageLabel} date={view.date} initial={view.students} />;
}
```

- [ ] **Step 5: Run tests to verify they pass** — the panel test → PASS. `pnpm --filter @cmt/portal typecheck`. **Commit** — `git commit -m "feat(teacher): Previous students panel + page"`.

---

### Task 9: Docs - MOBILE_API_CHANGELOG + runbook

**Files:**
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md`
- Modify: `docs/runbooks/production-cutover-checklist.md`

- [ ] **Step 1:** Prepend a dated entry to `MOBILE_API_CHANGELOG.md` (SHA filled at commit time): new `POST /api/setu/teacher/attendance/confirm-previous` `{ levelId, mid, date }` → `{ ok: true, fid }` (teacher-gated). Note the teacher roster now returns confirmed students only; the mobile teacher roster should mirror the Enrolled/Previous split and call this endpoint to confirm a previous student. No breaking change to existing `/api/setu/teacher/attendance` shapes.

- [ ] **Step 2:** Add a dated §14 entry to the runbook: teacher-roster semantics change (Enrolled = confirmed via issue #23 rule; Previous = unconfirmed carry-forwards). **No DB op, no index, no migration.** Record that this is presentation/read-model only.

- [ ] **Step 3: Commit** — `git commit -m "docs(teacher): MOBILE_API_CHANGELOG + runbook for Enrolled/Previous split"`.

---

### Task 10: Deployed-UAT E2E

**Files:**
- Create: `apps/portal/e2e/setu/teacher/previous-students.spec.ts`

**Reference:** existing teacher/roster E2E patterns under `apps/portal/e2e/setu/` and the E2E auth/seed helpers (`e2e/auth-helpers.ts`, seed scripts). Run against deployed UAT: `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal test:e2e -- e2e/setu/teacher/previous-students.spec.ts`.

**Fixture (realistic, multi-instance, ACTIVE):** a teacher account assigned to a level with:
- ≥2 CONFIRMED enrollments (e.g. `enrolledVia: 'family-initiated'`, or a promotion enrollment with a present attendance event already in the period), and
- ≥2 PREVIOUS enrollments (`enrolledVia: 'promotion'`, no engagement), one of which is a two-sibling family in this level.
Seed via the existing E2E seed helpers; the spec cleans up what it creates (`_test: true` sweep discipline).

- [ ] **Step 1: Write the E2E spec.** Assertions:
  1. Open `/teacher/levels/[levelId]/attendance` → the "Enrolled students (N)" count equals the confirmed count; the roster shows only confirmed students; "Previous students (M)" button shows the unconfirmed count.
  2. Click "Previous students" → the page lists the previous students (both siblings of the two-sibling family present).
  3. Click "Mark present" on one previous student → success toast; both siblings disappear from the Previous list (optimistic).
  4. Reload `/attendance` → the marked student appears in the main Enrolled list (present); the Enrolled count incremented by the family's members in THIS level; Previous count decremented.
  5. Save attendance normally, then assert the remaining previous students were NOT written Absent (query their attendance for the date is absent-of-record, or assert via the student/report surface that they have no absent mark).

- [ ] **Step 2: Run against deployed UAT** — after the code is deployed (push triggers Vercel). `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal test:e2e -- e2e/setu/teacher/previous-students.spec.ts` → all green. If a Firestore index error surfaces (rule #8), audit and deploy to UAT only (never `--force`, never prod).

- [ ] **Step 3: Commit** — `git commit -m "test(teacher): deployed-UAT E2E for Enrolled vs Previous students"`.

---

## Post-plan: whole-branch review + index audit

After Task 10, run the final whole-branch review (superpowers:requesting-code-review) and the Firestore index audit (`auditing-firestore-indexes` skill) over every new query shape. Confirm no new index is needed (the design expects none; the `attendanceEvents.where('pid')` query is single-field auto-indexed on a top-level collection). Then push through the pre-push gate.

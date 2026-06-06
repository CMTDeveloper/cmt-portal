# Teacher Attendance — T2 (redesigned teacher screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A redesigned, mobile-first teacher level-attendance screen using the **"default present, flag exceptions"** model: every enrolled kid in the level opens as **present** (any prior portal mark wins; door self-check-ins show a `·door` badge), the teacher taps only the late/absent exceptions, and Save writes present/late/absent for the whole class to `attendanceEvents`. Defaults to the most-recent **Sunday** (the BV class day).

**Architecture:** A new server reader `getLevelAttendanceView(levelId, date)` composes the existing enrollment-gated `deriveRoster` (portal `attendanceEvents` per kid) with a **read-only door overlay** (who self-checked-in at the ashram that date, via the T1 `checkInSourceFirestore()` bridge), and resolves each kid to a default-present status with a source (`portal` mark wins → `door` → `default`). The redesigned `<AttendanceMarker>` client island renders that view (present/late/absent per row, `·door` badge, live present-count, prev/next-Sunday nav, sticky Save) and posts the full marks map to the unchanged `saveAttendance`. The teacher page + the mobile roster API both serve the same view.

**Tech Stack:** Next.js 16 App Router, Firebase Admin (read-only door bridge from T1), Vitest + Testing Library + userEvent, TypeScript `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. Spec: `docs/superpowers/specs/2026-06-06-teacher-attendance-redesign-design.md`.

## Cross-cutting (hard rules)
- **UI/UX is the headline requirement** (CMT Developer): best-in-class **mobile-first** (teachers mark on a phone in class) AND desktop, designer pass on the screen (Task 5). Cool-Mist tokens, `CspRoot`/`.csp` scoping (the teacher layout already wraps children in `CspRoot`, so `.card`/`.btn`/`.pill`/`.input` + tokens resolve). Big tap targets (≥44px), thumb-reachable Save.
- **Read-only door access** — the overlay only READS `family-check-ins` via `checkInSourceFirestore()` (T1). Never writes the door's collections.
- **Mobile-app-ready** — the roster API uses `readSessionFromHeaders` + `isTeacher` + `canTeachLevel`, ISO/plain JSON. The page may use `cookies()`/`verifyPortalSessionCookie` (web render).
- **`exactOptionalPropertyTypes`** — conditional-spread, never assign `undefined` to an optional.
- **N=2** — the resolver/precedence already guards same-date duplicates; the view test uses ≥2 kids with mixed statuses + a door-checked-in kid.

## Key facts (verified — build on these)
- `deriveRoster(levelId, date)` (`features/setu/teacher/roster.ts`) → `RosterResult { levelId, levelName, ageLabel, location, pid, date, members: RosterMember[], markedCount, total }`. `RosterMember { mid, fid, firstName, lastName, type, schoolGrade, hasSafetyInfo, status: RosterStatus }` where `RosterStatus = SetuAttendanceStatus | 'unaccounted'`. A matched kid with no portal `attendanceEvents` row is `'unaccounted'`. Enrollment-gated by active enrollment for `level.pid` at `level.location` + `memberMatchesLevel`. **It does NOT currently carry `legacySid`/`legacyFid`** — T2.1 adds them.
- `buildRoster(level, families, events, date, now)` is the pure core; `RosterMemberInput { mid, firstName, lastName, type, schoolGrade, birthMonthYear, foodAllergies }`; `RosterFamily { fid, members }`.
- `saveAttendance({ levelId, date, marks: Record<mid, SetuAttendanceStatus>, markedByUid, markedByMid })` (`save-attendance.ts`) writes one `attendanceEvents/{aid}` per mid (`aid = attendanceAid(levelId, mid, date)`), `isGuest:false`, idempotent merge; mids not on the roster are skipped. **Unchanged by T2.**
- `POST /api/setu/teacher/attendance` (`SaveAttendanceSchema { levelId, date, marks }`, `isTeacher` + `canTeachLevel`) → `saveAttendance`. **Unchanged by T2.**
- `GET /api/setu/teacher/levels/[levelId]/roster` currently returns `deriveRoster`. T2.3 repoints it to the view.
- `checkInSourceFirestore()` (T1, `features/setu/attendance/check-in-source.ts`) → read-only Firestore handle to the door app's project. Door doc: `family-check-ins/{legacyFid}/checkIns/{YYYY-MM-DD}.students[{ sid, isCheckedIn }]`.
- `getCheckInAttendance` + `CheckInRecord` live in `features/setu/attendance/check-in-attendance.ts`.
- `torontoToday(now?)` (`features/setu/calendar/calendar.ts`) → Toronto `YYYY-MM-DD`. **No Sunday helper yet** — T2.1 adds `mostRecentSunday`.
- Family `legacyFid` is on the `families/{fid}` doc; member `legacySid` is on each `families/{fid}/members/{mid}` doc (both mapped in `get-family-by-fid.ts`). Null for portal-native families/kids.
- `SetuAttendanceStatus = 'present'|'late'|'absent'`, `RosterStatus`, `memberMatchesLevel`, `attendanceAid` all from `@cmt/shared-domain`.
- The existing island `features/setu/teacher/components/attendance-marker.tsx` (`'use client'`, `useState`+`useTransition`, `toast` from `@cmt/ui`) is the pattern to REWRITE.

## File structure
**Create:**
- `apps/portal/src/features/setu/teacher/level-attendance-view.ts` (+ `__tests__/level-attendance-view.test.ts`) — the composed view reader.
- (door reader) extend `apps/portal/src/features/setu/attendance/check-in-attendance.ts` with `readDoorPresentSids(legacyFids, date)`.

**Modify:**
- `apps/portal/src/features/setu/teacher/roster.ts` (+ its test) — carry `legacyFid`/`legacySid`.
- `apps/portal/src/features/setu/calendar/calendar.ts` (+ its test) — add `mostRecentSunday`.
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` (+ test) — redesigned island.
- `apps/portal/src/app/teacher/levels/[levelId]/attendance/page.tsx` — use the view + Sunday default.
- `apps/portal/src/app/api/setu/teacher/levels/[levelId]/roster/route.ts` (+ test if present) — return the view.

---

## Task 1: carry legacy bridge fields through the roster + `mostRecentSunday`

**Files:** modify `roster.ts` (+ `__tests__/roster.test.ts`), `calendar.ts` (+ `__tests__/calendar.test.ts`).

- [ ] **Step 1 — extend roster types + reads.** In `roster.ts`:
  - add `legacySid: string | null;` to `RosterMemberInput`.
  - add `legacyFid: string | null;` to `RosterFamily`.
  - add `legacySid: string | null;` and `legacyFid: string | null;` to `RosterMember`.
  - in `buildRoster`, when pushing a member, set `legacySid: m.legacySid`, `legacyFid: fam.legacyFid`.
  - in `deriveRoster`'s family loop, ALSO read the family doc for `legacyFid` and capture `legacySid` from each member doc:
```ts
// inside fids.map(async (fid) => { ... })
const [famDoc, memSnap] = await Promise.all([
  db.collection('families').doc(fid).get(),
  db.collection('families').doc(fid).collection('members').get(),
]);
const legacyFid = (famDoc.data()?.legacyFid as string | undefined) ?? null;
return {
  fid,
  legacyFid,
  members: memSnap.docs.map((d) => {
    const m = d.data();
    return {
      mid: m.mid, firstName: m.firstName, lastName: m.lastName, type: m.type,
      schoolGrade: m.schoolGrade ?? null, birthMonthYear: m.birthMonthYear ?? null,
      foodAllergies: m.foodAllergies ?? null, legacySid: m.legacySid ?? null,
    };
  }),
};
```

- [ ] **Step 2 — update `roster.test.ts`.** READ it. Add `legacySid`/`legacyFid` to its fixtures (RosterFamily fixtures get `legacyFid`, member fixtures get `legacySid`) and assert the built RosterMember carries them through for at least one member. Do NOT weaken existing assertions. Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/roster.test.ts` → green.

- [ ] **Step 3 — `mostRecentSunday` failing test.** Add to `apps/portal/src/features/setu/calendar/__tests__/calendar.test.ts` (create if absent, mirroring the torontoToday test style):
```ts
import { mostRecentSunday } from '../calendar';
it('mostRecentSunday returns the same day when today is Sunday', () => {
  expect(mostRecentSunday(new Date('2026-01-04T17:00:00Z'))).toBe('2026-01-04'); // 2026-01-04 is a Sunday
});
it('mostRecentSunday rolls back to the previous Sunday midweek', () => {
  expect(mostRecentSunday(new Date('2026-01-07T17:00:00Z'))).toBe('2026-01-04'); // Wed → prev Sun
});
```

- [ ] **Step 4 — implement `mostRecentSunday`** in `calendar.ts` (near `torontoToday`):
```ts
/** The most recent Sunday (today if today is Sunday) as a Toronto YYYY-MM-DD. */
export function mostRecentSunday(now: Date = new Date()): string {
  const today = torontoToday(now); // Toronto calendar date
  const d = new Date(`${today}T12:00:00Z`); // noon UTC: weekday is tz-stable
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay 0 = Sunday
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 5 — run both suites + `tsc --noEmit` → green. Step 6 — commit:** `feat(teacher-attendance): roster carries legacy bridge fields; mostRecentSunday helper`.

---

## Task 2: door presence reader `readDoorPresentSids`

**Files:** modify `apps/portal/src/features/setu/attendance/check-in-attendance.ts` (+ `__tests__/check-in-attendance.test.ts`).

- [ ] **Step 1 — failing test** (add to the existing check-in-attendance test; it already mocks `../check-in-source`'s `checkInSourceFirestore`). Assert: given two legacyFids whose `checkIns/{date}` docs list students, `readDoorPresentSids(['4421','7000'], '2026-01-04')` returns a `Set` of the sids with `isCheckedIn === true` across both families; a missing day-doc contributes nothing; never throws.
```ts
it('readDoorPresentSids collects checked-in sids for a date across families', async () => {
  // mock checkInSourceFirestore() to return a fake where:
  //   family-check-ins/4421/checkIns/2026-01-04 → { students: [{sid:'S9',isCheckedIn:true},{sid:'S8',isCheckedIn:false}] }
  //   family-check-ins/7000/checkIns/2026-01-04 → { students: [{sid:'S1',isCheckedIn:true}] }
  // (build the fake doc().get() per-path; see the existing test's fake-firestore chain)
  const out = await readDoorPresentSids(['4421', '7000'], '2026-01-04');
  expect(out).toEqual(new Set(['S9', 'S1']));
});
```
(Mirror the fake-firestore chain already in this test file; key the fake by the doc id path so the two families resolve to different student arrays. If the existing fake is too simple, extend it to route by `doc(id)`.)

- [ ] **Step 2 — implement** in `check-in-attendance.ts`:
```ts
/**
 * READ-ONLY: the set of legacy sids checked in at the door for a single date,
 * across the given families. Used to overlay door self-check-ins onto a teacher
 * roster. Reads `family-check-ins/{legacyFid}/checkIns/{date}` via the seam;
 * tolerates missing docs and read errors (returns what it can).
 */
export async function readDoorPresentSids(
  legacyFids: ReadonlyArray<string>,
  date: string,
): Promise<Set<string>> {
  const present = new Set<string>();
  const db = checkInSourceFirestore();
  await Promise.all(
    [...new Set(legacyFids)].map(async (legacyFid) => {
      try {
        const snap = await db
          .collection('family-check-ins').doc(legacyFid)
          .collection('checkIns').doc(date).get();
        if (!snap.exists) return;
        const students = (snap.data()?.students ?? []) as Array<{ sid?: string | number; isCheckedIn?: boolean }>;
        for (const s of students) {
          if (s.isCheckedIn === true && s.sid != null) present.add(String(s.sid));
        }
      } catch (err) {
        console.error('[door-presence] read failed for', legacyFid, date, err);
      }
    }),
  );
  return present;
}
```
(Add `import { checkInSourceFirestore } from './check-in-source';` — it's already imported in this file after T1.)

- [ ] **Step 3 — run the suite + `tsc --noEmit` → green. Step 4 — commit:** `feat(teacher-attendance): readDoorPresentSids — door self-check-ins for a date`.

---

## Task 3: `getLevelAttendanceView(levelId, date)` reader

**Files:** create `apps/portal/src/features/setu/teacher/level-attendance-view.ts` + `__tests__/level-attendance-view.test.ts`.

- [ ] **Step 1 — failing test.** Mock `./roster` (`deriveRoster`) and `@/features/setu/attendance/check-in-attendance` (`readDoorPresentSids`). Assert with a 3-kid roster (one portal `absent`, one `unaccounted` + door-checked-in, one `unaccounted` + no door):
  - the portal-`absent` kid → `status:'absent', source:'portal'`;
  - the `unaccounted` + door kid → `status:'present', source:'door', checkedInAtDoor:true`;
  - the `unaccounted` + no-door kid → `status:'present', source:'default', checkedInAtDoor:false`;
  - `presentCount === 2`, `total === 3`;
  - `deriveRoster` null → reader returns null.
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockDerive, mockDoor } = vi.hoisted(() => ({ mockDerive: vi.fn(), mockDoor: vi.fn() }));
vi.mock('../roster', () => ({ deriveRoster: mockDerive }));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({ readDoorPresentSids: mockDoor }));
import { getLevelAttendanceView } from '../level-attendance-view';

beforeEach(() => { mockDerive.mockReset(); mockDoor.mockReset(); });

it('resolves default-present with door overlay + portal precedence', async () => {
  mockDerive.mockResolvedValue({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton', pid: 'o-bv', date: '2026-01-04',
    markedCount: 1, total: 3,
    members: [
      { mid: 'F-02', fid: 'F', firstName: 'A', lastName: 'Z', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'absent', legacyFid: '4421', legacySid: 'S8' },
      { mid: 'F-03', fid: 'F', firstName: 'B', lastName: 'Y', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'unaccounted', legacyFid: '4421', legacySid: 'S9' },
      { mid: 'G-02', fid: 'G', firstName: 'C', lastName: 'X', type: 'Child', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'unaccounted', legacyFid: '7000', legacySid: 'S1' },
    ],
  });
  mockDoor.mockResolvedValue(new Set(['S9'])); // only F-03 checked in at the door
  const view = await getLevelAttendanceView('L', '2026-01-04');
  expect(view).not.toBeNull();
  const byMid = Object.fromEntries(view!.rows.map((r) => [r.mid, r]));
  expect(byMid['F-02']).toMatchObject({ status: 'absent', source: 'portal', checkedInAtDoor: false });
  expect(byMid['F-03']).toMatchObject({ status: 'present', source: 'door', checkedInAtDoor: true });
  expect(byMid['G-02']).toMatchObject({ status: 'present', source: 'default', checkedInAtDoor: false });
  expect(view!.presentCount).toBe(2);
  expect(view!.total).toBe(3);
  expect(mockDoor).toHaveBeenCalledWith(['4421', '7000'], '2026-01-04'); // unique non-null legacyFids
});

it('returns null when the level is missing', async () => {
  mockDerive.mockResolvedValue(null);
  expect(await getLevelAttendanceView('nope', '2026-01-04')).toBeNull();
});
```

- [ ] **Step 2 — implement** `level-attendance-view.ts`:
```ts
import type { SetuAttendanceStatus } from '@cmt/shared-domain';
import { deriveRoster } from './roster';
import { readDoorPresentSids } from '@/features/setu/attendance/check-in-attendance';

export type AttendanceRowSource = 'portal' | 'door' | 'default';

export interface AttendanceViewRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  hasSafetyInfo: boolean;
  status: SetuAttendanceStatus; // present | late | absent — defaults to present
  source: AttendanceRowSource;
  checkedInAtDoor: boolean;
}

export interface AttendanceView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string;
  pid: string;
  date: string;
  rows: AttendanceViewRow[];
  presentCount: number;
  total: number;
}

/**
 * The teacher attendance screen's read model: the enrollment-gated roster with
 * each kid resolved to a DEFAULT-PRESENT status, a prior portal mark winning,
 * and a read-only door self-check-in overlay (the `·door` badge). Returns null
 * if the level is missing.
 */
export async function getLevelAttendanceView(levelId: string, date: string): Promise<AttendanceView | null> {
  const roster = await deriveRoster(levelId, date);
  if (!roster) return null;

  const legacyFids = [...new Set(roster.members.map((m) => m.legacyFid).filter((v): v is string => !!v))];
  const doorSids = legacyFids.length > 0 ? await readDoorPresentSids(legacyFids, date) : new Set<string>();

  const rows: AttendanceViewRow[] = roster.members.map((m) => {
    const checkedInAtDoor = !!m.legacySid && doorSids.has(m.legacySid);
    // Portal mark (present/late/absent) wins; else default present (door or not).
    const hasPortalMark = m.status !== 'unaccounted';
    const status: SetuAttendanceStatus = hasPortalMark ? m.status : 'present';
    const source: AttendanceRowSource = hasPortalMark ? 'portal' : checkedInAtDoor ? 'door' : 'default';
    return {
      mid: m.mid, fid: m.fid, firstName: m.firstName, lastName: m.lastName,
      schoolGrade: m.schoolGrade, hasSafetyInfo: m.hasSafetyInfo,
      status, source, checkedInAtDoor,
    };
  });

  const presentCount = rows.filter((r) => r.status === 'present').length;
  return {
    levelId: roster.levelId, levelName: roster.levelName, ageLabel: roster.ageLabel,
    location: roster.location, pid: roster.pid, date: roster.date,
    rows, presentCount, total: rows.length,
  };
}
```

- [ ] **Step 3 — run + `tsc --noEmit` → green. Step 4 — commit:** `feat(teacher-attendance): getLevelAttendanceView — roster + door overlay, default-present`.

---

## Task 4: redesigned `<AttendanceMarker>` island + page/route wiring

**Files:** rewrite `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` (+ `__tests__/attendance-marker.test.tsx`); modify the attendance page + the roster API route.

- [ ] **Step 1 — failing island test** `apps/portal/src/features/setu/teacher/components/__tests__/attendance-marker.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AttendanceMarker } from '../attendance-marker';

const ROWS = [
  { mid: 'F-02', fid: 'F', firstName: 'Aarav', lastName: 'Shah', schoolGrade: 'Grade 1', hasSafetyInfo: false, status: 'present' as const, source: 'default' as const, checkedInAtDoor: false },
  { mid: 'F-03', fid: 'F', firstName: 'Diya', lastName: 'Patel', schoolGrade: 'Grade 1', hasSafetyInfo: true, status: 'present' as const, source: 'door' as const, checkedInAtDoor: true },
];

beforeEach(() => { global.fetch = vi.fn(async () => new Response(JSON.stringify({ saved: 2, skipped: [] }), { status: 200 })) as never; });

function props(over = {}) {
  return { levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', date: '2026-01-04', rows: ROWS, presentCount: 2, total: 2, ...over };
}

it('opens with everyone present and shows the live present count', () => {
  render(<AttendanceMarker {...props()} />);
  expect(screen.getByText('Aarav Shah')).toBeDefined();
  expect(screen.getByText(/2\s*\/\s*2 present/i)).toBeDefined();
});

it('shows a door badge for the door-checked-in student', () => {
  render(<AttendanceMarker {...props()} />);
  const diya = screen.getByText('Diya Patel').closest('[data-testid="att-row"]') as HTMLElement;
  expect(within(diya).getByText(/door/i)).toBeDefined();
});

it('flagging a student absent decrements the present count and posts the full marks map', async () => {
  const user = userEvent.setup();
  render(<AttendanceMarker {...props()} />);
  const aarav = screen.getByText('Aarav Shah').closest('[data-testid="att-row"]') as HTMLElement;
  await user.click(within(aarav).getByRole('button', { name: /absent/i }));
  expect(screen.getByText(/1\s*\/\s*2 present/i)).toBeDefined();
  await user.click(screen.getByRole('button', { name: /save attendance/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/attendance', expect.objectContaining({ method: 'POST' }));
  const body = JSON.parse((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as never as string ?? '{}');
  // tolerate body access either way:
  const sent = JSON.parse(((global.fetch as unknown as { mock: { calls: any[][] } }).mock.calls[0][1]).body);
  expect(sent).toMatchObject({ levelId: 'L', date: '2026-01-04', marks: { 'F-02': 'absent', 'F-03': 'present' } });
});
```
(If the double body-parse is awkward in this repo's vitest, keep only the `sent` assertion — the point is: the POST body carries the FULL marks map with the flagged change.)

- [ ] **Step 2 — implement** the redesigned `attendance-marker.tsx` (`'use client'`). Requirements (designer polishes visuals in Task 5; ship it functional + themed + mobile-first now):
  - Props: `{ levelId, levelName, ageLabel, date, rows: AttendanceViewRow[], presentCount, total }` (import the `AttendanceViewRow` type from `@/features/setu/teacher/level-attendance-view`).
  - State `marks: Record<string, SetuAttendanceStatus>` seeded from `rows` (`{ [r.mid]: r.status }`). A derived live `presentCount = Object.values(marks).filter(s => s === 'present').length`.
  - **Header**: level name + `ageLabel · {date}` + prev/next-Sunday nav — `‹`/`›` `next/link`s to `?date=${addDays(date, -7)}` / `?date=${addDays(date, +7)}` (compute with a local `addDays(ymd, n)` helper: `new Date(\`${ymd}T12:00:00Z\`)`, `setUTCDate(+n)`, slice). A "Visitors →" link to `/teacher/levels/${levelId}/guests?date=${date}` (T3 redesigns that screen).
  - **Roster**: one row per `rows` entry, each with `data-testid="att-row"`. Show name, grade, a safety dot when `hasSafetyInfo` (link to `/teacher/students/${mid}`), a `·door` pill when `checkedInAtDoor`, and three segmented buttons **Present / Late / Absent** (`aria-pressed` on the active one; tap sets `marks[mid]`). Present = accent, Late = warn, Absent = err (match the existing OPTION colors).
  - **Sticky footer**: live `{presentCount} / {total} present` + a **Save attendance** primary button → `fetch('/api/setu/teacher/attendance', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ levelId, date, marks }) })`; `!res.ok` → `toast.error`; success → `toast.success('Attendance saved')`. `useTransition` for pending; disable Save while pending.
  - Empty roster (`rows.length === 0`) → a friendly "No enrolled students match this level yet." card.
  - NO nested component declarations (module-scope helpers or inline only). Mobile-first: rows are full-width, the 3 buttons are a `repeat(3,1fr)` grid, the footer is `position:sticky` bottom.

- [ ] **Step 3 — wire the page** `app/teacher/levels/[levelId]/attendance/page.tsx`:
  - import `getLevelAttendanceView` + `mostRecentSunday`.
  - `const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mostRecentSunday();`
  - `const view = await getLevelAttendanceView(levelId, date); if (!view) return <p ...>That class doesn't exist.</p>;`
  - render `<AttendanceMarker levelId={view.levelId} levelName={view.levelName} ageLabel={view.ageLabel} date={view.date} rows={view.rows} presentCount={view.presentCount} total={view.total} />`.
  - (keep the existing cookie/`canTeachLevel` auth block unchanged.)

- [ ] **Step 4 — repoint the roster API** `app/api/setu/teacher/levels/[levelId]/roster/route.ts`: replace `deriveRoster(levelId, date)` with `getLevelAttendanceView(levelId, date)` and return `{ view }` (keep the `isTeacher`+`canTeachLevel`+date-validation guards; default date to `mostRecentSunday()`). Update its test if present.

- [ ] **Step 5 — run the island test + page/route tests + `tsc --noEmit` + `eslint` on touched files → green. Step 6 — commit:** `feat(teacher-attendance): redesigned default-present attendance screen + door overlay`.

---

## Task 5 (controller): designer pass + slice verification
- [ ] **Designer pass.** Dispatch `oh-my-claudecode:designer` (opus) over `attendance-marker.tsx` ONLY: a beautiful, fast, **mobile-first** class-attendance experience — confident present/late/absent segmented control with big tap targets, a calm `·door` annotation, a satisfying live present-count, the Sunday nav, and a thumb-reachable sticky Save; excellent at 375px AND a clean desktop layout. Constraint: do NOT change props, the `AttendanceViewRow` contract, exported name `AttendanceMarker`, the fetch contract, `data-testid="att-row"`, or test-queried text (`/save attendance/i`, `/present/i`, `/late/i`, `/absent/i`, `/door/i`, `\d/\d present`). Re-run the island test + `tsc` + `eslint`. Commit `style(teacher-attendance): polish the attendance screen`.
- [ ] **Final review** (Opus, separate context): spec-compliance + code-quality over the slice (view reader, door overlay, island, page/route). Address blocking/important issues; re-review.

## T2 verification (before done)
- [ ] `tsc --noEmit` (portal) → 0; `pnpm lint` clean; the touched suites + full attendance/teacher suites green; `pnpm build` green (the `/teacher/levels/[levelId]/attendance` page + roster route prerender).
- [ ] **Read-only** door access confirmed (grep: the overlay only `.get()`s `family-check-ins`; no writes).
- [ ] **Default-present** verified: a fresh roster opens all-present; flagging changes the count; Save posts the full map; re-open shows the saved marks (portal wins).
- [ ] **Mobile** verified at ~375px (rows + 3-button control + sticky Save) AND desktop.
- [ ] Push (full pre-push gate).
- [ ] Update resume-note memory: T2 shipped; T3 (visitors) next.

## Not in T2 (later slices)
- T3: door **guest** reader + grade→level matching + in-class quick-add (the Visitors section/screen; the "Visitors →" link lands there).
- T4: family-facing union (child profile + dashboard BV via `getMemberUnifiedAttendance`).
- T5: rollout (flag, teacher-assignment validation, UAT walkthrough).

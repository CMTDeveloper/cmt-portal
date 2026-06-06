# Child Profile — Slice 1 (profile + enrollments + per-program attendance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A dedicated, read-focused **child profile** showing a member's identity, the **programs they're enrolled in**, and their **per-program attendance** — at `/family/members/[mid]/profile` (family, own-family) AND `/welcome/family/[fid]/members/[mid]` (welcome/admin, any family), both rendering ONE shared `<ChildProfileView>` component, plus a mobile-ready `GET /api/setu/members/[mid]/profile`. Achievements are Slice 2 (omitted here).

**Architecture:** An **auth-agnostic** composing reader `getChildProfile(mid)` resolves the family from the `mid`, then assembles identity + the child's enrollments (`enrolledMids.includes(mid)`) + per-program attendance (branching on each program's `attendanceMode`: teacher-marked `attendanceEvents` matched by `record.pid === enrollment.oid`, or legacy BV check-in scoped to the offering window). The **routes enforce access** (family page = own-family, welcome page + welcome branch of the API = `isWelcomeTeam`); the reader does not. The result object is plain-JSON (no `Date`s) so the page renders it and the API returns it unchanged.

**Tech Stack / conventions:** Next.js 16 App Router, Cache Components (`await connection()` on pages touching Firebase Admin), Vitest + Testing Library, `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. Spec: `docs/superpowers/specs/2026-06-06-child-profile-design.md`.

## Cross-cutting (hard rules — do not skip)
- **Mobile-app readiness:** the `GET /api/setu/members/[mid]/profile` handler derives identity via `readSessionFromHeaders(req)` (cookie OR Bearer); NEVER `cookies()`/`getCurrentFamily()` in the handler. JSON, ISO/plain values, `{ ... }`/`{ error }` envelope. Pages MAY use `getCurrentFamily()`/`cookies()` (web render).
- **On-theme UX:** Cool-Mist tokens, `CspRoot`/`.csp` scoping (the welcome desktop branch is inside the welcome layout's CspRoot; mobile branches self-wrap in `CspRoot`; anything rendered where tokens don't resolve uses inline-styled equivalents, NOT `.pill`/`.card`), real mobile (`block md:hidden`) + desktop (`hidden md:block`), designer pass on the shared component. Mirror `app/family/members/[mid]/page.tsx`, `app/welcome/family/[fid]/page.tsx`, and the teacher `student-detail` heatmap.
- **Role checks via helpers** (`isSetuFamily`/`isWelcomeTeam`), never strict equality. **N=3 correctness** (MEMORY trap): a child in 3 programs must render ALL three with their own attendance — tests use a 3-program fixture.
- **No new Firestore index:** `getAttendanceForMember` uses the existing `attendanceEvents (mid, date DESC)` index; everything else is single-doc/family reads. Don't introduce a two-field query that needs a composite.

## Key data facts (verified — build on these)
- `MemberDoc`: `mid` (`${fid}-NN`), `firstName/lastName`, `type: 'Adult'|'Child'`, `schoolGrade`, `birthMonthYear`, `foodAllergies`, `legacySid` (bridge to BV check-ins; null for portal-native kids).
- `getEnrollments(fid)` → `EnrollmentWithOffering[]` (`get-enrollments.ts`): each has `eid`, `oid`, `programKey`, `programLabel`, `termLabel`, `location` (nullable), `status: 'active'|'cancelled'`, `enrolledMids: string[]`, and `offering: OfferingDoc | null` (with `startDate`/`endDate: Date`).
- `getProgram`/`listPrograms` (`get-programs.ts`) → `ProgramDoc.capabilities.attendanceMode: 'none'|'check-in'|'teacher'`.
- `getAttendanceForMember(mid)` (`features/setu/teacher/get-attendance.ts`) → `AttendanceRecord[]` newest-first, each `{ aid, mid, fid, levelId, pid, date: 'YYYY-MM-DD', status: 'present'|'late'|'absent' }`. **`pid` === the offering id (`oid`)** (confirmed: levels/attendance store the offering id in `pid`). `summarize(records)` → `{ present, late, absent, total, attendedPct }`.
- `getCheckInAttendance(legacyFid)` + `summarizeMemberCheckIns(records, legacySid)` (`features/setu/attendance/check-in-attendance.ts`) → `{ attended, recorded, lastDate, marks: {date,present}[] }`. Family-level reader; per-member via `legacySid`.
- `getFamilyByFid(fid)` (`features/setu/members/get-family-by-fid.ts`, `'use cache'`) → `{ family, members }`.
- `getCurrentFamily()` → `{ family, members, currentMid, isManager }`. `readSessionFromHeaders(req)` → `{ uid, role, extraRoles, fid, mid } | null`.
- `isoToTorontoDateInput(iso)` from `@/lib/toronto-date` (YMD in Toronto).
- **Boundaries:** `eslint-plugin-boundaries` only governs `features/check-in/**`; `features/setu/*` may import across each other freely (Slice C's seva reader already imports `features/setu/members`).

---

## File structure
**Create:**
- `apps/portal/src/features/setu/members/get-child-profile.ts` (+ `__tests__/get-child-profile.test.ts`) — the reader.
- `apps/portal/src/features/setu/members/child-profile-view.tsx` (+ `__tests__/child-profile-view.test.tsx`) — the shared presentational component (content-only; pages own the responsive shells).
- `apps/portal/src/app/family/members/[mid]/profile/page.tsx` — family page.
- `apps/portal/src/app/api/setu/members/[mid]/profile/route.ts` (+ `__tests__/route.test.ts`) — mobile API.
- `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx` — welcome page.

**Modify:**
- `packages/shared-domain/src/auth/can-access-route.ts` (+ `__tests__`) — a `/profile` rule.
- `apps/portal/src/app/family/members/[mid]/page.tsx` — "View profile" button.
- `apps/portal/src/app/family/members/page.tsx` — "View profile" per member.
- `apps/portal/src/app/family/page.tsx` — dashboard My-family card links to profiles.
- `apps/portal/src/app/welcome/family/[fid]/page.tsx` — "View profile" per member row.

---

## Task 1: `getChildProfile(mid)` reader

**Files:** create `apps/portal/src/features/setu/members/get-child-profile.ts` + `__tests__/get-child-profile.test.ts`.

- [ ] **Step 1 — failing test.** Mock `./get-family-by-fid` (`getFamilyByFid`), `@/features/setu/enrollment/get-enrollments` (`getEnrollments`), `@/features/setu/programs/get-programs` (`listPrograms`), `@/features/setu/teacher/get-attendance` (`getAttendanceForMember`, and re-export the REAL `summarize` — `vi.importActual`), `@/features/setu/attendance/check-in-attendance` (`getCheckInAttendance`, and the REAL `summarizeMemberCheckIns`), and `@/lib/toronto-date` (`isoToTorontoDateInput` → identity-ish `(iso) => iso.slice(0,10)`). Assert:
  - `getChildProfile('CMT-FAM1-09')` → `null` when `getFamilyByFid` returns null; `null` when the member isn't in the family.
  - **N=3:** a child (`mid: 'CMT-FAM1-03'`) in THREE active enrollments — a `teacher`-mode program (oid `o-tabla`, 2 records present+absent), a `check-in`-mode program (Bala Vihar, member has `legacySid: 'S9'`), and a `none`-mode program — yields `programs.length === 3` with: the teacher program's attendance matched by `record.pid === 'o-tabla'` (attended/total/pct correct, `marks` ascending), the check-in program's attendance from `summarizeMemberCheckIns`, and the none program `{ mode: 'none', available: false }`.
  - a `check-in` program when `member.legacySid` is null → `{ mode: 'check-in', available: false, note: <non-empty string> }`.
  - a `cancelled` enrollment lands in `pastPrograms`, not `programs`.
  - `stats.overallAttendedPct` is the BLENDED `sumAttended / sumTotal` across attendance-available active programs (test two completed-attendance programs to prove it's a sum, not the first).

- [ ] **Step 2 — confirm RED.**
- [ ] **Step 3 — implement** (`get-child-profile.ts`):
```ts
import type { ProgramDoc } from '@cmt/shared-domain';
import { getFamilyByFid } from './get-family-by-fid';
import { getEnrollments, type EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getAttendanceForMember, summarize } from '@/features/setu/teacher/get-attendance';
import { getCheckInAttendance, summarizeMemberCheckIns } from '@/features/setu/attendance/check-in-attendance';
import { isoToTorontoDateInput } from '@/lib/toronto-date';

export interface ChildProgramAttendance {
  mode: 'teacher' | 'check-in' | 'none';
  available: boolean;          // false for 'none' or an unlinked check-in member
  attended: number;
  total: number;
  attendedPct: number;
  marks: { date: string; present: boolean }[];   // ascending by date
  note: string | null;         // e.g. "not linked yet"
}

export interface ChildProfileProgram {
  eid: string;
  programKey: string;
  label: string;
  term: string;
  location: string | null;
  status: 'active' | 'cancelled';
  attendance: ChildProgramAttendance;
}

export interface ChildProfile {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
  foodAllergies: string | null;
  programs: ChildProfileProgram[];      // active
  pastPrograms: ChildProfileProgram[];  // cancelled / ended
  stats: { programCount: number; overallAttendedPct: number; hasAnyAttendance: boolean };
}

const NO_ATTENDANCE: ChildProgramAttendance = {
  mode: 'none', available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: null,
};

/** Derive the fid from a mid (`${fid}-NN`). */
function fidFromMid(mid: string): string {
  const i = mid.lastIndexOf('-');
  return i > 0 ? mid.slice(0, i) : mid;
}

export async function getChildProfile(mid: string): Promise<ChildProfile | null> {
  const fid = fidFromMid(mid);
  const fam = await getFamilyByFid(fid);
  if (!fam) return null;
  const member = fam.members.find((m) => m.mid === mid);
  if (!member) return null;

  const [enrollments, programs, memberRecords, checkIns] = await Promise.all([
    getEnrollments(fid),
    listPrograms(),
    getAttendanceForMember(mid),
    getCheckInAttendance(fam.family.legacyFid),
  ]);
  const programByKey = new Map<string, ProgramDoc>(programs.map((p) => [p.programKey, p]));
  const mine = enrollments.filter((e) => e.enrolledMids.includes(mid));

  function buildAttendance(e: EnrollmentWithOffering): ChildProgramAttendance {
    const mode = programByKey.get(e.programKey)?.capabilities.attendanceMode ?? 'none';
    if (mode === 'teacher') {
      // attendanceEvents store the offering id in `pid` → match by enrollment.oid.
      const recs = memberRecords.filter((r) => r.pid === e.oid);
      const s = summarize(recs);
      const marks = recs.slice().reverse().map((r) => ({ date: r.date, present: r.status !== 'absent' }));
      return { mode, available: true, attended: s.present + s.late, total: s.total, attendedPct: s.attendedPct, marks, note: null };
    }
    if (mode === 'check-in') {
      if (!member!.legacySid) {
        return { mode, available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: "Attendance isn't linked for this member yet." };
      }
      const off = e.offering;
      const scoped = off
        ? checkIns.filter((r) => {
            const start = isoToTorontoDateInput(off.startDate.toISOString());
            const end = off.endDate ? isoToTorontoDateInput(off.endDate.toISOString()) : '9999-12-31';
            return r.date >= start && r.date <= end;
          })
        : checkIns;
      const s = summarizeMemberCheckIns(scoped, member!.legacySid);
      const attendedPct = s.recorded > 0 ? Math.round((s.attended / s.recorded) * 100) : 0;
      return { mode, available: true, attended: s.attended, total: s.recorded, attendedPct, marks: s.marks, note: null };
    }
    return NO_ATTENDANCE;
  }

  const toProgram = (e: EnrollmentWithOffering): ChildProfileProgram => ({
    eid: e.eid, programKey: e.programKey, label: e.programLabel, term: e.termLabel,
    location: e.location, status: e.status,
    attendance: e.status === 'active' ? buildAttendance(e) : NO_ATTENDANCE,
  });

  const activePrograms = mine.filter((e) => e.status === 'active').map(toProgram);
  const pastPrograms = mine.filter((e) => e.status !== 'active').map(toProgram);

  const withAtt = activePrograms.filter((p) => p.attendance.available);
  const sumAttended = withAtt.reduce((acc, p) => acc + p.attendance.attended, 0);
  const sumTotal = withAtt.reduce((acc, p) => acc + p.attendance.total, 0);
  const overallAttendedPct = sumTotal > 0 ? Math.round((sumAttended / sumTotal) * 100) : 0;

  return {
    mid, fid,
    firstName: member.firstName, lastName: member.lastName, type: member.type,
    schoolGrade: member.schoolGrade ?? null, birthMonthYear: member.birthMonthYear ?? null,
    foodAllergies: member.foodAllergies ?? null,
    programs: activePrograms, pastPrograms,
    stats: { programCount: activePrograms.length, overallAttendedPct, hasAnyAttendance: sumTotal > 0 },
  };
}
```

- [ ] **Step 4 — run + `pnpm --filter @cmt/portal exec tsc --noEmit` → green. Step 5 — commit:** `feat(child-profile): getChildProfile reader (enrollments + per-program attendance)`.

---

## Task 2: `<ChildProfileView>` shared component

**Files:** create `apps/portal/src/features/setu/members/child-profile-view.tsx` + `__tests__/child-profile-view.test.tsx`.

Content-only (NO `'use client'`, no responsive wrappers, no `CspRoot` — the pages own those). Props:
```ts
import type { ChildProfile } from './get-child-profile';
interface ChildProfileViewProps {
  profile: ChildProfile;
  editHref?: string;   // family context passes it ("Edit details"); welcome omits it
}
export function ChildProfileView({ profile, editHref }: ChildProfileViewProps) { ... }
```

- [ ] **Step 1 — component test** (`@testing-library/react`; mock `@cmt/ui` `SetuIcon`/`SetuAvatar` as stub glyphs; import `next/link` works in jsdom as `<a>`). Assert with a fixture child in 3 programs (teacher 9/10, check-in 18/20, none):
  - renders the name, `Child · Grade 5` (type + grade), the quick-stats ("3 programs", overall %);
  - renders ALL THREE program labels (N=3) with their term + status;
  - the teacher + check-in programs show `{attended} of {total}` and a `{pct}%`; the heatmap renders one cell per mark (query by a stable testid or count the cells);
  - the `none` program shows "No attendance for this program" (no heatmap);
  - a check-in program with `note` set renders the note text instead of figures;
  - `editHref` provided → an "Edit details" link with that href; omitted → no such link;
  - `programs: []` → a "not enrolled in any programs yet" empty state with an Enroll CTA link to `/family/enroll`;
  - `pastPrograms` non-empty → a "Past programs" section (a `<details>`/`<summary>` is fine) listing them.

- [ ] **Step 2 — confirm RED.**
- [ ] **Step 3 — implement** `child-profile-view.tsx` (themed, Cool-Mist tokens; mirror the member page + the teacher heatmap). Structure:
  - **Header:** `SetuAvatar` + name + a `Child · {schoolGrade}` / `Adult` sub-line + `MID {mid}` (mono); an `AllergyCallout` (from atoms) when `foodAllergies`; a quick-stats line — `{programCount} program(s) · {overallAttendedPct}% attendance` (omit the % when `!stats.hasAnyAttendance`).
  - **Programs** (`SectionLabel` "Programs"): one `card` per `profile.programs`: title = `label`, a meta line `term · location` + a status `pill`; then the attendance block:
    - `available && total > 0`: `"{attended} of {total} · {attendedPct}%"` + a marks heatmap (a flex-wrap of small rounded cells; `present` → `var(--accent)` (slightly translucent), `!present` → `var(--err)`; reuse the teacher view's heatmap idiom).
    - `available && total === 0`: a muted "No classes recorded yet."
    - `!available && note`: the `note` text (muted).
    - `mode === 'none'`: a muted "No attendance for this program."
  - **Empty state** (`profile.programs.length === 0`): a warm branded card "Not enrolled in any programs yet" + a `btn btn--s` link to `/family/enroll`.
  - **Past programs** (`profile.pastPrograms.length > 0`): a `<details>` with `<summary>` "Past programs ({n})" listing each as a muted row (label · term · "Ended"). No attendance block.
  - **Footer:** when `editHref`, a `btn btn--s` link to it ("Edit details").
  - NO nested component declarations (use small render-helper functions if needed). Keep it tidy — the controller runs a designer pass next.

- [ ] **Step 4 — run the component test + `tsc --noEmit` + `eslint` on the file → green. Step 5 — commit:** `feat(child-profile): shared <ChildProfileView> component`.

---

## Task 3: Family profile page + family-side entry points

**Files:** create `apps/portal/src/app/family/members/[mid]/profile/page.tsx`; modify `apps/portal/src/app/family/members/[mid]/page.tsx`, `apps/portal/src/app/family/members/page.tsx`, `apps/portal/src/app/family/page.tsx`.

- [ ] **Step 1 — family page** `app/family/members/[mid]/profile/page.tsx` (own-family enforced):
```tsx
import { connection } from 'next/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getChildProfile } from '@/features/setu/members/get-child-profile';
import { ChildProfileView } from '@/features/setu/members/child-profile-view';

export const metadata = { title: 'Profile — CMT Portal' };

export default async function FamilyMemberProfilePage({ params }: { params: Promise<{ mid: string }> }) {
  await connection();
  const { mid } = await params;
  const data = await getCurrentFamily();
  if (!data) redirect(`/sign-in?from=/family/members/${mid}/profile`);
  if (!data.members.some((m) => m.mid === mid)) notFound();   // own-family only
  const profile = await getChildProfile(mid);
  if (!profile) notFound();
  const canEdit = data.isManager || mid === data.currentMid;
  const view = <ChildProfileView profile={profile} {...(canEdit ? { editHref: `/family/members/${mid}/edit` } : {})} />;
  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href={`/family/members/${mid}`} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}><SetuIcon.back /></Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Profile</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 90px' }}>{view}</div>
          </div>
        </CspRoot>
      </div>
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        <Link href={`/family/members/${mid}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 16 }}><SetuIcon.back /> Back to member</Link>
        {view}
      </div>
    </>
  );
}
```
(Note the conditional-spread of `editHref` — `exactOptionalPropertyTypes` forbids `editHref={undefined}`.)

- [ ] **Step 2 — entry points.**
  - `app/family/members/[mid]/page.tsx`: add a **"View profile"** link to `/family/members/${mid}/profile` — in the mobile header (next to/with Edit) AND the desktop header action area, and a primary affordance near the top of the body (e.g. a `btn btn--s` under the name). Available to anyone in the family (not just `canEdit`).
  - `app/family/members/page.tsx`: read the file; add a **"View profile"** affordance to each member row/card linking to `/family/members/${m.mid}/profile` (match the file's existing row pattern; if rows already link to the detail page, add a secondary "Profile" link/icon).
  - `app/family/page.tsx`: in the **My family** card (mobile ~296-309 and desktop equivalent), wrap each member avatar/name in a `Link` to `/family/members/${mid}/profile`. The dashboard currently maps `displayMembers` as `{ name }`; extend it to also carry `mid` (from `data.members.map((m) => ({ name, mid: m.mid }))`) so the link can be built. Keep the mock/non-setuAuth path working (no link when there's no real mid).

- [ ] **Step 3 — run touched tests (`app/family/__tests__` if any) + `tsc --noEmit` + `eslint` on touched files → green.** If a dashboard test asserts the My-family markup, update it minimally.
- [ ] **Step 4 — commit:** `feat(child-profile): family profile page + view-profile entry points`.

---

## Task 4: Mobile API + canAccessRoute

**Files:** create `apps/portal/src/app/api/setu/members/[mid]/profile/route.ts` + `__tests__/route.test.ts`; modify `packages/shared-domain/src/auth/can-access-route.ts` + `__tests__`.

- [ ] **Step 1 — canAccessRoute test** (add to `packages/shared-domain/src/__tests__/can-access-route.test.ts`, reusing existing claim fixtures):
```ts
it('allows the member profile API for any setu family OR welcome-team', () => {
  expect(canAccessRoute(<familyMember>, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
  expect(canAccessRoute(<welcomeTeam>, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
  expect(canAccessRoute(<admin>, '/api/setu/members/CMT-FAM1-03/profile', 'GET')).toBe(true);
});
it('still denies welcome-team on non-profile member GETs', () => {
  expect(canAccessRoute(<welcomeTeam>, '/api/setu/members/CMT-FAM1-03', 'GET')).toBe(false);
});
```

- [ ] **Step 2 — confirm RED; Step 3 — implement** in `can-access-route.ts`, **immediately before** the existing `/api/setu/members` block:
```ts
  // Member profile read — any setu family (own-family enforced in the handler)
  // OR welcome-team/admin (front-desk family support). Must precede the
  // members rule below (which is isSetuFamily-only and would block welcome).
  if (pathname.startsWith('/api/setu/members/') && pathname.endsWith('/profile')) {
    return isSetuFamily(claims) || isWelcomeTeam(claims);
  }
```

- [ ] **Step 4 — route test** (`api/setu/members/[mid]/profile/__tests__/route.test.ts`): mock `@/features/setu/seva/...`? No — mock `@/features/setu/members/get-child-profile` (`getChildProfile`). `req(role, fid)` sets `x-portal-role`/`x-portal-fid`. `ctx = { params: Promise.resolve({ mid: 'CMT-FAM1-03' }) }`. Cases:
  - 401 no session;
  - 404 when `getChildProfile` → null;
  - **family own-family:** role `family-member` with `fid: 'CMT-FAM1'` + profile `{ fid: 'CMT-FAM1', ... }` → 200 returns the profile;
  - **family cross-family blocked:** role `family-member` `fid: 'CMT-OTHER'` + profile `{ fid: 'CMT-FAM1' }` → 404 (don't leak);
  - **welcome any-family:** role `welcome-team` `fid: null` + profile `{ fid: 'CMT-FAM1' }` → 200.

- [ ] **Step 5 — implement** `route.ts`:
```ts
import { NextResponse } from 'next/server';
import { isSetuFamily, isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getChildProfile } from '@/features/setu/members/get-child-profile';

type RouteContext = { params: Promise<{ mid: string }> };

export async function GET(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const { mid } = await ctx.params;
  const profile = await getChildProfile(mid);
  if (!profile) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  // Welcome/admin may read any family's child; a setu family only its own.
  const allowed = isWelcomeTeam(session) || (isSetuFamily(session) && profile.fid === session.fid);
  if (!allowed) return NextResponse.json({ error: 'not-found' }, { status: 404 }); // don't leak existence
  return NextResponse.json({ profile });
}
```

- [ ] **Step 6 — run both suites + both `tsc --noEmit` (portal + shared-domain) → green. Step 7 — commit:** `feat(child-profile): mobile profile API + canAccessRoute /profile rule`.

---

## Task 5: Welcome profile page + entry point

**Files:** create `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx`; modify `apps/portal/src/app/welcome/family/[fid]/page.tsx`.

- [ ] **Step 1 — welcome page** `app/welcome/family/[fid]/members/[mid]/page.tsx` — mirror `app/welcome/family/[fid]/page.tsx` (thin `<Suspense>` + an exported body; `await connection()`; defensive `isWelcomeTeam` re-check via `cookies()` → `verifyPortalSessionCookie`; Access-denied fallback). Then:
```tsx
  const { fid, mid } = await params;
  const profile = await getChildProfile(mid);
  if (!profile || profile.fid !== fid) notFound();   // mid must belong to the route's fid
  const view = <ChildProfileView profile={profile} />;  // no editHref (read-only)
```
Render `view` in a mobile (`block md:hidden`, `CspRoot`, header bar with `SetuIcon.back` → `/welcome/family/${fid}`, scroll area) + desktop (`hidden md:block`, maxWidth 760, a back link to `/welcome/family/${fid}`) split — exactly the shells used in `app/welcome/seva/[oppId]/page.tsx`. `export const metadata = { title: 'Profile — CMT Portal' }`.

- [ ] **Step 2 — entry point.** In `app/welcome/family/[fid]/page.tsx`'s `MemberRow` (or the member list), add a **"View profile"** `next/link` to `/welcome/family/${family.fid}/members/${m.mid}` (the row currently isn't a link). `MemberRow` doesn't receive `fid` today — thread `family.fid` into it (or build the row inside `FamilyDetailBody` which has `family`). Keep it token-safe: the desktop branch is inside the welcome layout `CspRoot`, but use the same inline-styled link idiom already in that file (it uses inline styles, not `.btn`, in places) to be safe.

- [ ] **Step 3 — run any welcome family-detail test (`app/welcome/family/[fid]/__tests__`) + `tsc --noEmit` + `eslint` → green.** Update the family-detail test if it asserts the member-row markup.
- [ ] **Step 4 — commit:** `feat(child-profile): welcome/admin profile page + entry point`.

---

## Task 6 (controller): designer pass on `<ChildProfileView>`
After Tasks 1-5 are green, the CONTROLLER dispatches `oh-my-claudecode:designer` (opus) to elevate `child-profile-view.tsx` ONLY (it's shared by both pages, so one pass improves both): a polished identity header, program cards with a satisfying attendance treatment + heatmap, the per-program empty/none/not-linked states, quick stats, the past-programs disclosure, and an excellent mobile experience at 375px — WITHOUT changing props, the `ChildProfile` contract, exported names, or test-queried text/labels. Re-run the component test + `tsc` + `eslint`. Commit `style(child-profile): polish the child profile view`.

## Slice 1 verification (before done)
- [ ] `tsc --noEmit` (portal + shared-domain) → 0; `pnpm lint` clean; full vitest suites green; `pnpm build` green (watch the new `/family/members/[mid]/profile`, `/welcome/family/[fid]/members/[mid]`, and the `/api/.../profile` route prerender).
- [ ] **Mobile-app readiness:** the profile API uses `readSessionFromHeaders` + the helper gate (grep: no `cookies()`/`getCurrentFamily()` in the handler); JSON, plain values.
- [ ] **No new Firestore index** (confirm `getChildProfile` introduced no two-field `where`/`orderBy`).
- [ ] **N=3 + own-family + cross-family** all covered by tests; the reader sums attendance across programs (not first).
- [ ] Final review pass (spec-compliance + code-quality, Opus) over the whole slice.
- [ ] **Mock-free UAT walkthrough:** as a family with multiple children → open each child's profile (mobile + desktop) → see all their programs + per-program attendance; as welcome-team → `/welcome/family/[fid]` → "View profile" on a member → same view (read-only); confirm a family cannot open another family's child profile (404). Report UAT status explicitly (OTP sign-in may block the agent — flag for CMT Developer).
- [ ] Push (full gate). Update the resume-note memory: child-profile Slice 1 shipped; Slice 2 (achievements) remains.

## Not in Slice 1 (Slice 2)
- Achievements: `AchievementDoc` schema + `achievements` subcollection; teacher/admin award/revoke (roster-checked) on `/teacher/students/[mid]`; the read-only badge section folded into `getChildProfile` + `<ChildProfileView>`.

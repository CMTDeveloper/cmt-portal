# Child Profile — Slice 2 (achievements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Teachers/admins **award and revoke badges** ("achievements") to a student from `/teacher/students/[mid]`; the badges appear **read-only** on the child profile wherever it renders (family own-family AND welcome/admin) and in the mobile profile API — folded into the existing `getChildProfile` contract.

**Architecture:** A new co-located subcollection `families/{fid}/members/{mid}/achievements/{achId}`. One narrow reader `getMemberAchievements(fid, mid)` serves both `getChildProfile` (so badges flow to both profile pages + the API automatically) and the teacher page (which uses `getStudentDetail`). Writes go through two mobile-ready, teacher-gated routes (`POST /api/setu/teacher/achievements`, `DELETE /api/setu/teacher/achievements/[achId]`) both roster-checked via the existing `canTeacherSeeStudent`. A `'use client'` island on the teacher page does the award/revoke + `router.refresh()`. The read-only display is a chip strip added to the shared `<ChildProfileView>`.

**Tech Stack / conventions:** Next.js 16 App Router, Cache Components (`await connection()` on pages touching Firebase Admin), Vitest + Testing Library, `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`. Spec: `docs/superpowers/specs/2026-06-06-child-profile-design.md`.

## Cross-cutting (hard rules — do not skip)
- **Mobile-app readiness:** both teacher routes derive identity via `readSessionFromHeaders(req)` (cookie OR Bearer); NEVER `cookies()`/`getCurrentFamily()` in a handler. JSON, ISO/plain values, `{ ... }`/`{ error }` envelope, shared `@cmt/shared-domain` Zod schema (`AwardAchievementSchema`). The profile API already returns the assembled profile JSON — achievements ride along because they're folded into `getChildProfile`.
- **On-theme UX:** Cool-Mist tokens, `CspRoot`/`.csp` scoping. The teacher page + the profile view both render inside a `CspRoot`, so `.pill`/`.card`/`.btn` class tokens resolve — use them. Real responsive behaviour (the award form + chip strip must work at ~375px). Designer pass on the new surfaces (Task 7).
- **Role checks via helpers** (`isTeacher`, `isAdmin` — admin inherits teacher), never strict equality. Roster gate via `canTeacherSeeStudent(session, mid)` (admin short-circuits true) for BOTH award and revoke.
- **No new Firestore index:** the achievements query is a single-collection `orderBy('awardedAt','desc')` on `families/{fid}/members/{mid}/achievements` — a single-field order needs no composite index. Do NOT use a `collectionGroup` query here (that WOULD need an index). Reader is a plain async function (NOT `'use cache'`) so award/revoke reflect immediately on the next render; the client island calls `router.refresh()`.
- **No canAccessRoute change:** the existing `/api/setu/teacher/` catch-all (`can-access-route.ts:49`, `isTeacher`) already authorizes `POST/DELETE /api/setu/teacher/achievements*`; the profile-read rule already authorizes the profile API. We ADD a confirming assertion test (Task 4) but change no rule.

## Key data facts (verified — build on these)
- **Schema convention** (`packages/shared-domain/src/setu/schemas/seva.ts`): a `...DocSchema` (stored shape, `Date` fields are `z.date()`) + inferred `...Doc` type; a `Create...Schema` (API input, dates as ISO `z.string()`) + inferred `...Input`. Barrel: add the new file to `packages/shared-domain/src/setu/index.ts` (which `src/index.ts` re-exports as `./setu`).
- **`canTeacherSeeStudent(session, mid): Promise<boolean>`** (`apps/portal/src/features/setu/teacher/student-detail.ts:41`): admin → true; else true iff `mid` is on the roster of a level the teacher teaches.
- **`getStudentDetail(mid): Promise<StudentDetail | null>`** (`student-detail.ts:55`) returns `{ mid, fid, firstName, lastName, type, schoolGrade, foodAllergies, emergencyContacts, parents, summary, records }`. The teacher page (`app/teacher/students/[mid]/page.tsx`) is a **server component**, auth = `cookies()` → `verifyPortalSessionCookie` → `canTeacherSeeStudent`. Its shell (`maxWidth:760`, padding) lives in `app/teacher/layout.tsx` inside a `CspRoot`.
- **`getEnrollments(fid): Promise<EnrollmentWithOffering[]>`** (`@/features/setu/enrollment/get-enrollments`): each has `programKey`, `programLabel`, `status: 'active'|'cancelled'`, `enrolledMids: string[]`.
- **Firestore write idiom** (`enroll-family.ts`, `welcome/seva/opportunities/route.ts`): `portalFirestore().collection('families').doc(fid).collection('members').doc(mid).collection('achievements').doc(achId)`; ids via `randomUUID()` from `node:crypto`; `FieldValue.serverTimestamp()`; both from `@cmt/firebase-shared/admin/firestore`.
- **`readSessionFromHeaders(req)`** (`@/lib/auth/headers`) → `{ uid, role, extraRoles, fid, mid } | null`.
- **Client island idiom** (`features/setu/teacher/components/attendance-marker.tsx`): `'use client'`, `useState` + `useTransition`, `fetch(...,{method,headers:{'Content-Type':'application/json'},body})`, `toast` from `@cmt/ui`. Add `useRouter` from `next/navigation` for `router.refresh()`.
- **Route test idiom** (`app/api/setu/teacher/attendance/__tests__/route.test.ts`): `vi.hoisted` + `vi.mock` the FEATURE functions (not Firestore); a `req(role, body, mid)` helper sets `x-portal-role`/`x-portal-uid`/`x-portal-mid`; dynamic `const { POST } = await import('../route')` inside each `it`.
- **`ChildProfile`** (`get-child-profile.ts`) is plain-JSON (no `Date`s). Slice 2 adds `achievements: ChildAchievement[]` (with `awardedAt` as an **ISO string**).

## Design decisions (locked for this slice)
- **`awardedByName` is stored but not displayed in v1** (session headers carry no display name; resolving it is an extra read). Store `null` from the route; the chip strip shows title + optional program + date, never "by whom". The field stays in the schema for audit/mobile/future.
- **`programKey` IS surfaced in the award form** via a dropdown seeded from the student's *active* enrollments (`getEnrollments` filtered by mid, deduped by key) plus a "General (no program)" option — so a badge can be tied to "Bala Vihar" etc. without free-text key typos.
- **Revoke gate = `canTeacherSeeStudent`** (any teacher who can see the student, or an admin), matching spec §"Access & security" line 92 — not awarder-only. Small-org co-teachers manage their class's badges together.
- **No `revalidateTag`** for achievements — the reader is uncached and the profile pages are dynamic (`await connection()`); the teacher island uses `router.refresh()`. (Do not add a tag implying a cache that isn't there.)

---

## File structure
**Create:**
- `packages/shared-domain/src/setu/schemas/achievement.ts` (+ `__tests__/achievement.test.ts`) — `AchievementDoc` + `AwardAchievementSchema`.
- `apps/portal/src/features/setu/members/mid.ts` — extracted `fidFromMid` (shared by reader + routes).
- `apps/portal/src/features/setu/members/get-achievements.ts` (+ `__tests__/get-achievements.test.ts`) — `ChildAchievement` + `getMemberAchievements`.
- `apps/portal/src/features/setu/teacher/award-achievement.ts` (+ `__tests__/award-achievement.test.ts`) — `awardAchievement` + `revokeAchievement`.
- `apps/portal/src/app/api/setu/teacher/achievements/route.ts` (+ `__tests__/route.test.ts`) — POST.
- `apps/portal/src/app/api/setu/teacher/achievements/[achId]/route.ts` (+ `__tests__/route.test.ts`) — DELETE.
- `apps/portal/src/features/setu/teacher/components/award-badge.tsx` (+ `__tests__/award-badge.test.tsx`) — client island.

**Modify:**
- `packages/shared-domain/src/setu/index.ts` — `export * from './schemas/achievement';`.
- `apps/portal/src/features/setu/members/get-child-profile.ts` — import `fidFromMid` from `./mid`; fold `getMemberAchievements` into the read; add `achievements` to `ChildProfile`; re-export `ChildAchievement`. Update `__tests__/get-child-profile.test.ts`.
- `apps/portal/src/features/setu/members/child-profile-view.tsx` — read-only Achievements chip strip. Update `__tests__/child-profile-view.test.tsx` (add `achievements: []` to the fixture + a present-achievements case).
- `apps/portal/src/app/teacher/students/[mid]/page.tsx` — load achievements + program options; render the `<AwardBadge>` island.
- `packages/shared-domain/src/__tests__/can-access-route.test.ts` — confirming assertions (no rule change).

---

## Task 1: `AchievementDoc` schema + barrel export

**Files:** create `packages/shared-domain/src/setu/schemas/achievement.ts` + `__tests__/achievement.test.ts`; modify `packages/shared-domain/src/setu/index.ts`.

- [ ] **Step 1 — failing test** (`packages/shared-domain/src/setu/schemas/__tests__/achievement.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { AwardAchievementSchema, AchievementDocSchema } from '../achievement';

describe('AwardAchievementSchema', () => {
  it('accepts a minimal valid award and defaults programKey to null', () => {
    const r = AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: '  Om Award  ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe('Om Award');     // trimmed
      expect(r.data.programKey).toBe(null);       // default
    }
  });
  it('accepts an optional description + programKey', () => {
    const r = AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: 'Gita L2', description: 'Recited ch. 12', programKey: 'bala-vihar' });
    expect(r.success).toBe(true);
  });
  it('rejects an empty title', () => {
    expect(AwardAchievementSchema.safeParse({ mid: 'CMT-F1-02', title: '   ' }).success).toBe(false);
  });
  it('rejects a missing mid', () => {
    expect(AwardAchievementSchema.safeParse({ title: 'X' }).success).toBe(false);
  });
});

describe('AchievementDocSchema', () => {
  it('validates a stored doc with a Date awardedAt', () => {
    const r = AchievementDocSchema.safeParse({
      achId: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award',
      description: null, programKey: null, awardedByUid: 'u1', awardedByName: null,
      awardedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2 — confirm RED** (run `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/achievement.test.ts`).
- [ ] **Step 3 — implement** `packages/shared-domain/src/setu/schemas/achievement.ts`:
```ts
import { z } from 'zod';

export const AchievementDocSchema = z.object({
  achId: z.string().min(1),
  mid: z.string().min(1),
  fid: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  programKey: z.string().nullable(),
  awardedByUid: z.string().min(1),
  awardedByName: z.string().nullable(),
  awardedAt: z.date(),
});
export type AchievementDoc = z.infer<typeof AchievementDocSchema>;

// API input for POST /api/setu/teacher/achievements. The server stamps
// achId/awardedBy*/awardedAt; the client supplies the rest.
export const AwardAchievementSchema = z.object({
  mid: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  programKey: z.string().trim().min(1).max(60).nullable().optional().default(null),
});
export type AwardAchievementInput = z.infer<typeof AwardAchievementSchema>;
```

- [ ] **Step 4 — add barrel export** in `packages/shared-domain/src/setu/index.ts` after the `seva` line:
```ts
export * from './schemas/achievement';
```

- [ ] **Step 5 — run the schema test + `pnpm --filter @cmt/shared-domain exec tsc --noEmit` → green. Step 6 — commit:** `feat(child-profile): AchievementDoc + AwardAchievementSchema in shared-domain`.

---

## Task 2: `fidFromMid` extraction + `getMemberAchievements` reader + fold into `getChildProfile`

**Files:** create `apps/portal/src/features/setu/members/mid.ts`, `apps/portal/src/features/setu/members/get-achievements.ts` (+ `__tests__/get-achievements.test.ts`); modify `apps/portal/src/features/setu/members/get-child-profile.ts` + its test.

- [ ] **Step 1 — extract `fidFromMid`.** Create `apps/portal/src/features/setu/members/mid.ts`:
```ts
/** Derive the fid from a mid (`${fid}-NN`). */
export function fidFromMid(mid: string): string {
  const i = mid.lastIndexOf('-');
  return i > 0 ? mid.slice(0, i) : mid;
}
```
In `get-child-profile.ts`, REMOVE the local `fidFromMid` function and import it: `import { fidFromMid } from './mid';` (keep all other behaviour identical).

- [ ] **Step 2 — failing reader test** (`apps/portal/src/features/setu/members/__tests__/get-achievements.test.ts`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const chain: Record<string, unknown> = {};
  chain.collection = vi.fn(() => chain);
  chain.doc = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.get = mockGet;
  return { portalFirestore: () => chain, FieldValue: { serverTimestamp: () => 'ts' } };
});

import { getMemberAchievements } from '../get-achievements';

beforeEach(() => { mockGet.mockReset(); });

it('maps docs to ChildAchievement[] with awardedAt as ISO', async () => {
  mockGet.mockResolvedValue({
    docs: [
      { data: () => ({ achId: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award', description: 'Nice', programKey: 'bala-vihar', awardedByName: null, awardedAt: { toDate: () => new Date('2026-05-01T00:00:00Z') } }) },
      { data: () => ({ achId: 'a2', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Gita L2', description: null, programKey: null, awardedByName: 'Acharya', awardedAt: { toDate: () => new Date('2026-04-01T00:00:00Z') } }) },
    ],
  });
  const out = await getMemberAchievements('CMT-F1', 'CMT-F1-02');
  expect(out).toEqual([
    { achId: 'a1', title: 'Om Award', description: 'Nice', programKey: 'bala-vihar', awardedByName: null, awardedAt: '2026-05-01T00:00:00.000Z' },
    { achId: 'a2', title: 'Gita L2', description: null, programKey: null, awardedByName: 'Acharya', awardedAt: '2026-04-01T00:00:00.000Z' },
  ]);
});

it('returns [] when there are no achievements', async () => {
  mockGet.mockResolvedValue({ docs: [] });
  expect(await getMemberAchievements('CMT-F1', 'CMT-F1-02')).toEqual([]);
});
```

- [ ] **Step 3 — confirm RED; Step 4 — implement** `apps/portal/src/features/setu/members/get-achievements.ts`:
```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

/** Serialized (plain-JSON) achievement for the child profile + teacher view. */
export interface ChildAchievement {
  achId: string;
  title: string;
  description: string | null;
  programKey: string | null;
  awardedByName: string | null;
  awardedAt: string; // ISO
}

/**
 * Read a member's achievements (newest first). Plain async (NOT 'use cache')
 * so an award/revoke reflects on the next render. Single-field orderBy on the
 * achievements subcollection — no composite index required.
 */
export async function getMemberAchievements(fid: string, mid: string): Promise<ChildAchievement[]> {
  const snap = await portalFirestore()
    .collection('families').doc(fid)
    .collection('members').doc(mid)
    .collection('achievements')
    .orderBy('awardedAt', 'desc')
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      achId: x.achId,
      title: x.title,
      description: x.description ?? null,
      programKey: x.programKey ?? null,
      awardedByName: x.awardedByName ?? null,
      awardedAt: x.awardedAt?.toDate ? x.awardedAt.toDate().toISOString() : new Date(0).toISOString(),
    };
  });
}
```

- [ ] **Step 5 — fold into `getChildProfile`.** In `get-child-profile.ts`:
  - add `import { getMemberAchievements, type ChildAchievement } from './get-achievements';`
  - re-export the type for the view: `export type { ChildAchievement } from './get-achievements';`
  - add `achievements: ChildAchievement[];` to the `ChildProfile` interface (after `pastPrograms`).
  - add `getMemberAchievements(fid, mid)` as a 5th promise in the existing `Promise.all` (capture as `achievements`).
  - include `achievements,` in the returned object.

- [ ] **Step 6 — update `get-child-profile.test.ts`.** Add `vi.mock('../get-achievements', () => ({ getMemberAchievements: vi.fn(async () => []) }))` (with a hoisted spy so a case can override it). Add a case: when `getMemberAchievements` resolves two achievements, `profile.achievements` has length 2 and passes them through unchanged; default case asserts `profile.achievements` is `[]`. Keep all existing N=3 / attendance assertions intact.

- [ ] **Step 7 — run both portal reader suites + `pnpm --filter @cmt/portal exec tsc --noEmit` → green. Step 8 — commit:** `feat(child-profile): getMemberAchievements reader, folded into getChildProfile`.

---

## Task 3: writer — `awardAchievement` + `revokeAchievement`

**Files:** create `apps/portal/src/features/setu/teacher/award-achievement.ts` + `__tests__/award-achievement.test.ts`.

- [ ] **Step 1 — failing test** (`apps/portal/src/features/setu/teacher/__tests__/award-achievement.test.ts`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockGet, mockDelete, refSpy } = vi.hoisted(() => ({
  mockSet: vi.fn(), mockGet: vi.fn(), mockDelete: vi.fn(), refSpy: vi.fn(),
}));
vi.mock('node:crypto', () => ({ randomUUID: () => 'ach-uuid' }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const chain: Record<string, unknown> = {};
  chain.collection = vi.fn(() => chain);
  chain.doc = vi.fn((id?: string) => { if (id) refSpy(id); return chain; });
  chain.set = mockSet; chain.get = mockGet; chain.delete = mockDelete;
  return { portalFirestore: () => chain, FieldValue: { serverTimestamp: () => 'TS' } };
});

import { awardAchievement, revokeAchievement } from '../award-achievement';

beforeEach(() => { mockSet.mockReset(); mockGet.mockReset(); mockDelete.mockReset(); refSpy.mockReset(); });

describe('awardAchievement', () => {
  it('writes a doc with a generated achId, serverTimestamp, and the given fields', async () => {
    mockSet.mockResolvedValue(undefined);
    const out = await awardAchievement({
      fid: 'CMT-F1', mid: 'CMT-F1-02', title: 'Om Award', description: null,
      programKey: 'bala-vihar', awardedByUid: 'u-teacher', awardedByName: null,
    });
    expect(out).toEqual({ achId: 'ach-uuid' });
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      achId: 'ach-uuid', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award',
      description: null, programKey: 'bala-vihar', awardedByUid: 'u-teacher',
      awardedByName: null, awardedAt: 'TS',
    }));
  });
});

describe('revokeAchievement', () => {
  it('deletes when the doc exists → true', async () => {
    mockGet.mockResolvedValue({ exists: true });
    mockDelete.mockResolvedValue(undefined);
    expect(await revokeAchievement('CMT-F1', 'CMT-F1-02', 'ach-uuid')).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
  });
  it('returns false and does not delete when the doc is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await revokeAchievement('CMT-F1', 'CMT-F1-02', 'nope')).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 — confirm RED; Step 3 — implement** `apps/portal/src/features/setu/teacher/award-achievement.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

interface AwardArgs {
  fid: string;
  mid: string;
  title: string;
  description: string | null;
  programKey: string | null;
  awardedByUid: string;
  awardedByName: string | null;
}

function achievementsRef(fid: string, mid: string) {
  return portalFirestore()
    .collection('families').doc(fid)
    .collection('members').doc(mid)
    .collection('achievements');
}

export async function awardAchievement(args: AwardArgs): Promise<{ achId: string }> {
  const achId = randomUUID();
  await achievementsRef(args.fid, args.mid).doc(achId).set({
    achId,
    mid: args.mid,
    fid: args.fid,
    title: args.title,
    description: args.description,
    programKey: args.programKey,
    awardedByUid: args.awardedByUid,
    awardedByName: args.awardedByName,
    awardedAt: FieldValue.serverTimestamp(),
  });
  return { achId };
}

export async function revokeAchievement(fid: string, mid: string, achId: string): Promise<boolean> {
  const ref = achievementsRef(fid, mid).doc(achId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}
```

- [ ] **Step 4 — run the writer test + `tsc --noEmit` → green. Step 5 — commit:** `feat(child-profile): awardAchievement + revokeAchievement writer`.

---

## Task 4: API routes (POST + DELETE) + canAccessRoute confirming test

**Files:** create `apps/portal/src/app/api/setu/teacher/achievements/route.ts` + `__tests__/route.test.ts` and `apps/portal/src/app/api/setu/teacher/achievements/[achId]/route.ts` + `__tests__/route.test.ts`; modify `packages/shared-domain/src/__tests__/can-access-route.test.ts`.

- [ ] **Step 1 — POST route test** (`.../achievements/__tests__/route.test.ts`, mirror the attendance route test):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanSee, mockAward } = vi.hoisted(() => ({ mockCanSee: vi.fn(), mockAward: vi.fn() }));
vi.mock('@/features/setu/teacher/student-detail', () => ({ canTeacherSeeStudent: mockCanSee }));
vi.mock('@/features/setu/teacher/award-achievement', () => ({ awardAchievement: mockAward }));

function req(role: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  return new Request('http://localhost/api/setu/teacher/achievements', { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const body = { mid: 'CMT-F1-02', title: 'Om Award', programKey: 'bala-vihar' };

beforeEach(() => { vi.clearAllMocks(); mockCanSee.mockResolvedValue(true); mockAward.mockResolvedValue({ achId: 'a1' }); });

it('403 for a non-teacher', async () => {
  const { POST } = await import('../route');
  expect((await POST(req('family-manager', body))).status).toBe(403);
  expect(mockAward).not.toHaveBeenCalled();
});
it('400 for a bad payload (empty title)', async () => {
  const { POST } = await import('../route');
  expect((await POST(req('teacher', { mid: 'CMT-F1-02', title: '  ' }))).status).toBe(400);
});
it('403 not-your-student when roster check fails (gate runs after parse)', async () => {
  mockCanSee.mockResolvedValue(false);
  const { POST } = await import('../route');
  expect((await POST(req('teacher', body))).status).toBe(403);
  expect(mockAward).not.toHaveBeenCalled();
});
it('201 awards with awardedByUid from session + null awardedByName', async () => {
  const { POST } = await import('../route');
  const res = await POST(req('teacher', body));
  expect(res.status).toBe(201);
  expect(mockAward).toHaveBeenCalledWith(expect.objectContaining({
    fid: 'CMT-F1', mid: 'CMT-F1-02', title: 'Om Award', programKey: 'bala-vihar',
    description: null, awardedByUid: 'uid-teacher', awardedByName: null,
  }));
  expect((await res.json()).achId).toBe('a1');
});
```

- [ ] **Step 2 — confirm RED; Step 3 — implement** `apps/portal/src/app/api/setu/teacher/achievements/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { isTeacher, AwardAchievementSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeacherSeeStudent } from '@/features/setu/teacher/student-detail';
import { awardAchievement } from '@/features/setu/teacher/award-achievement';
import { fidFromMid } from '@/features/setu/members/mid';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = AwardAchievementSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const { mid, title } = parsed.data;
  if (!(await canTeacherSeeStudent(session, mid))) {
    return NextResponse.json({ error: 'not-your-student' }, { status: 403 });
  }
  const { achId } = await awardAchievement({
    fid: fidFromMid(mid),
    mid,
    title,
    description: parsed.data.description ?? null,
    programKey: parsed.data.programKey ?? null,
    awardedByUid: session.uid,
    awardedByName: null,
  });
  return NextResponse.json({ achId }, { status: 201 });
}
```

- [ ] **Step 4 — DELETE route test** (`.../achievements/[achId]/__tests__/route.test.ts`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCanSee, mockRevoke } = vi.hoisted(() => ({ mockCanSee: vi.fn(), mockRevoke: vi.fn() }));
vi.mock('@/features/setu/teacher/student-detail', () => ({ canTeacherSeeStudent: mockCanSee }));
vi.mock('@/features/setu/teacher/award-achievement', () => ({ revokeAchievement: mockRevoke }));

function req(role: string | null, mid?: string): Request {
  const headers: Record<string, string> = {};
  if (role) { headers['x-portal-role'] = role; headers['x-portal-uid'] = 'uid-teacher'; headers['x-portal-mid'] = 'CMT-A-01'; }
  const url = `http://localhost/api/setu/teacher/achievements/a1${mid ? `?mid=${encodeURIComponent(mid)}` : ''}`;
  return new Request(url, { method: 'DELETE', headers });
}
const ctx = { params: Promise.resolve({ achId: 'a1' }) };

beforeEach(() => { vi.clearAllMocks(); mockCanSee.mockResolvedValue(true); mockRevoke.mockResolvedValue(true); });

it('403 for a non-teacher', async () => {
  const { DELETE } = await import('../route');
  expect((await DELETE(req('family-manager', 'CMT-F1-02'), ctx)).status).toBe(403);
});
it('400 when mid query param is missing', async () => {
  const { DELETE } = await import('../route');
  expect((await DELETE(req('teacher'), ctx)).status).toBe(400);
});
it('403 not-your-student when roster check fails', async () => {
  mockCanSee.mockResolvedValue(false);
  const { DELETE } = await import('../route');
  expect((await DELETE(req('teacher', 'CMT-F1-02'), ctx)).status).toBe(403);
  expect(mockRevoke).not.toHaveBeenCalled();
});
it('404 when the achievement does not exist', async () => {
  mockRevoke.mockResolvedValue(false);
  const { DELETE } = await import('../route');
  expect((await DELETE(req('teacher', 'CMT-F1-02'), ctx)).status).toBe(404);
});
it('200 revokes for fid derived from mid', async () => {
  const { DELETE } = await import('../route');
  const res = await DELETE(req('teacher', 'CMT-F1-02'), ctx);
  expect(res.status).toBe(200);
  expect(mockRevoke).toHaveBeenCalledWith('CMT-F1', 'CMT-F1-02', 'a1');
});
```

- [ ] **Step 5 — confirm RED; Step 6 — implement** `apps/portal/src/app/api/setu/teacher/achievements/[achId]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeacherSeeStudent } from '@/features/setu/teacher/student-detail';
import { revokeAchievement } from '@/features/setu/teacher/award-achievement';
import { fidFromMid } from '@/features/setu/members/mid';

type RouteContext = { params: Promise<{ achId: string }> };

export async function DELETE(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const { achId } = await ctx.params;
  const mid = new URL(req.url).searchParams.get('mid');
  if (!mid) return NextResponse.json({ error: 'mid-required' }, { status: 400 });
  if (!(await canTeacherSeeStudent(session, mid))) {
    return NextResponse.json({ error: 'not-your-student' }, { status: 403 });
  }
  const ok = await revokeAchievement(fidFromMid(mid), mid, achId);
  if (!ok) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 7 — canAccessRoute confirming test** (append to `packages/shared-domain/src/__tests__/can-access-route.test.ts`, reusing the existing claim fixtures — teacher, admin, family-manager, welcome-team):
```ts
it('allows teacher + admin to POST/DELETE the achievements API; denies family + welcome', () => {
  expect(canAccessRoute(<teacher>, '/api/setu/teacher/achievements', 'POST')).toBe(true);
  expect(canAccessRoute(<admin>, '/api/setu/teacher/achievements/a1', 'DELETE')).toBe(true);
  expect(canAccessRoute(<familyManager>, '/api/setu/teacher/achievements', 'POST')).toBe(false);
  expect(canAccessRoute(<welcomeTeam>, '/api/setu/teacher/achievements', 'POST')).toBe(false);
});
```
(Match the file's existing fixture names/values; do NOT change any rule in `can-access-route.ts` — this only locks the existing `/api/setu/teacher/` behaviour.)

- [ ] **Step 8 — run both route suites + the can-access-route suite + both `tsc --noEmit` (portal + shared-domain) → green. Step 9 — commit:** `feat(child-profile): teacher achievements POST + DELETE routes`.

---

## Task 5: teacher awarding UI (`<AwardBadge>` island + page wiring)

**Files:** create `apps/portal/src/features/setu/teacher/components/award-badge.tsx` + `__tests__/award-badge.test.tsx`; modify `apps/portal/src/app/teacher/students/[mid]/page.tsx`.

- [ ] **Step 1 — island test** (`@testing-library/react` + `userEvent`; mock `next/navigation` `useRouter`, `@cmt/ui` `toast`, and `global.fetch`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AwardBadge } from '../award-badge';

const ACHIEVEMENTS = [
  { achId: 'a1', title: 'Om Award', description: null, programKey: 'bala-vihar', awardedByName: null, awardedAt: '2026-05-01T00:00:00.000Z' },
];
const PROGRAMS = [{ key: 'bala-vihar', label: 'Bala Vihar' }];

beforeEach(() => {
  mockRefresh.mockReset();
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ achId: 'new' }), { status: 201 })) as never;
});

it('lists existing achievements with a revoke control', () => {
  render(<AwardBadge mid="CMT-F1-02" achievements={ACHIEVEMENTS} programOptions={PROGRAMS} />);
  expect(screen.getByText(/Om Award/)).toBeDefined();
  expect(screen.getByRole('button', { name: /revoke/i })).toBeDefined();
});

it('awards a badge: POSTs the title and refreshes', async () => {
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={[]} programOptions={PROGRAMS} />);
  await user.type(screen.getByLabelText(/badge title/i), 'Gita L2');
  await user.click(screen.getByRole('button', { name: /award/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/achievements', expect.objectContaining({ method: 'POST' }));
  const call = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
  expect(JSON.parse((call[1] as { body: string }).body)).toMatchObject({ mid: 'CMT-F1-02', title: 'Gita L2' });
  expect(mockRefresh).toHaveBeenCalled();
});

it('does not POST when the title is empty', async () => {
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={[]} programOptions={PROGRAMS} />);
  await user.click(screen.getByRole('button', { name: /award/i }));
  expect(global.fetch).not.toHaveBeenCalled();
});

it('revokes: DELETEs with the mid query param and refreshes', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as never;
  const user = userEvent.setup();
  render(<AwardBadge mid="CMT-F1-02" achievements={ACHIEVEMENTS} programOptions={PROGRAMS} />);
  await user.click(screen.getByRole('button', { name: /revoke/i }));
  expect(global.fetch).toHaveBeenCalledWith('/api/setu/teacher/achievements/a1?mid=CMT-F1-02', expect.objectContaining({ method: 'DELETE' }));
  expect(mockRefresh).toHaveBeenCalled();
});
```

- [ ] **Step 2 — confirm RED; Step 3 — implement** `apps/portal/src/features/setu/teacher/components/award-badge.tsx` (`'use client'`; mirror `attendance-marker.tsx`; render from props — NO list state, rely on `router.refresh()`):
  - Props: `{ mid: string; achievements: ChildAchievement[]; programOptions: { key: string; label: string }[] }` (`import type { ChildAchievement } from '@/features/setu/members/get-child-profile';`).
  - **Existing badges list:** for each achievement, a `card`-style row with the title, an optional program label (look up `programOptions` by `programKey`, else show the raw key), a muted awarded date (`new Date(a.awardedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' })`), and a small **"Revoke"** `button` (calls `revoke(a.achId)`). Empty → a muted "No badges yet."
  - **Award form:** a labelled title `<input id="..." aria-label="Badge title">`, an optional description `<input>`, a `<select>` of `programOptions` ("General (no program)" = value `''` first), and an **"Award badge"** `button`. `award()` guards empty title (`toast.error('Enter a badge title')`, no fetch), else POSTs `{ mid, title: title.trim(), description: description.trim() || undefined, programKey: programKey || null }`, on `!res.ok` → `toast.error`, on success → `toast.success`, clear inputs, `router.refresh()`.
  - `useTransition` for `pending`; disable buttons while pending. Themed with Cool-Mist tokens + `input`/`btn btn--p`/`btn btn--s`/`card`/`pill` classes (they resolve inside the teacher CspRoot). Responsive at 375px (form stacks; the `grid`/`flex` wraps).
  - NO nested component declarations.

- [ ] **Step 4 — wire into the teacher page** `app/teacher/students/[mid]/page.tsx`. After `const s = await getStudentDetail(mid); if (!s) ...`, load the extras and render the section just before the closing `</div>`:
```tsx
import { getMemberAchievements } from '@/features/setu/members/get-achievements';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { AwardBadge } from '@/features/setu/teacher/components/award-badge';
// ...
  const [achievements, enrollments] = await Promise.all([
    getMemberAchievements(s.fid, mid),
    getEnrollments(s.fid),
  ]);
  const programOptions = Array.from(
    new Map(
      enrollments
        .filter((e) => e.status === 'active' && e.enrolledMids.includes(mid))
        .map((e) => [e.programKey, { key: e.programKey, label: e.programLabel }]),
    ).values(),
  );
// ...inside the returned JSX, after the Parent contact block:
  <div style={{ marginTop: 22 }}>
    <SectionLabel>Achievements</SectionLabel>
    <AwardBadge mid={mid} achievements={achievements} programOptions={programOptions} />
  </div>
```

- [ ] **Step 5 — run the island test + any teacher-page test + `tsc --noEmit` + `eslint` on touched files → green. Step 6 — commit:** `feat(child-profile): teacher award/revoke badge UI on student detail`.

---

## Task 6: read-only Achievements chip strip in `<ChildProfileView>`

**Files:** modify `apps/portal/src/features/setu/members/child-profile-view.tsx` + `__tests__/child-profile-view.test.tsx`.

- [ ] **Step 1 — extend the component test.** First, the existing fixture profile needs `achievements: []` added (the type now requires it). Then add a case: a profile with two achievements (one with `programKey: 'bala-vihar'`, one with `programKey: null`) renders an "Achievements" section with both titles; the program-tagged one shows a program label/key; a date is shown. And: with `achievements: []`, NO "Achievements" heading renders.

- [ ] **Step 2 — confirm RED; Step 3 — implement.** Add `ChildAchievement` to the type import from `./get-child-profile`. Add a `renderAchievements(achievements: ChildAchievement[])` helper (module-scope function, NOT a nested component) that returns `null` when empty, else a `SectionLabel` "Achievements" + a flex-wrap chip strip. Each chip: a `pill`/`card`-style element (inside CspRoot tokens resolve) with the badge `title` (strong), an optional `· {programKey}` suffix when set, and a small muted awarded date (`new Date(a.awardedAt).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'America/Toronto' })`). Render it in `ChildProfileView` AFTER the Past-programs `<details>` and BEFORE the `editHref` block. Keep all existing exported names, props, and test-queried text intact.

- [ ] **Step 4 — run the component test + `tsc --noEmit` + `eslint` → green. Step 5 — commit:** `feat(child-profile): read-only achievements on the child profile view`.

---

## Task 7 (controller): designer pass + slice verification

- [ ] **Designer pass.** Dispatch `oh-my-claudecode:designer` (opus) over the TWO new surfaces only: the achievements chip strip in `child-profile-view.tsx` (read-only, celebratory but calm — a badge motif consistent with the seva "rewarding signal" accent rail) AND the `<AwardBadge>` island (`award-badge.tsx`) — a clean award form + a tidy revoke list that works at 375px. Constraint: do NOT change props, the `ChildProfile`/`ChildAchievement` contract, exported names, or any test-queried text/labels (`aria-label="Badge title"`, button names matching `/award/i` and `/revoke/i`, the "Achievements" heading). Re-run the two component/island tests + `tsc` + `eslint`. Commit `style(child-profile): polish achievements display + award UI`.

- [ ] **Final review** (Opus, separate context): spec-compliance + code-quality over the whole slice (schema, reader, writer, both routes, island, view, page wiring). Address blocking/important issues; re-review.

## Slice 2 verification (before done)
- [ ] `tsc --noEmit` (portal + shared-domain) → 0; `pnpm lint` clean; full vitest suites green; `pnpm build` green (watch the two new `/api/setu/teacher/achievements*` route prerenders).
- [ ] **Mobile-app readiness:** both teacher routes use `readSessionFromHeaders` (grep: no `cookies()`/`getCurrentFamily()` in either handler); JSON envelopes; `AwardAchievementSchema` shared from `@cmt/shared-domain`.
- [ ] **No new Firestore index** (confirm `getMemberAchievements` uses a single-collection `orderBy`, not a `collectionGroup`).
- [ ] **Gates covered by tests:** non-teacher 403, bad payload 400, roster-fail 403, not-found 404, happy 201/200; the canAccessRoute teacher rule locked.
- [ ] Push (full gate). Update the resume-note memory: child-profile Slice 2 (achievements) shipped; feature complete.
- [ ] **Mock-free UAT walkthrough** (flag for CMT Developer — agent can't OTP sign-in): as a teacher → open a student on `/teacher/students/[mid]` → award a badge (with + without a program) → it appears; revoke it → it disappears. As that student's family → open the child profile → the badge shows read-only; as welcome/admin → `/welcome/family/[fid]/members/[mid]` → the badge shows. Confirm a teacher cannot award to a student not on their roster (403).

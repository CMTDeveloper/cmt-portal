# Teacher Attendance T3 — Visitors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a Bala Vihar teacher, inside the redesigned level-attendance flow, a **Visitors** screen that (a) surfaces the day's door guest-check-in children matched to this level by grade, and (b) lets the teacher add a walk-in in seconds (name required; grade + parent email/phone optional) — each confirm/add creating a pending family + a guest `attendanceEvents` mark.

**Architecture:** A new read-only door reader `readDoorGuestCheckIns(date)` (mirrors `readDoorPresentSids`, index-free list+point-read) feeds a pure grade matcher and a server view model `getLevelVisitorsView(levelId, date)`. A shared `upsertPendingFamilyChild()` core (extracted from the existing `addStudentOnPrompt`) backs a new **email-optional** `addVisitorOnPrompt()`; the existing `addStudentOnPrompt` is refactored to delegate to the same core (behavior preserved). New `GET/POST /api/setu/teacher/visitors` routes drive a new mobile-first `visitors-panel.tsx` island at `/teacher/levels/[levelId]/visitors`, replacing the legacy `/guests` page + `guest-list.tsx`. The two "Visitors →" links in `attendance-marker.tsx` repoint to `/visitors`.

**Tech Stack:** Next.js 16 App Router (server components + `'use client'` islands), TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod (`@cmt/shared-domain`), Firebase Admin (portal Firestore = UAT `chinmaya-setu-uat`; door reads via read-only `checkInSourceFirestore()` → master `715b8`), Vitest + Testing Library, Setu `.csp` Cool-Mist theme tokens.

---

## Standing constraints (do not violate)

- **Read-only door bridge.** All door reads go through `checkInSourceFirestore()`. NEVER write `family-check-ins` / `guest-families`. NEVER touch prod `715b8` for writes or index deploys. NEVER add a Firestore composite index that would target `715b8` — the door guest reader MUST be index-free (list the collection + point-read the date doc, exactly as the door app itself does).
- **Portal writes target UAT only** (`chinmaya-setu-uat`).
- **Role checks via helpers** (`isTeacher`, never strict equality). New `/api/setu/teacher/*` paths are auto-covered by the `canAccessRoute` teacher catch-all — confirm with a test, do not add a rule.
- **Mobile-app-ready APIs**: every handler uses `readSessionFromHeaders` (cookie OR Bearer), ISO/JSON only, shared `@cmt/shared-domain` Zod schemas.
- **Mobile-first UI**: the Visitors panel matches the just-shipped `attendance-marker.tsx` (T2) — fluid single column, 48px touch targets, `.csp` tokens, `env(safe-area-inset-bottom)`. A designer pass (Task 8) enforces excellence on phone AND desktop.
- **`exactOptionalPropertyTypes`**: never assign `undefined` to an optional field; use `null` or conditional spread.
- **Run the FULL `pnpm --filter @cmt/portal lint`** before any commit (not just per-file eslint) — drop unused `describe`/imports. The pre-push hook runs `typecheck && lint && test && build`; never `--no-verify`.
- **Spawn all implementer/reviewer subagents on Opus** (`model:'opus'`).

## File structure

**Create:**
- `apps/portal/src/features/setu/teacher/pending-family.ts` — shared `upsertPendingFamilyChild()` txn core (pending family + child member upsert).
- `apps/portal/src/features/setu/teacher/visitors.ts` — `guestMatchesLevel()` pure matcher, `addVisitorOnPrompt()`, `getLevelVisitorsView()`, view types.
- `apps/portal/src/app/api/setu/teacher/visitors/route.ts` — GET (view) + POST (confirm/add).
- `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx` — `'use client'` island.
- `apps/portal/src/app/teacher/levels/[levelId]/visitors/page.tsx` — server page.
- Test files (colocated `__tests__/`): `pending-family.test.ts`, `visitors.test.ts`, `visitors-route.test.ts` (under the route dir or `teacher/__tests__/`), `visitors-panel.test.tsx`, and additions to `check-in-attendance.test.ts`, `add-student.test.ts`, `guests.test.ts`, `can-access-route.test.ts`.

**Modify:**
- `apps/portal/src/features/setu/attendance/check-in-attendance.ts` — add `readDoorGuestCheckIns(date)` + `DoorGuestChild`.
- `packages/shared-domain/src/setu/schemas/attendance.ts` — add `AddVisitorSchema` + `AddVisitorInput` (auto-barreled via `setu/index.ts`).
- `apps/portal/src/features/setu/teacher/add-student.ts` — refactor `addStudentOnPrompt` to delegate to `upsertPendingFamilyChild` (behavior preserved).
- `apps/portal/src/features/setu/teacher/guests.ts` — add `listGuestsDetailed(levelId, date)` (name-enriched guest list).
- `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` — repoint both `/guests?date=` links → `/visitors?date=`.

**Delete (after links repointed):**
- `apps/portal/src/app/teacher/levels/[levelId]/guests/page.tsx`
- `apps/portal/src/features/setu/teacher/components/guest-list.tsx`
- their test(s) if any (`guest-list.test.tsx`).

> Note: KEEP `apps/portal/src/app/api/setu/teacher/guests/route.ts`, `guests.ts` (`markGuest`/`listGuests`), `add-student/route.ts`, and `add-student.ts` — they remain load-bearing (reused by the view + as the mobile/legacy API surface).

---

## Task 1: Door guest reader `readDoorGuestCheckIns(date)`

Read the day's guest children across all door guest families, read-only & index-free.

**Files:**
- Modify: `apps/portal/src/features/setu/attendance/check-in-attendance.ts`
- Test: `apps/portal/src/features/setu/attendance/__tests__/check-in-attendance.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing `check-in-attendance.test.ts`)

The existing mock at the top of that file mocks `../check-in-source` with a `checkInSourceFirestore()` whose `collection().doc(legacyFid).collection().doc(date)` shape supports `readDoorPresentSids`. Extend that mock so `collection('guest-families')` supports BOTH `.get()` (list all guest-family docs) and `.doc(email).collection('checkIns').doc(date).get()`. Replace the existing `vi.mock('../check-in-source', ...)` block with this superset (keeps `family-check-ins` behavior, adds `guest-families`):

```ts
const { mockGet, dayDocResolver, guestListResolver, guestDayResolver } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  dayDocResolver: { fn: (_legacyFid: string, _date: string) => ({ exists: false }) as unknown },
  // guest-families list: returns docs [{ id: emailLower }]
  guestListResolver: { fn: () => ({ docs: [] as Array<{ id: string }> }) as unknown },
  // guest-families/{email}/checkIns/{date} day doc
  guestDayResolver: { fn: (_email: string, _date: string) => ({ exists: false }) as unknown },
}));
vi.mock('../check-in-source', () => ({
  checkInSourceFirestore: () => ({
    collection: (name: string) => {
      if (name === 'guest-families') {
        return {
          get: async () => guestListResolver.fn(),
          doc: (email: string) => ({
            collection: () => ({ doc: (date: string) => ({ get: async () => guestDayResolver.fn(email, date) }) }),
          }),
        };
      }
      // family-check-ins (unchanged shape used by getCheckInAttendance + readDoorPresentSids)
      return {
        doc: (legacyFid: string) => ({
          collection: () => ({
            get: mockGet,
            doc: (date: string) => ({ get: async () => dayDocResolver.fn(legacyFid, date) }),
          }),
        }),
      };
    },
  }),
}));
```

Add `readDoorGuestCheckIns` to the import line and reset the new resolvers in `beforeEach`:

```ts
import {
  getCheckInAttendance,
  readDoorPresentSids,
  readDoorGuestCheckIns,
  summarizeFamilyCheckIns,
  summarizeMemberCheckIns,
  type CheckInRecord,
} from '../check-in-attendance';
```
```ts
beforeEach(() => {
  vi.clearAllMocks();
  dayDocResolver.fn = () => ({ exists: false });
  guestListResolver.fn = () => ({ docs: [] });
  guestDayResolver.fn = () => ({ exists: false });
});
```

Append the test block:

```ts
describe('readDoorGuestCheckIns', () => {
  it('returns one entry per checked-in child for the date, coercing grade to string', async () => {
    guestListResolver.fn = () => ({ docs: [{ id: 'mom@x.com' }, { id: 'dad@y.com' }] });
    guestDayResolver.fn = (email, date) => {
      if (date !== '2026-01-04') return { exists: false };
      if (email === 'mom@x.com') {
        return { exists: true, data: () => ({
          parentName: 'Mom X', phone: '416', email: 'mom@x.com',
          children: [
            { name: 'Arjun X', grade: 2, isCheckedIn: true },
            { name: 'Maya X', grade: '3', isCheckedIn: false }, // not checked in → skipped
          ],
        }) };
      }
      if (email === 'dad@y.com') {
        return { exists: true, data: () => ({
          parentName: null, phone: null, email: 'dad@y.com',
          children: [{ name: 'Ravi Y', grade: 'Grade 1', isCheckedIn: true }],
        }) };
      }
      return { exists: false };
    };
    const out = await readDoorGuestCheckIns('2026-01-04');
    expect(out).toEqual([
      { name: 'Arjun X', grade: '2', parentEmail: 'mom@x.com', parentName: 'Mom X', phone: '416' },
      { name: 'Ravi Y', grade: 'Grade 1', parentEmail: 'dad@y.com', parentName: null, phone: null },
    ]);
  });

  it('skips families with no day-doc and tolerates a per-family read error', async () => {
    guestListResolver.fn = () => ({ docs: [{ id: 'a@x.com' }, { id: 'boom@x.com' }] });
    guestDayResolver.fn = (email, date) => {
      if (email === 'boom@x.com') throw new Error('read failed');
      if (email === 'a@x.com' && date === '2026-01-04') {
        return { exists: true, data: () => ({ email: 'a@x.com', children: [{ name: 'Sam', grade: '', isCheckedIn: true }] }) };
      }
      return { exists: false };
    };
    const out = await readDoorGuestCheckIns('2026-01-04');
    expect(out).toEqual([{ name: 'Sam', grade: '', parentEmail: 'a@x.com', parentName: null, phone: null }]);
  });

  it('returns [] when the guest-families list read fails', async () => {
    guestListResolver.fn = () => { throw new Error('list failed'); };
    expect(await readDoorGuestCheckIns('2026-01-04')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/check-in-attendance.test.ts`
Expected: FAIL — `readDoorGuestCheckIns is not a function` (and existing tests still pass against the superset mock).

- [ ] **Step 3: Implement `readDoorGuestCheckIns`** (append to `check-in-attendance.ts`, after `readDoorPresentSids`)

```ts
/** One door guest check-in child for a date (no portal id — door has none). */
export interface DoorGuestChild {
  name: string;
  grade: string; // door stores string|number; normalized to string here
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
}

/**
 * READ-ONLY: every checked-in guest child at the door for a single date, across
 * all guest families. Mirrors the door app's own read (list `guest-families`,
 * then point-read each family's `checkIns/{date}`) — deliberately INDEX-FREE so
 * it never needs a composite index in prod 715b8. Tolerates missing day-docs and
 * per-family read errors; returns [] if the collection list itself fails.
 */
export async function readDoorGuestCheckIns(date: string): Promise<DoorGuestChild[]> {
  const db = checkInSourceFirestore();
  let familyDocs: Array<{ id: string }>;
  try {
    const list = await db.collection('guest-families').get();
    familyDocs = list.docs;
  } catch (err) {
    console.error('[door-guests] list failed for', date, err);
    return [];
  }

  const out: DoorGuestChild[] = [];
  await Promise.all(
    familyDocs.map(async (fam) => {
      try {
        const snap = await db
          .collection('guest-families').doc(fam.id)
          .collection('checkIns').doc(date).get();
        if (!snap.exists) return;
        const data = (snap.data() ?? {}) as {
          parentName?: string | null;
          phone?: string | null;
          email?: string | null;
          children?: Array<{ name?: string; grade?: string | number; isCheckedIn?: boolean }>;
        };
        const parentEmail = (data.email ?? fam.id) || fam.id;
        for (const c of data.children ?? []) {
          if (c.isCheckedIn !== true) continue;
          out.push({
            name: String(c.name ?? '').trim(),
            grade: c.grade == null ? '' : String(c.grade).trim(),
            parentEmail,
            parentName: data.parentName ?? null,
            phone: data.phone ?? null,
          });
        }
      } catch (err) {
        console.error('[door-guests] read failed for', fam.id, date, err);
      }
    }),
  );
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/attendance/__tests__/check-in-attendance.test.ts`
Expected: PASS (all blocks, including the pre-existing `readDoorPresentSids` / `getCheckInAttendance` tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/attendance/check-in-attendance.ts apps/portal/src/features/setu/attendance/__tests__/check-in-attendance.test.ts
git commit -m "feat(teacher-attendance): read-only door guest-check-in reader (T3)"
```

---

## Task 2: `AddVisitorSchema` (shared-domain, email-optional)

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/attendance.ts`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/attendance.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

If `attendance.test.ts` does not exist, create it:

```ts
import { describe, it, expect } from 'vitest';
import { AddVisitorSchema } from '../attendance';

describe('AddVisitorSchema', () => {
  const base = { levelId: 'L', date: '2026-01-04', firstName: 'Arjun' };

  it('accepts a name-only walk-in (lastName/grade/email/phone all optional)', () => {
    const r = AddVisitorSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({
        firstName: 'Arjun', lastName: '', schoolGrade: null,
        gender: 'PreferNotToSay', parentEmail: null, parentPhone: null,
      });
    }
  });

  it('coerces an empty-string email/grade/phone to null', () => {
    const r = AddVisitorSchema.safeParse({ ...base, parentEmail: '', schoolGrade: '', parentPhone: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ parentEmail: null, schoolGrade: null, parentPhone: null });
  });

  it('rejects a non-email parentEmail and a blank firstName', () => {
    expect(AddVisitorSchema.safeParse({ ...base, parentEmail: 'nope' }).success).toBe(false);
    expect(AddVisitorSchema.safeParse({ ...base, firstName: '   ' }).success).toBe(false);
  });

  it('keeps a valid email + grade', () => {
    const r = AddVisitorSchema.safeParse({ ...base, lastName: 'X', schoolGrade: 'Grade 2', parentEmail: 'p@x.com' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ lastName: 'X', schoolGrade: 'Grade 2', parentEmail: 'p@x.com' });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/attendance.test.ts`
Expected: FAIL — `AddVisitorSchema` is not exported.

- [ ] **Step 3: Implement `AddVisitorSchema`** (append to `attendance.ts`, after `AddStudentSchema`)

```ts
// Empty string → null, so the in-class quick-add can send optional fields blank.
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// POST /api/setu/teacher/visitors — a teacher confirms a door guest or adds a
// walk-in. Name required (firstName); EVERYTHING else optional (T3 relaxes the
// add-student email requirement). With no email/phone the family is created
// un-claimable until contact is added later (design §"Visitor handling").
export const AddVisitorSchema = z.object({
  levelId: z.string().min(1),
  date: YMD,
  firstName: z.string().trim().min(1),
  lastName: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string()).default(''),
  schoolGrade: z.preprocess(emptyToNull, z.string().trim().min(1).nullable()).default(null),
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']).default('PreferNotToSay'),
  parentEmail: z.preprocess(emptyToNull, z.string().trim().email().nullable()).default(null),
  parentPhone: z.preprocess(emptyToNull, z.string().trim().min(1).nullable()).default(null),
});

export type AddVisitorInput = z.infer<typeof AddVisitorSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/schemas/__tests__/attendance.test.ts`
Expected: PASS. (`AddVisitorSchema` is auto-exported via `setu/index.ts` → `export * from './schemas/attendance'`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/attendance.ts packages/shared-domain/src/setu/schemas/__tests__/attendance.test.ts
git commit -m "feat(shared-domain): AddVisitorSchema — email-optional visitor quick-add (T3)"
```

---

## Task 3: Shared pending-family core + refactor `addStudentOnPrompt`

Extract the pending-family/child upsert into one reusable, behavior-preserving core.

**Files:**
- Create: `apps/portal/src/features/setu/teacher/pending-family.ts`
- Create: `apps/portal/src/features/setu/teacher/__tests__/pending-family.test.ts`
- Modify: `apps/portal/src/features/setu/teacher/add-student.ts`
- Test (regression): `apps/portal/src/features/setu/teacher/__tests__/add-student.test.ts` (must stay green unchanged)

- [ ] **Step 1: Write the failing test** for the core

`pending-family.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txnGet, txnSet, mockRunTxn } = vi.hoisted(() => ({ txnGet: vi.fn(), txnSet: vi.fn(), mockRunTxn: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));
vi.mock('@/features/setu/registration/generate-fid', () => ({ generateFid: () => 'CMT-NEW1' }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));

import { upsertPendingFamilyChild } from '../pending-family';

// A db whose collection().doc().collection() chain is inert (txn.get/set are mocked).
const db = {
  collection: (c: string) => ({ doc: (id: string) => ({ __c: c, __id: id, collection: (s: string) => ({ __c: s, doc: (sid: string) => ({ __c: s, __id: sid }) }) }) }),
  runTransaction: mockRunTxn,
} as unknown as Parameters<typeof upsertPendingFamilyChild>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTxn.mockImplementation(async (cb: (t: { get: typeof txnGet; set: typeof txnSet }) => Promise<unknown>) => cb({ get: txnGet, set: txnSet }));
});

const P = { levelLocation: 'Brampton', firstName: 'New', lastName: 'Kid', schoolGrade: 'Grade 2', gender: 'PreferNotToSay' as const, parentEmail: 'p@x.com', parentPhone: null };

describe('upsertPendingFamilyChild', () => {
  it('creates a new pending family keyed by email when unclaimed', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // email contactKey lookup
    const r = await upsertPendingFamilyChild(db, P);
    expect(r).toEqual({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    expect(txnSet).toHaveBeenCalledTimes(4); // family, manager, child, email contactKey
  });

  it('appends to an existing family when email already claims one', async () => {
    txnGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ fid: 'CMT-EXIST' }) })
      .mockResolvedValueOnce({ size: 2 }); // members size → -03
    const r = await upsertPendingFamilyChild(db, P);
    expect(r).toEqual({ fid: 'CMT-EXIST', childMid: 'CMT-EXIST-03', createdFamily: false });
    expect(txnSet).toHaveBeenCalledTimes(1); // only the child member
  });

  it('with NO email and NO phone, creates an un-claimable pending family (no contactKey)', async () => {
    const r = await upsertPendingFamilyChild(db, { ...P, parentEmail: null, parentPhone: null });
    expect(r).toEqual({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    expect(txnGet).not.toHaveBeenCalled(); // no claim key → no lookup
    expect(txnSet).toHaveBeenCalledTimes(3); // family, manager, child — no contactKey
  });

  it('with phone only (no email), looks up + writes the phone contactKey', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // phone contactKey lookup
    const r = await upsertPendingFamilyChild(db, { ...P, parentEmail: null, parentPhone: '416-555-0100' });
    expect(r.createdFamily).toBe(true);
    expect(txnSet).toHaveBeenCalledTimes(4); // family, manager, child, phone contactKey
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/pending-family.test.ts`
Expected: FAIL — module `../pending-family` not found.

- [ ] **Step 3: Implement the core** (`pending-family.ts`)

```ts
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { generateFid } from '@/features/setu/registration/generate-fid';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

type Db = import('@cmt/firebase-shared/admin/firestore').Firestore extends never
  ? never
  : ReturnType<typeof import('@cmt/firebase-shared/admin/firestore').portalFirestore>;

export interface PendingChildParams {
  levelLocation: string | null;
  firstName: string;
  lastName: string; // '' allowed
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string | null;
  parentPhone: string | null;
}

export interface PendingChildResult {
  fid: string;
  childMid: string;
  createdFamily: boolean;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

function baseMemberFields(now: FirebaseFirestore.FieldValue) {
  return {
    uid: null,
    volunteeringSkills: [] as string[],
    foodAllergies: null,
    emergencyContacts: [null, null],
    joinedAt: now,
  };
}

/**
 * Ensure a pending family + child member exist for an on-the-spot add, keyed by
 * the parent's contact:
 *  - Look up the family by EMAIL contactKey when an email is given; otherwise by
 *    PHONE contactKey. (Email-first preserves the legacy add-student behavior:
 *    a single contactKey read when an email is present.)
 *  - If found → append the child to that family.
 *  - Else → create a new pending family whose MANAGER is the parent. Write a
 *    contactKey for each contact present (email and/or phone) so the parent
 *    claims the family on their next OTP sign-in. With NO contact at all, the
 *    family is created un-claimable (no contactKey) — contact can be added later.
 * Pure of side effects beyond the Firestore txn; does NOT mark attendance (the
 * caller does that after commit).
 */
export async function upsertPendingFamilyChild(db: Db, params: PendingChildParams): Promise<PendingChildResult> {
  const emailHash = params.parentEmail ? hashContactKey('email', params.parentEmail) : null;
  const phoneHash = params.parentPhone ? hashContactKey('phone', params.parentPhone) : null;

  return db.runTransaction(async (txn) => {
    const now = FieldValue.serverTimestamp();

    // Existing-family lookup: email first, phone only when there's no email.
    let existingFid: string | null = null;
    if (emailHash) {
      const k = await txn.get(db.collection('contactKeys').doc(emailHash));
      if (k.exists) existingFid = (k.data() as { fid: string }).fid;
    } else if (phoneHash) {
      const k = await txn.get(db.collection('contactKeys').doc(phoneHash));
      if (k.exists) existingFid = (k.data() as { fid: string }).fid;
    }

    if (existingFid) {
      const memSnap = await txn.get(db.collection('families').doc(existingFid).collection('members'));
      const nextMid = `${existingFid}-${zeroPad(memSnap.size + 1)}`;
      txn.set(db.collection('families').doc(existingFid).collection('members').doc(nextMid), {
        mid: nextMid,
        firstName: params.firstName,
        lastName: params.lastName,
        type: 'Child',
        gender: params.gender,
        manager: false,
        email: null,
        phone: null,
        schoolGrade: params.schoolGrade,
        birthMonthYear: null,
        ...baseMemberFields(now),
      });
      return { fid: existingFid, childMid: nextMid, createdFamily: false };
    }

    const newFid = generateFid();
    const managerMid = `${newFid}-01`;
    const newChildMid = `${newFid}-02`;
    const familyName = `${(params.lastName || params.firstName).trim()} family`;

    txn.set(db.collection('families').doc(newFid), {
      fid: newFid,
      legacyFid: null,
      name: familyName,
      location: params.levelLocation,
      createdAt: now,
      managers: [managerMid],
      searchKeys: [familyName.toLowerCase(), newFid],
    });
    txn.set(db.collection('families').doc(newFid).collection('members').doc(managerMid), {
      mid: managerMid,
      firstName: '',
      lastName: '',
      type: 'Adult',
      gender: 'PreferNotToSay',
      manager: true,
      email: params.parentEmail ? params.parentEmail.trim().toLowerCase() : null,
      phone: params.parentPhone,
      schoolGrade: null,
      birthMonthYear: null,
      ...baseMemberFields(now),
    });
    txn.set(db.collection('families').doc(newFid).collection('members').doc(newChildMid), {
      mid: newChildMid,
      firstName: params.firstName,
      lastName: params.lastName,
      type: 'Child',
      gender: params.gender,
      manager: false,
      email: null,
      phone: null,
      schoolGrade: params.schoolGrade,
      birthMonthYear: null,
      ...baseMemberFields(now),
    });
    if (emailHash) {
      txn.set(db.collection('contactKeys').doc(emailHash), { contactKey: emailHash, type: 'email', fid: newFid, mid: managerMid });
    }
    if (phoneHash) {
      txn.set(db.collection('contactKeys').doc(phoneHash), { contactKey: phoneHash, type: 'phone', fid: newFid, mid: managerMid });
    }
    return { fid: newFid, childMid: newChildMid, createdFamily: true };
  });
}
```

> If `import('...').Firestore` typing is awkward, type `Db` simply as `ReturnType<typeof import('@cmt/firebase-shared/admin/firestore').portalFirestore>` (the portal has no direct `firebase-admin` dep — match the `check-in-source.ts` pattern: `type Firestore = ReturnType<typeof portalFirestore>`).

- [ ] **Step 4: Run the core test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/pending-family.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `add-student.ts` to delegate** (replace the body of `addStudentOnPrompt`; keep `AddStudentParams`/`AddStudentResult` exactly)

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { LevelDoc } from '@cmt/shared-domain';
import { markGuest } from './guests';
import { upsertPendingFamilyChild } from './pending-family';

export interface AddStudentParams {
  levelId: string;
  date: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string;
  parentPhone: string | null;
  markedByUid: string;
  markedByMid: string | null;
}

export type AddStudentResult =
  | { ok: true; fid: string; childMid: string; createdFamily: boolean; autoEnrolled: boolean }
  | { ok: false; reason: 'level-not-found' };

/**
 * Add an unregistered child on the spot, keyed by the parent's email
 * (always present here — the visitor flow relaxes that; see addVisitorOnPrompt).
 * Delegates the family/child upsert to the shared pending-family core, then
 * marks the child present as a guest (auto-enrolls for the level's period).
 */
export async function addStudentOnPrompt(params: AddStudentParams): Promise<AddStudentResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const { fid, childMid, createdFamily } = await upsertPendingFamilyChild(db, {
    levelLocation: level.location,
    firstName: params.firstName,
    lastName: params.lastName,
    schoolGrade: params.schoolGrade,
    gender: params.gender,
    parentEmail: params.parentEmail,
    parentPhone: params.parentPhone,
  });

  const guest = await markGuest({
    levelId: params.levelId,
    date: params.date,
    mid: childMid,
    status: 'present',
    markedByUid: params.markedByUid,
    markedByMid: params.markedByMid,
  });

  return { ok: true, fid, childMid, createdFamily, autoEnrolled: guest.ok ? guest.autoEnrolled : false };
}
```

- [ ] **Step 6: Run the add-student regression test (must stay green, unchanged)**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/add-student.test.ts`
Expected: PASS — all 4 cases (level-not-found, new family = 4 sets, +phone = 5 sets, existing family = 1 set). The email-first single-read sequence is preserved.

> If any add-student case fails on call-count, do NOT change the test — the core must match the legacy sequence. Re-check that the email branch does exactly one `txn.get` for the email contactKey before the members read.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/setu/teacher/pending-family.ts apps/portal/src/features/setu/teacher/__tests__/pending-family.test.ts apps/portal/src/features/setu/teacher/add-student.ts
git commit -m "refactor(teacher-attendance): extract shared pending-family upsert core (T3)"
```

---

## Task 4: `listGuestsDetailed` (name-enriched confirmed guests)

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/guests.ts`
- Test: `apps/portal/src/features/setu/teacher/__tests__/guests.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test** (add a `describe('listGuestsDetailed')` block; mock `portalFirestore` so the `attendanceEvents` query returns guest docs and each `families/{fid}/members/{mid}` read returns a name)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { eventsGet, memberGet } = vi.hoisted(() => ({ eventsGet: vi.fn(), memberGet: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
  portalFirestore: () => ({
    collection: (c: string) => {
      if (c === 'attendanceEvents') {
        return { where: () => ({ where: () => ({ get: eventsGet }) }) };
      }
      // families/{fid}/members/{mid}
      return { doc: () => ({ collection: () => ({ doc: () => ({ get: memberGet }) }) }) };
    },
  }),
}));
vi.mock('@/features/setu/enrollment/enroll-on-first-attendance', () => ({ enrollFamilyOnFirstAttendance: vi.fn() }));

import { listGuestsDetailed } from '../guests';

beforeEach(() => vi.clearAllMocks());

describe('listGuestsDetailed', () => {
  it('returns only guest events for the level+date, enriched with member names', async () => {
    eventsGet.mockResolvedValue({
      docs: [
        { data: () => ({ aid: 'a1', mid: 'F-02', fid: 'F', date: '2026-01-04', status: 'present', isGuest: true }) },
        { data: () => ({ aid: 'a2', mid: 'G-02', fid: 'G', date: '2026-01-04', status: 'present', isGuest: false }) }, // not a guest → excluded
      ],
    });
    memberGet.mockResolvedValue({ exists: true, data: () => ({ firstName: 'Arjun', lastName: 'X' }) });
    const out = await listGuestsDetailed('L', '2026-01-04');
    expect(out).toEqual([{ mid: 'F-02', fid: 'F', firstName: 'Arjun', lastName: 'X', status: 'present' }]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/guests.test.ts`
Expected: FAIL — `listGuestsDetailed` not exported.

- [ ] **Step 3: Implement `listGuestsDetailed`** (append to `guests.ts`)

```ts
export interface DetailedGuest {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  status: SetuAttendanceStatus;
}

/** Guests marked at a level on a date, enriched with each child's name. */
export async function listGuestsDetailed(levelId: string, date: string): Promise<DetailedGuest[]> {
  const db = portalFirestore();
  const snap = await db.collection('attendanceEvents').where('levelId', '==', levelId).where('date', '==', date).get();
  const guests = snap.docs.map((d) => d.data()).filter((e) => e.isGuest === true);
  return Promise.all(
    guests.map(async (e) => {
      let firstName = '';
      let lastName = '';
      try {
        const m = await db.collection('families').doc(e.fid).collection('members').doc(e.mid).get();
        if (m.exists) {
          const md = m.data() as { firstName?: string; lastName?: string };
          firstName = md.firstName ?? '';
          lastName = md.lastName ?? '';
        }
      } catch {
        // tolerate a missing member — show the mid-less row rather than failing the view
      }
      return { mid: e.mid, fid: e.fid, firstName, lastName, status: e.status as SetuAttendanceStatus };
    }),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/guests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/teacher/guests.ts apps/portal/src/features/setu/teacher/__tests__/guests.test.ts
git commit -m "feat(teacher-attendance): name-enriched listGuestsDetailed for the visitors view (T3)"
```

---

## Task 5: Visitor matcher + `addVisitorOnPrompt` + `getLevelVisitorsView`

**Files:**
- Create: `apps/portal/src/features/setu/teacher/visitors.ts`
- Create: `apps/portal/src/features/setu/teacher/__tests__/visitors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLevelGet, mockReadGuests, mockListDetailed, mockUpsert, mockMarkGuest, contactKeyGet } = vi.hoisted(() => ({
  mockLevelGet: vi.fn(),
  mockReadGuests: vi.fn(),
  mockListDetailed: vi.fn(),
  mockUpsert: vi.fn(),
  mockMarkGuest: vi.fn(),
  contactKeyGet: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (c: string) => {
      if (c === 'levels') return { doc: () => ({ get: mockLevelGet }) };
      return { doc: () => ({ get: contactKeyGet }) }; // contactKeys/{hash}
    },
  }),
}));
vi.mock('@/features/setu/attendance/check-in-attendance', () => ({ readDoorGuestCheckIns: mockReadGuests }));
vi.mock('./guests', () => ({ listGuestsDetailed: mockListDetailed, markGuest: mockMarkGuest }));
vi.mock('./pending-family', () => ({ upsertPendingFamilyChild: mockUpsert }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));

import { guestMatchesLevel, getLevelVisitorsView, addVisitorOnPrompt } from '../visitors';

beforeEach(() => {
  vi.clearAllMocks();
  mockLevelGet.mockResolvedValue({ exists: true, data: () => ({
    levelId: 'L', levelName: 'Level 1', ageLabel: 'Gr 1', location: 'Brampton',
    pid: 'o-bv', levelKind: 'level', gradeBand: ['1'],
  }) });
});

describe('guestMatchesLevel', () => {
  it('matches a level/pre-level child by normalized grade, never shishu/parents', () => {
    expect(guestMatchesLevel({ grade: 'Grade 1' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(true);
    expect(guestMatchesLevel({ grade: '2' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(false);
    expect(guestMatchesLevel({ grade: '' }, { levelKind: 'level', gradeBand: ['1'] })).toBe(false);
    expect(guestMatchesLevel({ grade: '1' }, { levelKind: 'shishu', gradeBand: [] })).toBe(false);
  });
});

describe('getLevelVisitorsView', () => {
  it('lists matched door guests and flags those already confirmed in the portal', async () => {
    mockReadGuests.mockResolvedValue([
      { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416' }, // matches
      { name: 'Maya Y', grade: '5', parentEmail: 'dad@y.com', parentName: null, phone: null },     // grade off → excluded
    ]);
    mockListDetailed.mockResolvedValue([{ mid: 'F-02', fid: 'CMT-F', firstName: 'Arjun', lastName: 'X', status: 'present' }]);
    contactKeyGet.mockResolvedValue({ exists: true, data: () => ({ fid: 'CMT-F' }) }); // mom@x.com already claims CMT-F (in confirmed)
    const view = await getLevelVisitorsView('L', '2026-01-04');
    expect(view).not.toBeNull();
    expect(view!.doorVisitors).toEqual([
      { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416', alreadyConfirmed: true },
    ]);
    expect(view!.confirmed).toEqual([{ mid: 'F-02', fid: 'CMT-F', firstName: 'Arjun', lastName: 'X', status: 'present' }]);
  });

  it('returns null when the level is missing', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    expect(await getLevelVisitorsView('nope', '2026-01-04')).toBeNull();
  });
});

describe('addVisitorOnPrompt', () => {
  it('upserts the pending family/child then marks present, reporting claimable', async () => {
    mockUpsert.mockResolvedValue({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true });
    mockMarkGuest.mockResolvedValue({ ok: true, aid: 'a1', autoEnrolled: true });
    const r = await addVisitorOnPrompt({
      levelId: 'L', date: '2026-01-04', firstName: 'Walk', lastName: 'In',
      schoolGrade: null, gender: 'PreferNotToSay', parentEmail: null, parentPhone: null,
      markedByUid: 'uid-t', markedByMid: 'CMT-T-01',
    });
    expect(r).toEqual({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true, claimable: false });
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({ mid: 'CMT-NEW1-02', status: 'present', levelId: 'L' }));
  });

  it('level-not-found short-circuits before any write', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    const r = await addVisitorOnPrompt({
      levelId: 'nope', date: '2026-01-04', firstName: 'A', lastName: '', schoolGrade: null,
      gender: 'PreferNotToSay', parentEmail: 'p@x.com', parentPhone: null, markedByUid: 'u', markedByMid: null,
    });
    expect(r).toEqual({ ok: false, reason: 'level-not-found' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/visitors.test.ts`
Expected: FAIL — module `../visitors` not found.

- [ ] **Step 3: Implement `visitors.ts`**

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { normalizeGrade, type LevelDoc, type LevelKind, type SetuAttendanceStatus } from '@cmt/shared-domain';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { readDoorGuestCheckIns } from '@/features/setu/attendance/check-in-attendance';
import { listGuestsDetailed, markGuest, type DetailedGuest } from './guests';
import { upsertPendingFamilyChild } from './pending-family';

/**
 * Does a door guest child belong on this level? Door guests carry only a grade
 * (no birthMonthYear), so only `level`/`pre-level` can match — by normalized
 * grade ∈ gradeBand. shishu/parents never auto-match a door guest (documented:
 * those visitors come in via the in-class quick-add). A blank grade never
 * matches; the teacher quick-adds it instead.
 */
export function guestMatchesLevel(
  child: { grade: string },
  level: { levelKind: LevelKind; gradeBand: string[] },
): boolean {
  if (level.levelKind !== 'level' && level.levelKind !== 'pre-level') return false;
  const g = normalizeGrade(child.grade);
  if (g === '') return false;
  return level.gradeBand.some((band) => normalizeGrade(band) === g);
}

export interface VisitorRow {
  name: string;
  grade: string;
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
  alreadyConfirmed: boolean; // a portal guest mark already exists for this family at this level+date
}

export interface VisitorsView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string | null;
  date: string;
  doorVisitors: VisitorRow[];
  confirmed: DetailedGuest[];
}

/**
 * The Visitors screen read model: the date's door guest children matched to this
 * level by grade (each flagged if their parent already claims a family that's
 * already a confirmed guest here), plus the list of guests already marked in the
 * portal for this level+date. null if the level is missing.
 */
export async function getLevelVisitorsView(levelId: string, date: string): Promise<VisitorsView | null> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(levelId).get();
  if (!levelSnap.exists) return null;
  const level = levelSnap.data() as LevelDoc;

  const [doorChildren, confirmed] = await Promise.all([
    readDoorGuestCheckIns(date),
    listGuestsDetailed(levelId, date),
  ]);
  const confirmedFids = new Set(confirmed.map((g) => g.fid));

  const matched = doorChildren.filter((c) => guestMatchesLevel(c, level));
  const doorVisitors = await Promise.all(
    matched.map(async (c): Promise<VisitorRow> => {
      let alreadyConfirmed = false;
      try {
        const keySnap = await db.collection('contactKeys').doc(hashContactKey('email', c.parentEmail)).get();
        if (keySnap.exists) {
          const fid = (keySnap.data() as { fid?: string }).fid;
          alreadyConfirmed = !!fid && confirmedFids.has(fid);
        }
      } catch {
        // a contactKey read miss just means "not yet confirmed" — never fail the view
      }
      return {
        name: c.name,
        grade: c.grade,
        parentEmail: c.parentEmail,
        parentName: c.parentName,
        phone: c.phone,
        alreadyConfirmed,
      };
    }),
  );

  return {
    levelId,
    levelName: level.levelName,
    ageLabel: level.ageLabel,
    location: level.location,
    date,
    doorVisitors,
    confirmed,
  };
}

export interface AddVisitorParams {
  levelId: string;
  date: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
  gender: 'Male' | 'Female' | 'PreferNotToSay';
  parentEmail: string | null;
  parentPhone: string | null;
  markedByUid: string;
  markedByMid: string | null;
}

export type AddVisitorResult =
  | { ok: true; fid: string; childMid: string; createdFamily: boolean; autoEnrolled: boolean; claimable: boolean }
  | { ok: false; reason: 'level-not-found' };

/**
 * Confirm a door guest or add a walk-in: upsert the pending family/child (shared
 * core; email/phone optional) then mark the child present as a guest (auto-
 * enrolls the family for the level's offering). `claimable` is false when no
 * contact was provided — the family exists but the parent can't claim it until a
 * contact is added later.
 */
export async function addVisitorOnPrompt(params: AddVisitorParams): Promise<AddVisitorResult> {
  const db = portalFirestore();
  const levelSnap = await db.collection('levels').doc(params.levelId).get();
  if (!levelSnap.exists) return { ok: false, reason: 'level-not-found' };
  const level = levelSnap.data() as LevelDoc;

  const { fid, childMid, createdFamily } = await upsertPendingFamilyChild(db, {
    levelLocation: level.location,
    firstName: params.firstName,
    lastName: params.lastName,
    schoolGrade: params.schoolGrade,
    gender: params.gender,
    parentEmail: params.parentEmail,
    parentPhone: params.parentPhone,
  });

  const guest = await markGuest({
    levelId: params.levelId,
    date: params.date,
    mid: childMid,
    status: 'present',
    markedByUid: params.markedByUid,
    markedByMid: params.markedByMid,
  });

  return {
    ok: true,
    fid,
    childMid,
    createdFamily,
    autoEnrolled: guest.ok ? guest.autoEnrolled : false,
    claimable: !!(params.parentEmail || params.parentPhone),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/visitors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/teacher/visitors.ts apps/portal/src/features/setu/teacher/__tests__/visitors.test.ts
git commit -m "feat(teacher-attendance): visitor matcher, view model, and email-optional add (T3)"
```

---

## Task 6: API routes `GET/POST /api/setu/teacher/visitors`

**Files:**
- Create: `apps/portal/src/app/api/setu/teacher/visitors/route.ts`
- Create: `apps/portal/src/app/api/setu/teacher/visitors/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSession, mockCanTeach, mockView, mockAdd } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockCanTeach: vi.fn(),
  mockView: vi.fn(),
  mockAdd: vi.fn(),
}));
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: mockSession }));
vi.mock('@/features/setu/teacher/guard', () => ({ canTeachLevel: mockCanTeach }));
vi.mock('@/features/setu/teacher/visitors', () => ({ getLevelVisitorsView: mockView, addVisitorOnPrompt: mockAdd }));

import { GET, POST } from '../route';

const teacher = { uid: 'uid-t', role: 'teacher', extraRoles: [], fid: null, mid: 'CMT-T-01' };

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockReturnValue(teacher);
  mockCanTeach.mockResolvedValue('ok');
});

function get(url: string) { return GET(new Request(url)); }
function post(body: unknown) {
  return POST(new Request('http://t/api/setu/teacher/visitors', { method: 'POST', body: JSON.stringify(body) }));
}

describe('GET /api/setu/teacher/visitors', () => {
  it('403 when not a teacher', async () => {
    mockSession.mockReturnValue({ ...teacher, role: 'family-manager' });
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04')).status).toBe(403);
  });
  it('400 on a bad date', async () => {
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=nope')).status).toBe(400);
  });
  it('404 when the level is missing', async () => {
    mockView.mockResolvedValue(null);
    expect((await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04')).status).toBe(404);
  });
  it('returns the view on success', async () => {
    mockView.mockResolvedValue({ levelId: 'L', doorVisitors: [], confirmed: [] });
    const res = await get('http://t/api/setu/teacher/visitors?levelId=L&date=2026-01-04');
    expect(res.status).toBe(200);
    expect((await res.json()).view).toMatchObject({ levelId: 'L' });
  });
});

describe('POST /api/setu/teacher/visitors', () => {
  it('403 without a teacher uid', async () => {
    mockSession.mockReturnValue(null);
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: 'A' })).status).toBe(403);
  });
  it('400 on a blank firstName', async () => {
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: '   ' })).status).toBe(400);
  });
  it('403 not-your-class', async () => {
    mockCanTeach.mockResolvedValue('forbidden');
    expect((await post({ levelId: 'L', date: '2026-01-04', firstName: 'A' })).status).toBe(403);
  });
  it('adds a name-only walk-in and echoes the result', async () => {
    mockAdd.mockResolvedValue({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true, claimable: false });
    const res = await post({ levelId: 'L', date: '2026-01-04', firstName: 'Walk' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, claimable: false });
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      levelId: 'L', firstName: 'Walk', lastName: '', schoolGrade: null, parentEmail: null, parentPhone: null,
      markedByUid: 'uid-t', markedByMid: 'CMT-T-01',
    }));
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run "src/app/api/setu/teacher/visitors/__tests__/route.test.ts"`
Expected: FAIL — `../route` not found.

- [ ] **Step 3: Implement the route**

```ts
import { NextResponse } from 'next/server';
import { AddVisitorSchema, isTeacher } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelVisitorsView, addVisitorOnPrompt } from '@/features/setu/teacher/visitors';

// GET ?levelId=&date= — door guests matched to the level + confirmed guests.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }
  const url = new URL(req.url);
  const levelId = url.searchParams.get('levelId');
  const date = url.searchParams.get('date');
  if (!levelId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const access = await canTeachLevel(session, levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const view = await getLevelVisitorsView(levelId, date);
  if (!view) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  return NextResponse.json({ view });
}

// POST — confirm a door guest / add a walk-in: pending family + guest mark.
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid || !isTeacher(session)) {
    return NextResponse.json({ error: 'teacher-required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = AddVisitorSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const access = await canTeachLevel(session, data.levelId);
  if (access === 'level-not-found') return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (access === 'forbidden') return NextResponse.json({ error: 'not-your-class' }, { status: 403 });

  const result = await addVisitorOnPrompt({
    levelId: data.levelId,
    date: data.date,
    firstName: data.firstName,
    lastName: data.lastName,
    schoolGrade: data.schoolGrade,
    gender: data.gender,
    parentEmail: data.parentEmail,
    parentPhone: data.parentPhone,
    markedByUid: session.uid,
    markedByMid: session.mid,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });

  return NextResponse.json({
    fid: result.fid,
    childMid: result.childMid,
    createdFamily: result.createdFamily,
    autoEnrolled: result.autoEnrolled,
    claimable: result.claimable,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run "src/app/api/setu/teacher/visitors/__tests__/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Add the canAccessRoute coverage test** (proves the new path is gated by the teacher catch-all — no rule change)

In `packages/shared-domain/src/auth/__tests__/can-access-route.test.ts`, add:

```ts
it('gates /api/setu/teacher/visitors via the teacher catch-all', () => {
  const teacher = { role: 'teacher', extraRoles: [] } as Parameters<typeof canAccessRoute>[0];
  const family = { role: 'family-manager', extraRoles: [] } as Parameters<typeof canAccessRoute>[0];
  expect(canAccessRoute(teacher, '/api/setu/teacher/visitors', 'POST')).toBe(true);
  expect(canAccessRoute(family, '/api/setu/teacher/visitors', 'GET')).toBe(false);
});
```
(Match the existing call signature/import style in that test file; adjust the claim-object shape to whatever the existing tests use.)

- [ ] **Step 6: Run the canAccessRoute test**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/auth/__tests__/can-access-route.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/portal/src/app/api/setu/teacher/visitors" "packages/shared-domain/src/auth/__tests__/can-access-route.test.ts"
git commit -m "feat(teacher-attendance): GET/POST /api/setu/teacher/visitors (T3)"
```

---

## Task 7: Visitors panel UI + page + repoint links + delete legacy

**Files:**
- Create: `apps/portal/src/features/setu/teacher/components/visitors-panel.tsx`
- Create: `apps/portal/src/app/teacher/levels/[levelId]/visitors/page.tsx`
- Create: `apps/portal/src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx`
- Modify: `apps/portal/src/features/setu/teacher/components/attendance-marker.tsx` (repoint 2 links)
- Delete: `apps/portal/src/app/teacher/levels/[levelId]/guests/page.tsx`, `apps/portal/src/features/setu/teacher/components/guest-list.tsx`, and `guest-list.test.tsx` if present

- [ ] **Step 1: Write the failing component test** (`visitors-panel.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisitorsPanel } from '../visitors-panel';

vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const VIEW = {
  levelId: 'L', levelName: 'Level 1', ageLabel: 'Grade 1', location: 'Brampton', date: '2026-01-04',
  doorVisitors: [
    { name: 'Arjun X', grade: '1', parentEmail: 'mom@x.com', parentName: 'Mom', phone: '416', alreadyConfirmed: false },
    { name: 'Ravi Y', grade: '1', parentEmail: 'dad@y.com', parentName: null, phone: null, alreadyConfirmed: true },
  ],
  confirmed: [{ mid: 'F-02', fid: 'CMT-F', firstName: 'Sita', lastName: 'Z', status: 'present' }],
};

function mockGetView() {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ view: VIEW }) });
}

describe('VisitorsPanel', () => {
  it('loads and shows door visitors, marking already-confirmed ones', async () => {
    mockGetView();
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    expect(await screen.findByText('Arjun X')).toBeInTheDocument();
    expect(screen.getByText('Ravi Y')).toBeInTheDocument();
    expect(screen.getByText('Sita Z')).toBeInTheDocument(); // confirmed list
  });

  it('quick-adds a walk-in with name only and refetches', async () => {
    mockGetView(); // initial load
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, claimable: false }) }); // POST
    mockGetView(); // refetch after add

    await userEvent.type(screen.getByPlaceholderText(/first name/i), 'Walk');
    await userEvent.click(screen.getByRole('button', { name: /add visitor/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ levelId: 'L', date: '2026-01-04', firstName: 'Walk' });
    });
  });

  it('blocks an empty-name quick-add', async () => {
    mockGetView();
    const { toast } = await import('@cmt/ui');
    render(<VisitorsPanel levelId="L" levelName="Level 1" date="2026-01-04" />);
    await screen.findByText('Arjun X');
    await userEvent.click(screen.getByRole('button', { name: /add visitor/i }));
    expect(toast.error).toHaveBeenCalled();
    // no POST fired
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run "src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx"`
Expected: FAIL — `../visitors-panel` not found.

- [ ] **Step 3: Implement `visitors-panel.tsx`** (mobile-first; matches `attendance-marker.tsx` tokens/structure; designer refines in Task 8)

```tsx
'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';

interface VisitorRow {
  name: string;
  grade: string;
  parentEmail: string;
  parentName: string | null;
  phone: string | null;
  alreadyConfirmed: boolean;
}
interface ConfirmedRow {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  status: string;
}
interface VisitorsView {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string | null;
  date: string;
  doorVisitors: VisitorRow[];
  confirmed: ConfirmedRow[];
}

interface VisitorsPanelProps {
  levelId: string;
  levelName: string;
  date: string;
}

/** "Arjun Sharma" → { first: "Arjun", last: "Sharma" }; "Arjun" → { first, last:"" } */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  const first = parts.shift() ?? '';
  return { first, last: parts.join(' ') };
}

const field: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radiusSm)',
  border: '1px solid var(--line2)',
  background: 'var(--bg)',
  fontSize: 14,
  fontFamily: 'var(--body)',
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 44,
};

export function VisitorsPanel({ levelId, levelName, date }: VisitorsPanelProps) {
  const [view, setView] = useState<VisitorsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [grade, setGrade] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/setu/teacher/visitors?levelId=${encodeURIComponent(levelId)}&date=${date}`);
      if (res.ok) setView(((await res.json()).view as VisitorsView) ?? null);
    } finally {
      setLoading(false);
    }
  }, [levelId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  function submitAdd(payload: {
    firstName: string;
    lastName: string;
    schoolGrade: string | null;
    parentEmail: string | null;
    parentPhone: string | null;
  }) {
    startTransition(async () => {
      try {
        const res = await fetch('/api/setu/teacher/visitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ levelId, date, ...payload }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j.error === 'not-your-class' ? 'Not your class' : 'Could not add visitor');
          return;
        }
        const j = await res.json();
        toast.success(
          j.claimable
            ? 'Visitor marked present. The parent can sign in with that contact to manage the family.'
            : 'Visitor marked present. Add a parent contact later so they can claim the family.',
        );
        setFirst(''); setLast(''); setGrade(''); setEmail(''); setPhone('');
        await load();
      } catch {
        toast.error('Network error — please try again.');
      }
    });
  }

  function onQuickAdd(ev: React.FormEvent) {
    ev.preventDefault();
    if (!first.trim()) {
      toast.error('Enter at least the visitor’s first name.');
      return;
    }
    submitAdd({
      firstName: first.trim(),
      lastName: last.trim(),
      schoolGrade: grade.trim() || null,
      parentEmail: email.trim() || null,
      parentPhone: phone.trim() || null,
    });
  }

  function confirmDoorGuest(g: VisitorRow) {
    const { first: f, last: l } = splitName(g.name);
    submitAdd({
      firstName: f || g.name || 'Guest',
      lastName: l,
      schoolGrade: g.grade.trim() || null,
      parentEmail: g.parentEmail || null,
      parentPhone: g.phone || null,
    });
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <header style={{ marginBottom: 18 }}>
        <Link href={`/teacher/levels/${levelId}/attendance?date=${date}`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none', fontWeight: 500 }}>
          ← Back to attendance
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 10, letterSpacing: '-0.02em', lineHeight: 1.15 }}>Visitors</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{levelName} · {date}</p>
      </header>

      {/* Quick-add a walk-in */}
      <form onSubmit={onQuickAdd} className="card" style={{ padding: 16, marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Add a visitor</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" aria-label="First name" style={field} />
          <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name (optional)" aria-label="Last name" style={field} />
        </div>
        <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Grade (optional)" aria-label="Grade" style={field} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Parent email (optional)" aria-label="Parent email" style={field} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Parent phone (optional)" aria-label="Parent phone" style={field} />
        <button type="submit" disabled={pending} className="btn btn--p" style={{ fontSize: 15, padding: '12px 20px', minHeight: 48, alignSelf: 'flex-start', opacity: pending ? 0.65 : 1 }}>
          {pending ? 'Saving…' : 'Add visitor'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Name is enough to mark a walk-in present now. A parent contact can be added later so they can claim the family.
        </p>
      </form>

      {/* Door guests matched to this class */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Checked in at the door
        </h2>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
        ) : !view || view.doorVisitors.length === 0 ? (
          <div className="card" style={{ padding: 18, color: 'var(--muted)', fontSize: 14 }}>
            No door guests match this class for {date}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {view.doorVisitors.map((g) => (
              <div key={`${g.parentEmail}:${g.name}`} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{g.name || '(unnamed)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {g.grade ? `Grade ${g.grade}` : 'Grade unknown'}{g.parentName ? ` · ${g.parentName}` : ''}
                  </div>
                </div>
                {g.alreadyConfirmed ? (
                  <span className="pill" style={{ fontSize: 12, fontWeight: 600, background: 'var(--info-soft)', color: 'var(--info-deep)' }}>✓ added</span>
                ) : (
                  <button type="button" disabled={pending} onClick={() => confirmDoorGuest(g)} className="btn btn--p" style={{ fontSize: 14, padding: '10px 16px', minHeight: 44, whiteSpace: 'nowrap' }}>
                    Confirm
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Already marked as guests in the portal */}
      {view && view.confirmed.length > 0 && (
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Marked present today
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {view.confirmed.map((c) => (
              <div key={c.mid} className="card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link href={`/teacher/students/${c.mid}`} style={{ fontSize: 14, textDecoration: 'none', color: 'var(--body-text)' }}>
                  {c.firstName} {c.lastName}
                </Link>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run "src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Create the page** (`apps/portal/src/app/teacher/levels/[levelId]/visitors/page.tsx`) — mirror the `guests/page.tsx` auth pattern, using `getLevelVisitorsView` only for `levelName`/date defaults:

```tsx
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import type { WithRole } from '@cmt/shared-domain';
import { canTeachLevel } from '@/features/setu/teacher/guard';
import { getLevelVisitorsView } from '@/features/setu/teacher/visitors';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';
import { VisitorsPanel } from '@/features/setu/teacher/components/visitors-panel';

export const metadata = { title: 'Visitors — CMT Teacher' };

export default async function VisitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ levelId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { levelId } = await params;
  const { date: dateParam } = await searchParams;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const claims = (sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null) as
    | (WithRole & { mid?: string | null })
    | null;
  if (!claims) return <p style={{ color: 'var(--err)', fontSize: 14 }}>Please sign in.</p>;

  const access = await canTeachLevel(claims, levelId);
  if (access === 'level-not-found') return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;
  if (access === 'forbidden') return <p style={{ color: 'var(--err)', fontSize: 14 }}>You’re not assigned to this class.</p>;

  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mostRecentSunday();
  const view = await getLevelVisitorsView(levelId, date);
  if (!view) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>That class doesn’t exist.</p>;

  return <VisitorsPanel levelId={view.levelId} levelName={view.levelName} date={view.date} />;
}
```

- [ ] **Step 6: Repoint the two links in `attendance-marker.tsx`**

Change both occurrences of:
```tsx
href={`/teacher/levels/${levelId}/guests?date=${date}`}
```
to:
```tsx
href={`/teacher/levels/${levelId}/visitors?date=${date}`}
```
(one in the header "Visitors →" link, one in the empty-state "Mark a visitor instead →" link).

- [ ] **Step 7: Delete the legacy guests page + island**

```bash
git rm apps/portal/src/app/teacher/levels/[levelId]/guests/page.tsx apps/portal/src/features/setu/teacher/components/guest-list.tsx
```
If a `guest-list.test.tsx` exists under `components/__tests__/`, `git rm` it too.

- [ ] **Step 8: Run the focused suites + typecheck**

Run:
```
pnpm --filter @cmt/portal exec vitest run "src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx"
pnpm --filter @cmt/portal exec tsc --noEmit
```
Expected: tests PASS; tsc clean (no dangling import of `GuestList` / `guests` page).

- [ ] **Step 9: Commit**

```bash
git add apps/portal/src/app/teacher/levels/[levelId]/visitors apps/portal/src/features/setu/teacher/components/visitors-panel.tsx apps/portal/src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx apps/portal/src/features/setu/teacher/components/attendance-marker.tsx
git add -A apps/portal/src/app/teacher/levels/[levelId]/guests apps/portal/src/features/setu/teacher/components/guest-list.tsx
git commit -m "feat(teacher-attendance): Visitors screen replaces the legacy guests page (T3)"
```

---

## Task 8: Designer pass + final review

- [ ] **Step 1: Designer pass** — dispatch the `oh-my-claudecode:designer` subagent (model: opus) on `visitors-panel.tsx` to make it mobile-first excellent AND desktop-clean, consistent with the just-shipped `attendance-marker.tsx`: traffic-signal/confirm affordances, 48px touch targets, clear "checked in at door" vs "added" states, a tidy quick-add card, generous spacing, `.csp` Cool-Mist tokens only (no invented tokens), `env(safe-area-inset-bottom)` if a fixed action is added. Constraint: keep the `data`/test hooks and the POST/GET contract intact so `visitors-panel.test.tsx` stays green. Verify every token used exists and is `.csp`-scoped.

- [ ] **Step 2: Re-run the component test after the designer pass**

Run: `pnpm --filter @cmt/portal exec vitest run "src/features/setu/teacher/components/__tests__/visitors-panel.test.tsx"`
Expected: PASS.

- [ ] **Step 3: Full pre-push gate**

Run:
```
pnpm --filter @cmt/portal lint
pnpm --filter @cmt/portal exec tsc --noEmit
pnpm --filter @cmt/portal test
pnpm --filter @cmt/shared-domain test
```
Expected: all green. Fix any unused-import / `exactOptionalPropertyTypes` issues before proceeding (do NOT skip the full `lint`).

- [ ] **Step 4: Commit any designer/lint fixes, then push**

```bash
git add -A
git commit -m "style(teacher-attendance): designer pass on the Visitors screen (T3)"
git push
```

- [ ] **Step 5: Final cross-slice code review** — dispatch `oh-my-claudecode:code-reviewer` (model: opus) over the T3 diff (Tasks 1–8). Confirm: read-only door access (no `715b8` writes, no new `715b8` index), `addStudentOnPrompt` behavior preserved, email-optional add semantics correct, role gating intact, N=2/idempotency notes documented, tokens valid. Address any HIGH/MEDIUM findings with the implementer subagent, then re-run the gate.

---

## Self-review (controller, before dispatch)

**Spec coverage** (design §"Visitor / guest-child handling" + slice T3):
- Door guests surfaced on the teacher's level, matched by grade → Tasks 1 (reader), 5 (`guestMatchesLevel` + view), 7 (UI). ✓
- In-class quick-add, name required, grade + parent email/phone optional → Tasks 2 (schema), 5 (`addVisitorOnPrompt`), 6 (route), 7 (form). ✓
- Confirm/add reuses the `addStudentOnPrompt` pending-family pattern → Task 3 (shared core), 5. ✓
- Email-optional (relaxed required-email) incl. un-claimable family when no contact → Tasks 2, 3 (no-key path), 5 (`claimable`). ✓
- Writes `attendanceEvents` with `isGuest:true` + first-attendance auto-enroll → reuses `markGuest` (Tasks 3, 5). ✓
- Index-free door read (no `715b8` index) → Task 1 (list + point-read, mirrors the door app). ✓
- `canAccessRoute` auto-covers the new path → Task 6 Step 5 test. ✓
- Mobile-first, on-theme, designer pass → Tasks 7, 8. ✓
- "Rework the guests/add-student UX into the new screen" → Task 7 replaces `/guests` + `guest-list.tsx` with `/visitors` + `visitors-panel.tsx`. ✓

**Placeholder scan:** every code step contains full code; no TBD/TODO except the documented deliberate one (legacy add-student route retained as mobile/legacy surface). ✓

**Type consistency:** `DoorGuestChild` (Task 1) ⇄ `readDoorGuestCheckIns` consumer in `visitors.ts` (Task 5: `{name, grade, parentEmail, parentName, phone}`). ✓ `PendingChildParams` (Task 3) ⇄ both callers (Tasks 3, 5). ✓ `AddVisitorParams`/`AddVisitorResult` (Task 5) ⇄ route (Task 6) ⇄ `AddVisitorSchema` fields (Task 2: `firstName,lastName,schoolGrade,gender,parentEmail,parentPhone`). ✓ `VisitorsView`/`VisitorRow`/`DetailedGuest` (Tasks 4,5) ⇄ panel props (Task 7). ✓ Route GET returns `{view}`; panel reads `(json).view`. ✓

**N=2 / idempotency:** double-confirm of the same door guest is guarded in the view (`alreadyConfirmed` via the parent-email contactKey → already-confirmed fid) + the client disabling the button while `pending`. Residual rapid-double-tap risk documented; not a data-corruption path for v1. (Family-facing N=2/programKey safety belongs to T4, not T3.)

## Known follow-ups (not this slice)
- Converge the legacy `add-student` route/UI fully into `/visitors` once proven (then delete `add-student.ts` + route + `AddStudentSchema`).
- T4 — family-facing union (dashboard + child profile read the unified resolver).
- Manual UAT walkthrough (agent can't OTP sign-in): teacher opens `/teacher/levels/[id]/visitors`, sees door guests matched by grade, confirms one, quick-adds a name-only walk-in, verifies both land as guests + the family is created/claimable as expected.

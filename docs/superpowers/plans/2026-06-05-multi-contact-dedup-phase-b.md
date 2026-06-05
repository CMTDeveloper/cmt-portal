# Multi-Contact Household Dedup — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen each household's contacts-on-file beyond registration — let the find screen search across many entered contacts (read-only), let a signed-in member OTP-verify and add their own extra emails/phones, and nudge existing families once after sign-in to do so — so a later lookup with any of a person's contacts resolves the existing family instead of starting a duplicate.

**Architecture:** Builds on Phase A (each member already gets a `contactKey` per email/phone at registration). Phase B adds (0) additive data-model fields (`MemberDoc.altEmails/altPhones/contactsNudgeDismissedAt`, contactKey `source/verifiedAt`); (B1) a multi-contact, no-auth find-screen search backed by a generalized `lookupFamilyByContacts` + an array-accepting `family-lookup` API; (B2) two new authenticated OTP routes (`/api/setu/contacts/send-code` + `/verify-code`) reusing the existing verification-codes store + AWS SES/SNS senders + rate-limiter, writing a `source:'self-verified'` contactKey + appending plaintext to the member's `altEmails/altPhones` inside an anti-theft transaction, driven by a new `/family/settings/contacts` surface via a client fetch wrapper; (B3) a one-time dismissible post-sign-in nudge on the family dashboard, persisted via `MemberDoc.contactsNudgeDismissedAt` through a new dedicated dismiss route.

**Tech Stack:** Next.js 16 App Router (route handlers + a client settings page), React, Firebase Admin Firestore (transactions), Zod, AWS SES/SNS (via `resolveSender()`), Vitest + Testing Library + `userEvent`, TypeScript with `exactOptionalPropertyTypes`.

**Spec:** docs/superpowers/specs/2026-06-04-multi-contact-household-dedup-design.md

---

## Scope notes (read before starting)

- **Phase A is shipped.** `/register/family` captures each member's single email+phone; `registerFamily` writes a contactKey per member contact (currently with no `source` field); `lookupFamilyByContacts(email, phone)` already matches on EITHER contact. Do NOT re-do Phase A.
- **No new Firestore index needed.** Every contactKey access in Phase B is a single doc read by id (`contactKeys/{hash}`) — the dedup index is doc-id-keyed by hash, not a collectionGroup query. The B2 anti-theft check is `txn.get(db.collection('contactKeys').doc(hash))`. Do not add a `firestore.indexes.json` entry; there is no range/collectionGroup query introduced here. (If a future task adds a `where()`/collectionGroup query over contactKeys, THAT task must add the index — none in this plan does.)
- **`exactOptionalPropertyTypes` is on.** Never assign `undefined` to an optional field. Use conditional-spread `...(x ? { x } : {})`. New schema fields use `.default([])` / `.optional()` (additive — existing docs parse).
- **`canAccessRoute` `/api/setu/*` catch-all is manager-only.** The two new B2 routes (`/api/setu/contacts/send-code`, `/api/setu/contacts/verify-code`) AND the B3 dismiss route (`/api/setu/contacts/dismiss-nudge`) must each be explicitly opened to any signed-in family role (`isSetuFamily`) BEFORE the catch-all, or a `family-member` is denied at the middleware layer.
- **Client/server boundary.** The `/family/settings/contacts` page is `'use client'`. It must NOT import `getCurrentFamily` (uses `next/headers` + firebase-admin). It reads identity via the existing `getCurrentFamilyClient()` wrapper and calls the new routes via a new side-effect-free `contacts-client.ts` wrapper. Mock the wrapper in component tests, not the server fns.
- **Commit author** is preconfigured (`CMT Developer`). Do NOT push — the controller pushes. Never `--no-verify`.
- **DB ops target UAT only** (`chinmaya-setu-uat`). The final manual walkthrough (Task B4) runs against UAT.

## File structure

| File | Responsibility |
|------|----------------|
| `packages/shared-domain/src/setu/schemas/member.ts` | **(G0)** Add `altEmails`/`altPhones` (default `[]`) + `contactsNudgeDismissedAt` (nullable, optional) to `MemberDocSchema`. |
| `apps/portal/src/features/setu/auth/find-family-by-contact.ts` | **(G0)** Add `source`/`verifiedAt` to `SetuContactKeyDoc` (optional — read with defaults). |
| `apps/portal/src/features/setu/members/get-family-by-fid.ts` | **(G0)** Default the new array/nudge fields in the manual member mapper. |
| `apps/portal/src/features/setu/registration/family-lookup.ts` | **(B1)** Generalize `lookupFamilyByContacts` to accept a contact list (keep back-compat `(email, phone)`); extract `lookupFamilyByContactList`. |
| `apps/portal/src/app/api/setu/family-lookup/route.ts` | **(B1)** Accept `{ emails: string[]; phones: string[] }` AND legacy `{ email, phone }`. |
| `apps/portal/src/app/register/page.tsx` | **(B1)** Add "+ add another email / phone" affordance in `RegisterReal`; lookup runs across all entered contacts. |
| `apps/portal/src/features/setu/contacts/add-verified-contact.ts` | **(B2)** New: the anti-theft transaction that writes the `self-verified` contactKey + appends to `altEmails`/`altPhones`. |
| `apps/portal/src/app/api/setu/contacts/send-code/route.ts` | **(B2)** New: authenticated OTP send to a NEW contact. |
| `apps/portal/src/app/api/setu/contacts/verify-code/route.ts` | **(B2)** New: authenticated OTP verify → `addVerifiedContact`. |
| `apps/portal/src/features/setu/contacts/contacts-client.ts` | **(B2)** New: client fetch wrappers (`sendContactCode`, `verifyContactCode`, `dismissContactsNudge`). |
| `apps/portal/src/app/family/settings/contacts/page.tsx` | **(B2)** New: "My contacts" client surface (list + add-and-verify flow). |
| `packages/shared-domain/src/auth/can-access-route.ts` | **(B2/B3)** Open the three new `/api/setu/contacts/*` routes to `isSetuFamily`. |
| `apps/portal/src/app/api/setu/contacts/dismiss-nudge/route.ts` | **(B3)** New: set `contactsNudgeDismissedAt` on the current member. |
| `apps/portal/src/features/family/components/contacts-nudge.tsx` | **(B3)** New: dismissible one-time nudge banner (`'use client'`). |
| `apps/portal/src/app/family/page.tsx` | **(B3)** Render the nudge once when `currentMember.contactsNudgeDismissedAt` is null. |

Tests live next to each file under `__tests__/` (paths given per task).

---

# Group 0 — Data-model foundation

Additive + optional fields so every existing doc still parses. These ship first so B1–B3 build on a stable shape. Repo memory: Zod silently strips unknown fields — the schema MUST include the new fields or writes are lost.

## Task G0.1: Add altEmails / altPhones / contactsNudgeDismissedAt to MemberDocSchema

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/member.ts`
- Test: `packages/shared-domain/src/setu/schemas/__tests__/member.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `packages/shared-domain/src/setu/schemas/__tests__/member.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MemberDocSchema } from '../member';

const base = {
  mid: 'CMT-AB12CD34-02',
  uid: null,
  firstName: 'Priya',
  lastName: 'Patel',
  type: 'Adult' as const,
  gender: 'Female' as const,
  manager: false,
  joinedAt: new Date(),
  email: 'priya@example.com',
  phone: '+14165550199',
  schoolGrade: null,
  birthMonthYear: null,
  volunteeringSkills: [],
  foodAllergies: null,
  emergencyContacts: [null, null] as [unknown, unknown],
};

describe('MemberDocSchema — multi-contact fields', () => {
  it('defaults altEmails/altPhones to [] when absent (existing docs)', () => {
    const parsed = MemberDocSchema.parse(base);
    expect(parsed.altEmails).toEqual([]);
    expect(parsed.altPhones).toEqual([]);
    expect(parsed.contactsNudgeDismissedAt ?? null).toBeNull();
  });

  it('preserves provided altEmails/altPhones and a dismissed timestamp', () => {
    const parsed = MemberDocSchema.parse({
      ...base,
      altEmails: ['priya.work@example.com'],
      altPhones: ['+14165550200'],
      contactsNudgeDismissedAt: new Date('2026-06-05T00:00:00Z'),
    });
    expect(parsed.altEmails).toEqual(['priya.work@example.com']);
    expect(parsed.altPhones).toEqual(['+14165550200']);
    expect(parsed.contactsNudgeDismissedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain vitest run src/setu/schemas/__tests__/member.test.ts`
Expected: FAIL — `parsed.altEmails` is `undefined` (the schema has no such field yet).

- [ ] **Step 3: Add the fields**

In `packages/shared-domain/src/setu/schemas/member.ts`, inside the `MemberDocSchema` object, immediately AFTER the `phone: z.string().nullable(),` line (line 19), add:

```ts
  // Plaintext alternate contacts for display/management in "My contacts".
  // contactKeys store only hashes, so the readable values must live here.
  // Invariant: every value here has a matching contactKey → this member's mid.
  altEmails: z.array(z.string()).default([]),
  altPhones: z.array(z.string()).default([]),
  // One-time post-sign-in "add your other contacts" nudge. Null/absent =
  // not yet dismissed (show it); a Date = dismissed (never show again).
  contactsNudgeDismissedAt: z.date().nullable().optional(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain vitest run src/setu/schemas/__tests__/member.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/member.ts packages/shared-domain/src/setu/schemas/__tests__/member.test.ts
git commit -m "feat(shared-domain): MemberDoc gains altEmails/altPhones + contactsNudgeDismissedAt (multi-contact dedup G0)"
```

---

## Task G0.2: Add source / verifiedAt to SetuContactKeyDoc

**Files:**
- Modify: `apps/portal/src/features/setu/auth/find-family-by-contact.ts`
- Test: `apps/portal/src/features/setu/auth/__tests__/contact-key-doc-type.test.ts` (create)

This is a pure type addition (the interface is read, not validated by Zod). The test is a compile-time-style guard that a `self-verified` doc shape is assignable.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/auth/__tests__/contact-key-doc-type.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SetuContactKeyDoc } from '../find-family-by-contact';

describe('SetuContactKeyDoc — source/verifiedAt', () => {
  it('accepts a self-verified contactKey shape', () => {
    const doc: SetuContactKeyDoc = {
      contactKey: 'abc',
      type: 'email',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      source: 'self-verified',
      verifiedAt: new Date(),
    };
    expect(doc.source).toBe('self-verified');
    expect(doc.verifiedAt).toBeInstanceOf(Date);
  });

  it('accepts a registration contactKey with no source/verifiedAt (legacy doc)', () => {
    const doc: SetuContactKeyDoc = {
      contactKey: 'abc',
      type: 'phone',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-01',
    };
    expect(doc.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/auth/__tests__/contact-key-doc-type.test.ts`
Expected: FAIL — TypeScript errors: `source`/`verifiedAt` do not exist on `SetuContactKeyDoc`.

- [ ] **Step 3: Add the optional fields**

In `apps/portal/src/features/setu/auth/find-family-by-contact.ts`, replace the `SetuContactKeyDoc` interface (lines 5-10):

```ts
export interface SetuContactKeyDoc {
  contactKey: string;
  type: 'email' | 'phone';
  fid: string;
  mid: string;
  // Audit/security on newer writes. Absent on registration-era + pre-Phase-B
  // docs (read with safe defaults). 'self-verified' contacts carry verifiedAt.
  source?: 'registration' | 'self-verified';
  verifiedAt?: Date | null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/auth/__tests__/contact-key-doc-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/auth/find-family-by-contact.ts apps/portal/src/features/setu/auth/__tests__/contact-key-doc-type.test.ts
git commit -m "feat(setu/auth): SetuContactKeyDoc gains optional source/verifiedAt (multi-contact dedup G0)"
```

---

## Task G0.3: Default the new member fields in getFamilyByFid's mapper

`getFamilyByFid` builds `MemberDoc` objects manually from raw Firestore data (it does not run them through `MemberDocSchema`). Without an explicit default, `member.altEmails` would be `undefined` at runtime and break the "My contacts" list + the nudge gate.

**Files:**
- Modify: `apps/portal/src/features/setu/members/get-family-by-fid.ts`
- Test: `apps/portal/src/features/setu/members/__tests__/get-family-by-fid.test.ts` (create if absent — see Step 1 for the mock pattern)

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/members/__tests__/get-family-by-fid.test.ts` (mocks Firestore + the cache directives so the function runs in the test harness):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cacheTag: vi.fn(),
  unstable_cacheLife: vi.fn(),
}));

const mockFamilyGet = vi.fn();
const mockMembersGet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({
      doc: () => ({
        get: mockFamilyGet,
        collection: () => ({ get: mockMembersGet }),
      }),
    }),
  }),
}));

import { getFamilyByFid } from '../get-family-by-fid';

beforeEach(() => {
  vi.clearAllMocks();
  mockFamilyGet.mockResolvedValue({
    exists: true,
    data: () => ({
      fid: 'CMT-AB12CD34',
      legacyFid: null,
      name: 'Patel',
      location: 'Brampton',
      createdAt: { toDate: () => new Date() },
      managers: ['CMT-AB12CD34-01'],
      searchKeys: ['patel'],
    }),
  });
});

describe('getFamilyByFid — multi-contact defaults', () => {
  it('defaults altEmails/altPhones to [] and contactsNudgeDismissedAt to null', async () => {
    mockMembersGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            mid: 'CMT-AB12CD34-01',
            firstName: 'Raj',
            lastName: 'Patel',
            type: 'Adult',
            gender: 'Male',
            manager: true,
            joinedAt: { toDate: () => new Date() },
            email: 'raj@example.com',
            phone: '+14165551234',
            // NOTE: no altEmails / altPhones / contactsNudgeDismissedAt on this
            // (pre-Phase-B) doc.
          }),
        },
      ],
    });

    const result = await getFamilyByFid('CMT-AB12CD34');
    const member = result!.members[0]!;
    expect(member.altEmails).toEqual([]);
    expect(member.altPhones).toEqual([]);
    expect(member.contactsNudgeDismissedAt).toBeNull();
  });

  it('passes through stored altEmails/altPhones and a dismissed timestamp', async () => {
    const dismissed = new Date('2026-06-05T00:00:00Z');
    mockMembersGet.mockResolvedValue({
      docs: [
        {
          data: () => ({
            mid: 'CMT-AB12CD34-02',
            firstName: 'Priya',
            lastName: 'Patel',
            type: 'Adult',
            gender: 'Female',
            manager: false,
            joinedAt: { toDate: () => new Date() },
            email: 'priya@example.com',
            phone: null,
            altEmails: ['priya.work@example.com'],
            altPhones: ['+14165550200'],
            contactsNudgeDismissedAt: { toDate: () => dismissed },
          }),
        },
      ],
    });

    const result = await getFamilyByFid('CMT-AB12CD34');
    const member = result!.members[0]!;
    expect(member.altEmails).toEqual(['priya.work@example.com']);
    expect(member.altPhones).toEqual(['+14165550200']);
    expect(member.contactsNudgeDismissedAt).toEqual(dismissed);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/members/__tests__/get-family-by-fid.test.ts`
Expected: FAIL — `member.altEmails` is `undefined` (the mapper omits it).

- [ ] **Step 3: Default the fields in the mapper**

In `apps/portal/src/features/setu/members/get-family-by-fid.ts`, inside the `membersSnap.docs.map(...)` return object (lines 38-55), add these three lines immediately AFTER `phone: d.phone ?? null,` (line 48):

```ts
      altEmails: d.altEmails ?? [],
      altPhones: d.altPhones ?? [],
      contactsNudgeDismissedAt: d.contactsNudgeDismissedAt?.toDate?.() ?? null,
```

(`d.contactsNudgeDismissedAt` is a Firestore `Timestamp` when present; `?.toDate?.()` safely handles both Timestamp and absent. `?? null` keeps it `null`, never `undefined` — `exactOptionalPropertyTypes`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/members/__tests__/get-family-by-fid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/members/get-family-by-fid.ts apps/portal/src/features/setu/members/__tests__/get-family-by-fid.test.ts
git commit -m "feat(setu/members): default altEmails/altPhones/contactsNudgeDismissedAt in getFamilyByFid (multi-contact dedup G0)"
```

---

# Group B1 — find-screen multi-contact search (read-only, no auth)

A wider search only. No DB writes, no auth, no association — you are searching, not claiming. Catches "my primary isn't on file but my secondary is."

## Task B1.1: Generalize lookupFamilyByContacts to a contact list

Add `lookupFamilyByContactList(contacts)` that hashes each contact, reads the contactKeys, and returns the first family hit. Keep the existing `lookupFamilyByContacts(email, phone)` working (back-compat — it delegates to the list version). The family-summary build (memberCount, managerInitials) is unchanged, extracted into a helper.

**Files:**
- Modify: `apps/portal/src/features/setu/registration/family-lookup.ts`
- Test: `apps/portal/src/features/setu/registration/__tests__/family-lookup.test.ts` (create if absent — Step 1 has the mock pattern)

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/registration/__tests__/family-lookup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hash each contact deterministically so the test can target a specific key.
vi.mock('../hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const contactKeyDocs = new Map<string, { fid: string }>();
const familyDocs = new Map<string, Record<string, unknown>>();
const memberDocs = new Map<string, { firstName: string; lastName: string }>();

function fakeDb() {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'contactKeys') {
            return contactKeyDocs.has(id)
              ? { exists: true, data: () => contactKeyDocs.get(id) }
              : { exists: false };
          }
          if (name === 'families') {
            return familyDocs.has(id)
              ? { exists: true, data: () => familyDocs.get(id) }
              : { exists: false };
          }
          return { exists: false };
        },
        collection: () => ({
          get: async () => ({ size: 3 }),
          doc: (mid: string) => ({
            get: async () =>
              memberDocs.has(mid)
                ? { exists: true, data: () => memberDocs.get(mid) }
                : { exists: false },
          }),
        }),
      }),
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => fakeDb(),
}));

import { lookupFamilyByContacts, lookupFamilyByContactList } from '../family-lookup';

beforeEach(() => {
  contactKeyDocs.clear();
  familyDocs.clear();
  memberDocs.clear();
  familyDocs.set('CMT-AB12CD34', {
    name: 'Patel',
    location: 'Brampton',
    managers: ['CMT-AB12CD34-01'],
  });
  memberDocs.set('CMT-AB12CD34-01', { firstName: 'Raj', lastName: 'Patel' });
});

describe('lookupFamilyByContactList', () => {
  it('returns the family when ANY one contact hits (the 2nd of several)', async () => {
    contactKeyDocs.set('hash:phone:+14165550200', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'not-on-file@example.com' },
      { type: 'phone', value: '+14165550200' },
    ]);
    expect(match?.fid).toBe('CMT-AB12CD34');
    expect(match?.name).toBe('Patel');
    expect(match?.managerInitials).toBe('R.P.');
  });

  it('returns null when no contact hits', async () => {
    const match = await lookupFamilyByContactList([
      { type: 'email', value: 'a@example.com' },
      { type: 'email', value: 'b@example.com' },
    ]);
    expect(match).toBeNull();
  });

  it('ignores blank/whitespace contacts', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContactList([
      { type: 'email', value: '   ' },
      { type: 'email', value: 'raj@example.com' },
    ]);
    expect(match?.fid).toBe('CMT-AB12CD34');
  });
});

describe('lookupFamilyByContacts (back-compat)', () => {
  it('still resolves a family from a single email+phone pair', async () => {
    contactKeyDocs.set('hash:email:raj@example.com', { fid: 'CMT-AB12CD34' });
    const match = await lookupFamilyByContacts('raj@example.com', '4165551234');
    expect(match?.fid).toBe('CMT-AB12CD34');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/registration/__tests__/family-lookup.test.ts`
Expected: FAIL — `lookupFamilyByContactList` is not exported.

- [ ] **Step 3: Implement the generalized lookup**

Replace the entire body of `apps/portal/src/features/setu/registration/family-lookup.ts` with:

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

export interface FamilySummary {
  fid: string;
  name: string;
  location: string;
  memberCount: number;
  managerInitials: string;
}

export interface ContactInput {
  type: 'email' | 'phone';
  value: string;
}

async function buildFamilySummary(fid: string): Promise<FamilySummary | null> {
  const db = portalFirestore();
  const familySnap = await db.collection('families').doc(fid).get();
  if (!familySnap.exists) return null;

  const family = familySnap.data() as {
    name: string;
    location: string;
    managers: string[];
  };

  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const memberCount = membersSnap.size;

  let managerInitials = '';
  const firstManagerId = family.managers[0];
  if (firstManagerId) {
    const managerSnap = await db
      .collection('families')
      .doc(fid)
      .collection('members')
      .doc(firstManagerId)
      .get();
    if (managerSnap.exists) {
      const m = managerSnap.data() as { firstName: string; lastName: string };
      managerInitials = `${m.firstName[0] ?? ''}.${m.lastName[0] ?? ''}.`;
    }
  }

  return {
    fid,
    name: family.name,
    location: family.location,
    memberCount,
    managerInitials,
  };
}

// Search across many contacts. Hash each non-blank contact, read the
// contactKeys, and return the first family hit. Pure read — no auth, no writes
// (you're searching, not associating). Blank/whitespace contacts are skipped.
export async function lookupFamilyByContactList(
  contacts: ContactInput[],
): Promise<FamilySummary | null> {
  const db = portalFirestore();
  const valid = contacts.filter((c) => c.value.trim() !== '');
  if (valid.length === 0) return null;

  const snaps = await Promise.all(
    valid.map((c) => db.collection('contactKeys').doc(hashContactKey(c.type, c.value)).get()),
  );

  const hit = snaps.find((s) => s.exists);
  if (!hit) return null;

  const { fid } = hit.data() as { fid: string };
  return buildFamilySummary(fid);
}

// Back-compat: the original single email+phone signature still works.
export async function lookupFamilyByContacts(
  email: string,
  phone: string,
): Promise<FamilySummary | null> {
  return lookupFamilyByContactList([
    { type: 'email', value: email },
    { type: 'phone', value: phone },
  ]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/registration/__tests__/family-lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/registration/family-lookup.ts apps/portal/src/features/setu/registration/__tests__/family-lookup.test.ts
git commit -m "feat(setu/registration): lookupFamilyByContactList — match across many contacts (back-compat preserved) (B1)"
```

---

## Task B1.2: Accept arrays in POST /api/setu/family-lookup

Body becomes `{ emails: string[]; phones: string[] }`, still accepting legacy `{ email, phone }`. Rate-limit unchanged (misses still consume quota — anti-enumeration).

**Files:**
- Modify: `apps/portal/src/app/api/setu/family-lookup/route.ts`
- Test: `apps/portal/src/app/api/setu/family-lookup/__tests__/route.test.ts`

- [ ] **Step 1: Update the existing back-compat test + add the array test**

The existing test at line 87 asserts `lookupFamilyByContacts` is called with `('raj@example.com', '4165551234')`. The route now calls the list version. Update that mock + assertion and add an array-body case. In `apps/portal/src/app/api/setu/family-lookup/__tests__/route.test.ts`:

Change the mock block (lines 8-10) to also expose the list fn:

```ts
vi.mock('@/features/setu/registration/family-lookup', () => ({
  lookupFamilyByContacts: vi.fn(),
  lookupFamilyByContactList: vi.fn(),
}));
```

Change the import (line 14):

```ts
import { lookupFamilyByContactList } from '@/features/setu/registration/family-lookup';
```

Change the `beforeEach` default (line 27):

```ts
  (lookupFamilyByContactList as ReturnType<typeof vi.fn>).mockResolvedValue(null);
```

Replace the `'calls lookupFamilyByContacts with email and phone from request'` test (lines 85-88) with:

```ts
  it('maps legacy { email, phone } body to a contact list', async () => {
    await POST(makeRequest({ email: 'raj@example.com', phone: '4165551234' }));
    expect(lookupFamilyByContactList).toHaveBeenCalledWith([
      { type: 'email', value: 'raj@example.com' },
      { type: 'phone', value: '4165551234' },
    ]);
  });

  it('accepts { emails, phones } arrays and forwards every contact', async () => {
    await POST(makeRequest({
      emails: ['a@example.com', 'b@example.com'],
      phones: ['4165550000', '4165550001'],
    }));
    expect(lookupFamilyByContactList).toHaveBeenCalledWith([
      { type: 'email', value: 'a@example.com' },
      { type: 'email', value: 'b@example.com' },
      { type: 'phone', value: '4165550000' },
      { type: 'phone', value: '4165550001' },
    ]);
  });

  it('returns 400 when neither legacy pair nor arrays are present', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });
```

The other existing tests (`returns 200 with match summary`, `returns 429`, rate-limit bucket, flag-off) still pass with a legacy body — leave them. They reference `lookupFamilyByContacts`; switch those that assert behavior on the resolved value to set `lookupFamilyByContactList`'s mock instead. Specifically, in `'returns 200 with match=null when no family found'` (line 58) and `'returns 200 with match summary when family found'` (line 66), change `lookupFamilyByContacts` → `lookupFamilyByContactList`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/family-lookup/__tests__/route.test.ts`
Expected: FAIL — the route still imports/calls `lookupFamilyByContacts` and rejects the `{ emails, phones }` body (current schema requires `email`+`phone`).

- [ ] **Step 3: Update the route**

Replace the entire body of `apps/portal/src/app/api/setu/family-lookup/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit, LOOKUP_RATE_LIMIT_MAX } from '@/features/check-in/shared';
import {
  lookupFamilyByContactList,
  type ContactInput,
} from '@/features/setu/registration/family-lookup';

// Accept BOTH the new array body and the legacy single email+phone body.
// Every field is optional at the schema layer; we require at least one usable
// contact below (a stricter 400 than zod can express across the two shapes).
const bodySchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  emails: z.array(z.string()).optional(),
  phones: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { email, phone, emails, phones } = parsed.data;

  const contacts: ContactInput[] = [
    ...(emails ?? (email ? [email] : [])).map((value) => ({ type: 'email' as const, value })),
    ...(phones ?? (phone ? [phone] : [])).map((value) => ({ type: 'phone' as const, value })),
  ].filter((c) => c.value.trim() !== '');

  if (contacts.length === 0) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  // Rate-limit by IP — misses still consume quota (anti-enumeration).
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rate = await checkAndRecordOtpRateLimit(`family-lookup:${ip}`, LOOKUP_RATE_LIMIT_MAX);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const match = await lookupFamilyByContactList(contacts);

  return NextResponse.json({ match }, { status: 200 });
}
```

> Note: the legacy tests at lines 31/36/41 (`returns 400 on missing email/phone`, `invalid email format`) change meaning. With the new schema, `{ phone: '...' }` alone is now a VALID lookup (one phone contact), so `'returns 400 on missing email'` and `'returns 400 on missing phone'` no longer hold and must be removed or rewritten. Rewrite them as: `it('accepts a phone-only legacy body', ...)` expecting 200, and `it('accepts an email-only legacy body', ...)` expecting 200. Delete `'returns 400 on invalid email format'` — the lookup no longer validates email format (it hashes whatever it gets; a malformed email simply never matches). Update these in Step 1's edits so the file is internally consistent before running.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/family-lookup/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/family-lookup/route.ts apps/portal/src/app/api/setu/family-lookup/__tests__/route.test.ts
git commit -m "feat(api/setu/family-lookup): accept { emails, phones } arrays; keep legacy { email, phone } (B1)"
```

---

## Task B1.3: "+ add another email / phone" on the find screen

Add up to 2 extra emails + 2 extra phones (small cap; YAGNI) under the primary fields in `RegisterReal`. The debounced lookup runs against ALL non-blank entered contacts via the array body.

**Files:**
- Modify: `apps/portal/src/app/register/page.tsx`
- Test: `apps/portal/src/app/register/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

The existing test mocks `@cmt/ui` (`SetuIcon.plus` is already provided, line 32). Append a new `describe` block at the end of `apps/portal/src/app/register/__tests__/page.test.tsx` (before the file's final close):

```ts
describe('RegisterReal — multi-contact find search', () => {
  it('sends every entered contact (primary + extras) in the array lookup body', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ match: null }) });

    const user = userEvent.setup();
    render(<RegisterPage />);

    // Primary email + phone (complete enough to fire the lookup on blur).
    const email = document.querySelector('input[type="email"]') as HTMLElement;
    const phone = document.querySelector('input[type="tel"]') as HTMLElement;
    await user.type(email, 'primary@example.com');
    await user.type(phone, '4165550000');

    // Reveal + fill one extra email.
    await user.click(screen.getByRole('button', { name: /add another email/i }));
    await user.type(screen.getByLabelText(/additional email 1/i), 'second@example.com');

    // Trigger the lookup deterministically via blur.
    await user.click(document.body);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('/api/setu/family-lookup');
      const body = JSON.parse(lastCall?.[1]?.body as string) as { emails: string[]; phones: string[] };
      expect(body.emails).toContain('primary@example.com');
      expect(body.emails).toContain('second@example.com');
      expect(body.phones).toContain('4165550000');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/register/__tests__/page.test.tsx -t "multi-contact find search"`
Expected: FAIL — there is no "Add another email" button and the body is `{ email, phone }`, not `{ emails, phones }`.

- [ ] **Step 3: Add extra-contact state + the array body**

In `apps/portal/src/app/register/page.tsx`, inside `RegisterReal` (after `const [phone, setPhone] = useState('');`, line 174), add:

```tsx
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [extraPhones, setExtraPhones] = useState<string[]>([]);
```

Replace the `runLookup` body's `fetch` call (lines 185-189) so it sends the array shape and includes the extras at call time. Change `runLookup`'s signature to read the current extras from refs-free closure by passing them in. Replace the whole `runLookup` callback (lines 181-208) with:

```tsx
  const runLookup = useCallback(
    async (emailVal: string, phoneVal: string, extraE: string[], extraP: string[]) => {
      const emails = [emailVal, ...extraE].map((s) => s.trim()).filter(Boolean);
      const phones = [phoneVal, ...extraP].map((s) => s.trim()).filter(Boolean);
      if (emails.length === 0 && phones.length === 0) return;
      setLookupState('loading');
      try {
        const res = await fetch('/api/setu/family-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails, phones }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error((body as { error?: string }).error ?? 'Lookup failed. Please try again.');
          setLookupState('idle');
          return;
        }
        const body = (await res.json()) as { match: LookupMatch | null };
        if (body.match) {
          setMatch(body.match);
          setLookupState('match');
        } else {
          setMatch(null);
          setLookupState('nomatch');
        }
      } catch {
        toast.error('Network error. Check your connection and try again.');
        setLookupState('idle');
      }
    },
    [],
  );
```

Update every `runLookup(...)` call site to pass the extras. Replace `scheduleLookup` (lines 218-231) and the handlers/blur (lines 233-251) with:

```tsx
  function scheduleLookup(emailVal: string, phoneVal: string, extraE: string[], extraP: string[]) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isCompleteEnough(emailVal, phoneVal)) {
      setLookupState('idle');
      setMatch(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runLookup(emailVal, phoneVal, extraE, extraP);
    }, 1500);
  }

  function handleEmailChange(v: string) {
    setEmail(v);
    scheduleLookup(v, phone, extraEmails, extraPhones);
  }

  function handlePhoneChange(v: string) {
    setPhone(v);
    scheduleLookup(email, v, extraEmails, extraPhones);
  }

  function handleEmailBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isCompleteEnough(email, phone)) void runLookup(email, phone, extraEmails, extraPhones);
  }

  function handlePhoneBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isCompleteEnough(email, phone)) void runLookup(email, phone, extraEmails, extraPhones);
  }

  function updateExtraEmail(i: number, v: string) {
    setExtraEmails((prev) => {
      const next = [...prev];
      next[i] = v;
      if (isCompleteEnough(email, phone)) void runLookup(email, phone, next, extraPhones);
      return next;
    });
  }

  function updateExtraPhone(i: number, v: string) {
    setExtraPhones((prev) => {
      const next = [...prev];
      next[i] = v;
      if (isCompleteEnough(email, phone)) void runLookup(email, phone, extraEmails, next);
      return next;
    });
  }
```

Update the `onClick` Continue handler (line 354) from `void runLookup(email, phone)` to `void runLookup(email, phone, extraEmails, extraPhones)`.

- [ ] **Step 4: Render the "+ add another" affordance**

In `RegisterReal`'s `formContent`, immediately AFTER the phone `div.field` block (closes line 297) and BEFORE the `{isLoading && (...)}` block (line 299), insert:

```tsx
      {extraEmails.map((val, i) => (
        <div className="field" style={{ marginBottom: 10 }} key={`xe-${i}`}>
          <label>Another email</label>
          <input
            className="input"
            type="email"
            placeholder="another@example.com"
            value={val}
            onChange={e => updateExtraEmail(i, e.target.value)}
            onBlur={handleEmailBlur}
            aria-label={`Additional email ${i + 1}`}
          />
        </div>
      ))}
      {extraPhones.map((val, i) => (
        <div className="field" style={{ marginBottom: 10 }} key={`xp-${i}`}>
          <label>Another phone</label>
          <input
            className="input"
            type="tel"
            placeholder="(416) 555-0000"
            value={val}
            onChange={e => updateExtraPhone(i, e.target.value)}
            onBlur={handlePhoneBlur}
            aria-label={`Additional phone ${i + 1}`}
          />
        </div>
      ))}
      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {extraEmails.length < 2 && (
          <button
            type="button"
            className="focus-ring"
            style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, padding: 0, cursor: 'pointer' }}
            onClick={() => setExtraEmails(prev => [...prev, ''])}
          >
            + Add another email
          </button>
        )}
        {extraPhones.length < 2 && (
          <button
            type="button"
            className="focus-ring"
            style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, padding: 0, cursor: 'pointer' }}
            onClick={() => setExtraPhones(prev => [...prev, ''])}
          >
            + Add another phone
          </button>
        )}
      </div>
      <div className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Got more than one email or phone? Add them so we can find your family even if your main one isn&apos;t on file.
      </div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/register/__tests__/page.test.tsx`
Expected: PASS — all existing register tests plus the new multi-contact one. (The prototype/flag-off path is untouched.)

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/register/page.tsx apps/portal/src/app/register/__tests__/page.test.tsx
git commit -m "feat(register): + add another email/phone on the find screen; lookup searches across all entered contacts (B1)"
```

---

# Group B2 — OTP-verified "My contacts" add

A signed-in member adds an email/phone to themselves, proving ownership via OTP. On verify: write a `contactKey(source:'self-verified', verifiedAt: now) → this member's mid` and append the plaintext to `altEmails`/`altPhones`, inside one anti-theft transaction that refuses if the contact's hash already maps to a DIFFERENT mid (any family).

## Task B2.1: The anti-theft add-verified-contact transaction

This is the security core. Extracted into a pure function so it is unit-testable with a fake transaction and reused by the verify route.

**Files:**
- Create: `apps/portal/src/features/setu/contacts/add-verified-contact.ts`
- Test: `apps/portal/src/features/setu/contacts/__tests__/add-verified-contact.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/setu/contacts/__tests__/add-verified-contact.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/setu/registration/hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const txnGet = vi.fn();
const txnSet = vi.fn();
const txnUpdate = vi.fn();
const mockRunTransaction = vi.fn();

// Each ref carries a __path string so assertions can target it. The chain
// db.collection('families').doc(fid).collection('members').doc(mid) yields
// __path = 'families/<fid>/members/<mid>'.
function makeRef(path: string): { __path: string; collection: (n: string) => { doc: (id: string) => unknown } } {
  return {
    __path: path,
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${path}/${name}/${id}`),
    }),
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${name}/${id}`),
    }),
    runTransaction: (fn: (txn: unknown) => Promise<unknown>) => mockRunTransaction(fn),
  }),
  FieldValue: {
    arrayUnion: (...vals: unknown[]) => ({ __arrayUnion: vals }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}));

import { addVerifiedContact, ContactInUseError } from '../add-verified-contact';

function runTxnWith(existingContactKey: { fid: string; mid: string } | null) {
  mockRunTransaction.mockImplementation(async (fn: (txn: unknown) => Promise<unknown>) => {
    txnGet.mockImplementation(async (ref: { __path: string }) => {
      if (ref.__path.startsWith('contactKeys/')) {
        return existingContactKey
          ? { exists: true, data: () => existingContactKey }
          : { exists: false };
      }
      // member doc
      return { exists: true, data: () => ({ mid: 'CMT-AB12CD34-02' }) };
    });
    return fn({ get: txnGet, set: txnSet, update: txnUpdate });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addVerifiedContact', () => {
  it('writes a self-verified contactKey to this member and appends to altEmails', async () => {
    runTxnWith(null);
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'email',
      value: 'priya.work@example.com',
    });

    const ckWrite = txnSet.mock.calls.find(
      ([ref]) => (ref as { __path: string }).__path === 'contactKeys/hash:email:priya.work@example.com',
    );
    expect(ckWrite).toBeDefined();
    expect(ckWrite?.[1]).toMatchObject({
      type: 'email',
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      source: 'self-verified',
    });
    // member altEmails appended via arrayUnion on the nested member ref
    expect(txnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ __path: 'families/CMT-AB12CD34/members/CMT-AB12CD34-02' }),
      expect.objectContaining({ altEmails: { __arrayUnion: ['priya.work@example.com'] } }),
    );
  });

  it('is idempotent when the contact already maps to THIS member', async () => {
    runTxnWith({ fid: 'CMT-AB12CD34', mid: 'CMT-AB12CD34-02' });
    await addVerifiedContact({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'phone',
      value: '+14165550200',
    });
    // No throw; no duplicate contactKey write (already owned by this member).
    expect(txnSet).not.toHaveBeenCalled();
  });

  it('refuses (ContactInUseError) when the contact maps to a DIFFERENT member', async () => {
    runTxnWith({ fid: 'OTHER-FAMILY', mid: 'OTHER-FAMILY-01' });
    await expect(
      addVerifiedContact({
        fid: 'CMT-AB12CD34',
        mid: 'CMT-AB12CD34-02',
        type: 'email',
        value: 'taken@example.com',
      }),
    ).rejects.toBeInstanceOf(ContactInUseError);
    expect(txnSet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/contacts/__tests__/add-verified-contact.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the transaction**

Create `apps/portal/src/features/setu/contacts/add-verified-contact.ts`:

```ts
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export class ContactInUseError extends Error {
  constructor() {
    super('contact-in-use');
    this.name = 'ContactInUseError';
  }
}

export interface AddVerifiedContactArgs {
  fid: string;
  mid: string;
  type: 'email' | 'phone';
  value: string;
}

// Anti-theft: refuse if the contact's hash already maps to a DIFFERENT member
// (any family). Idempotent if it already maps to this member. On success: write
// a source:'self-verified' contactKey → this mid, and append the plaintext to
// the member's altEmails/altPhones. All inside one transaction.
export async function addVerifiedContact(args: AddVerifiedContactArgs): Promise<void> {
  const { fid, mid, type, value } = args;
  const db = portalFirestore();
  const hash = hashContactKey(type, value);
  const contactKeyRef = db.collection('contactKeys').doc(hash);
  const memberRef = db.collection('families').doc(fid).collection('members').doc(mid);

  await db.runTransaction(async (txn) => {
    const existing = await txn.get(contactKeyRef);
    if (existing.exists) {
      const data = existing.data() as { mid?: string } | undefined;
      if (data?.mid && data.mid !== mid) {
        throw new ContactInUseError();
      }
      // Already mapped to this member — idempotent no-op (don't double-append).
      return;
    }

    txn.set(contactKeyRef, {
      contactKey: hash,
      type,
      fid,
      mid,
      source: 'self-verified',
      verifiedAt: FieldValue.serverTimestamp(),
    });

    const field = type === 'email' ? 'altEmails' : 'altPhones';
    txn.update(memberRef, { [field]: FieldValue.arrayUnion(value) });
  });
}
```

> Note: the Step 1 mock's `makeRef` chains paths, so `db.collection('families').doc(fid).collection('members').doc(mid)` yields `__path = 'families/CMT-AB12CD34/members/CMT-AB12CD34-02'` — which is what the `txn.update` assertion targets. The contactKey ref is `contactKeys/<hash>`. The `txnGet` mock returns the existing-or-not contactKey for any `contactKeys/` path and a member doc otherwise.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/features/setu/contacts/__tests__/add-verified-contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/contacts/add-verified-contact.ts apps/portal/src/features/setu/contacts/__tests__/add-verified-contact.test.ts
git commit -m "feat(setu/contacts): addVerifiedContact — anti-theft txn writes self-verified contactKey + appends altEmails/altPhones (B2)"
```

---

## Task B2.2: POST /api/setu/contacts/send-code (authenticated OTP to a new contact)

Sends an OTP to a NEW contact for the signed-in member. Reuses `normalizeContact`, `checkAndRecordOtpRateLimit`, `storeVerificationCode`, and `resolveSender()`. Gets identity from `getCurrentFamily()` (server-side session read). Refuses sending to a contact already on file for a DIFFERENT member (cheap pre-check; the binding check is re-done atomically in verify).

**Files:**
- Create: `apps/portal/src/app/api/setu/contacts/send-code/route.ts`
- Test: `apps/portal/src/app/api/setu/contacts/send-code/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/app/api/setu/contacts/send-code/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  checkAndRecordOtpRateLimit: vi.fn(),
  storeVerificationCode: vi.fn(),
}));
vi.mock('@/lib/aws/resolve-sender', () => ({ resolveSender: vi.fn() }));
vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: vi.fn(),
}));
vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : `+1${value.replace(/\D/g, '')}`,
}));

import { POST } from '../route';
import { checkAndRecordOtpRateLimit, storeVerificationCode } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

const mockSendEmail = vi.fn();
const mockSendSMS = vi.fn();

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/contacts/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const signedInFamily = {
  family: { fid: 'CMT-AB12CD34', name: 'Patel', location: 'Brampton', legacyFid: null, createdAt: new Date(), managers: ['CMT-AB12CD34-02'], searchKeys: [] },
  members: [{ mid: 'CMT-AB12CD34-02', firstName: 'Priya', lastName: 'Patel', altEmails: [], altPhones: [] }],
  currentMid: 'CMT-AB12CD34-02',
  isManager: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSender as ReturnType<typeof vi.fn>).mockReturnValue({ sendEmail: mockSendEmail, sendSMS: mockSendSMS });
  (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (storeVerificationCode as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(signedInFamily);
  mockSendEmail.mockResolvedValue(undefined);
  mockSendSMS.mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/send-code', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on bad payload', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('sends an OTP email to the new contact and stores the code', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'priya.work@example.com' }));
    expect(res.status).toBe(200);
    expect(storeVerificationCode).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'priya.work@example.com' }));
  });

  it('sends an OTP SMS for a phone contact (E.164-canonical)', async () => {
    const res = await POST(makeRequest({ type: 'phone', value: '4165550200' }));
    expect(res.status).toBe(200);
    expect(mockSendSMS).toHaveBeenCalledWith(expect.objectContaining({ phone: '+14165550200' }));
  });

  it('returns 429 when rate limited', async () => {
    (checkAndRecordOtpRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, resetAt: '2026-06-05T12:00:00.000Z' });
    const res = await POST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(429);
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'new@example.com' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/send-code/__tests__/route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/portal/src/app/api/setu/contacts/send-code/route.ts`:

```ts
import { randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  checkAndRecordOtpRateLimit,
  normalizeContact,
  storeVerificationCode,
} from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
});

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Authenticated as a family member (any role). The catch-all denies
  // non-managers, so canAccessRoute MUST open this path (Task B2.4).
  const current = await getCurrentFamily();
  if (!current) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value } = parsed.data;
  const normalized = normalizeContact(type, value);

  // OTP rate-limit keyed by the target contact (per-contact, like auth send-code).
  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, type);

  if (type === 'email') {
    const canonicalEmail = normalizeContactForKey('email', value);
    await resolveSender().sendEmail({
      to: canonicalEmail,
      subject: 'Confirm your contact for CMT Setu',
      text: `Enter this code to add this email to your family profile: ${code} (expires in 10 minutes).`,
    });
  } else {
    await resolveSender().sendSMS({
      phone: normalizeContactForKey('phone', value),
      message: `CMT Setu code to add this phone: ${code} (10 min)`,
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
```

> Anti-enumeration note: unlike auth/send-code, this is an authenticated self-service add — there is no contact-enumeration risk to hide here (the user is adding THEIR contact). We always send the OTP to the entered contact; the binding (and the anti-theft refusal) is enforced atomically at verify time (Task B2.3). We deliberately do NOT pre-check ownership here to avoid leaking, via timing, whether a contact belongs to someone else.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/send-code/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/contacts/send-code/route.ts apps/portal/src/app/api/setu/contacts/send-code/__tests__/route.test.ts
git commit -m "feat(api/setu/contacts): send-code — authenticated OTP to a new contact (B2)"
```

---

## Task B2.3: POST /api/setu/contacts/verify-code (verify → addVerifiedContact)

Verifies the OTP for the new contact, then runs `addVerifiedContact` (anti-theft txn). Returns 409 on `ContactInUseError`. Revalidates the family cache so "My contacts" + the dashboard reflect the new value.

**Files:**
- Create: `apps/portal/src/app/api/setu/contacts/verify-code/route.ts`
- Test: `apps/portal/src/app/api/setu/contacts/verify-code/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/app/api/setu/contacts/verify-code/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/check-in/shared', () => ({
  normalizeContact: vi.fn((type: string, value: string) =>
    type === 'email' ? value.toLowerCase().trim() : value.replace(/\D/g, ''),
  ),
  verifyCode: vi.fn(),
}));
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: vi.fn() }));
vi.mock('@/features/setu/contacts/add-verified-contact', async () => {
  const actual = await vi.importActual<typeof import('@/features/setu/contacts/add-verified-contact')>(
    '@/features/setu/contacts/add-verified-contact',
  );
  return { ...actual, addVerifiedContact: vi.fn() };
});
// E2E discipline: mutation routes call revalidateTag → must be mocked or the
// route throws "static generation store missing" in the harness.
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { POST } from '../route';
import { verifyCode } from '@/features/check-in/shared';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { addVerifiedContact, ContactInUseError } from '@/features/setu/contacts/add-verified-contact';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/setu/contacts/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const signedInFamily = {
  family: { fid: 'CMT-AB12CD34' },
  members: [{ mid: 'CMT-AB12CD34-02' }],
  currentMid: 'CMT-AB12CD34-02',
  isManager: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(signedInFamily);
  (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (addVerifiedContact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe('POST /api/setu/contacts/verify-code', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest({ type: 'email', value: 'x@example.com', code: '123456' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on an invalid/expired code', async () => {
    (verifyCode as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeRequest({ type: 'email', value: 'x@example.com', code: '000000' }));
    expect(res.status).toBe(400);
    expect(addVerifiedContact).not.toHaveBeenCalled();
  });

  it('on success calls addVerifiedContact with the current member binding', async () => {
    const res = await POST(makeRequest({ type: 'email', value: 'priya.work@example.com', code: '123456' }));
    expect(res.status).toBe(200);
    expect(addVerifiedContact).toHaveBeenCalledWith({
      fid: 'CMT-AB12CD34',
      mid: 'CMT-AB12CD34-02',
      type: 'email',
      value: 'priya.work@example.com',
    });
  });

  it('returns 409 when the contact is already in use by another member', async () => {
    (addVerifiedContact as ReturnType<typeof vi.fn>).mockRejectedValue(new ContactInUseError());
    const res = await POST(makeRequest({ type: 'phone', value: '4165550200', code: '123456' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('contact-in-use');
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest({ type: 'email', value: 'x@example.com', code: '123456' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/verify-code/__tests__/route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/portal/src/app/api/setu/contacts/verify-code/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { normalizeContact, verifyCode } from '@/features/check-in/shared';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { addVerifiedContact, ContactInUseError } from '@/features/setu/contacts/add-verified-contact';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const current = await getCurrentFamily();
  if (!current) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value, code } = parsed.data;
  const normalized = normalizeContact(type, value);
  const ok = await verifyCode(normalized, code, type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 400 });
  }

  try {
    await addVerifiedContact({
      fid: current.family.fid,
      mid: current.currentMid,
      type,
      value,
    });
  } catch (err) {
    if (err instanceof ContactInUseError) {
      return NextResponse.json({ error: 'contact-in-use' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${current.family.fid}`, 'max');
  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/verify-code/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/contacts/verify-code/route.ts apps/portal/src/app/api/setu/contacts/verify-code/__tests__/route.test.ts
git commit -m "feat(api/setu/contacts): verify-code → addVerifiedContact; 409 on contact-in-use (B2)"
```

---

## Task B2.4: Open the contacts routes in canAccessRoute

The `/api/setu/*` catch-all (`can-access-route.ts:151`) is manager-only. A `family-member` adding their own contact must be allowed. Open all three `/api/setu/contacts/*` paths to `isSetuFamily` BEFORE the catch-all.

**Files:**
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared-domain/src/__tests__/can-access-route.test.ts`. That file already declares typed `SessionClaims` constants at the top (`member` = `{ uid: 'mb', role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' }`, `manager`, `welcomeTeam`, `admin`). Reuse them — do NOT redeclare with `as const` (the discriminated union needs the `SessionClaims` annotation):

```ts
describe('canAccessRoute — /api/setu/contacts/* (self-service, any family role)', () => {
  it('allows a family-member to POST send-code', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/send-code', 'POST')).toBe(true);
  });
  it('allows a family-member to POST verify-code', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/verify-code', 'POST')).toBe(true);
  });
  it('allows a family-member to POST dismiss-nudge', () => {
    expect(canAccessRoute(member, '/api/setu/contacts/dismiss-nudge', 'POST')).toBe(true);
  });
  it('allows a family-manager too', () => {
    expect(canAccessRoute(manager, '/api/setu/contacts/send-code', 'POST')).toBe(true);
  });
  it('denies a non-family role (welcome-team has no member contacts here)', () => {
    expect(canAccessRoute(welcomeTeam, '/api/setu/contacts/send-code', 'POST')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain vitest run src/__tests__/can-access-route.test.ts -t "contacts"`
Expected: FAIL — the family-member cases hit the manager-only catch-all and return `false`.

- [ ] **Step 3: Add the allowlist rule**

In `packages/shared-domain/src/auth/can-access-route.ts`, immediately BEFORE the `// Setu API — remaining paths` catch-all comment (line 149), insert:

```ts
  // Setu API — "My contacts" self-service: any signed-in family role (incl.
  // family-member) may add/verify their OWN contacts and dismiss the nudge.
  // The route handlers bind every write to the caller's own mid and run the
  // anti-theft contactKey check, so member-level access is safe here.
  if (pathname === '/api/setu/contacts' || pathname.startsWith('/api/setu/contacts/')) {
    return isSetuFamily(claims);
  }

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain vitest run src/__tests__/can-access-route.test.ts`
Expected: PASS (the new block + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/__tests__/can-access-route.test.ts
git commit -m "feat(auth): open /api/setu/contacts/* to any signed-in family role (B2)"
```

---

## Task B2.5: contacts-client.ts + "My contacts" settings page

A side-effect-free client wrapper for the routes, and the `/family/settings/contacts` client page that lists the member's contacts and drives the add+verify flow. The page reads identity via the EXISTING `getCurrentFamilyClient()` (never the server `getCurrentFamily`).

**Files:**
- Create: `apps/portal/src/features/setu/contacts/contacts-client.ts`
- Create: `apps/portal/src/app/family/settings/contacts/page.tsx`
- Test: `apps/portal/src/app/family/settings/contacts/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test (page behavior, wrappers mocked)**

Create `apps/portal/src/app/family/settings/contacts/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { back: () => <span>back</span>, shield: () => <span>shield</span> },
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/setu/members/get-current-family-client', () => ({
  getCurrentFamilyClient: vi.fn(),
}));
vi.mock('@/features/setu/contacts/contacts-client', () => ({
  sendContactCode: vi.fn(),
  verifyContactCode: vi.fn(),
}));

import ContactsSettingsPage from '../page';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { sendContactCode, verifyContactCode } from '@/features/setu/contacts/contacts-client';

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentFamilyClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    family: { fid: 'CMT-AB12CD34', name: 'Patel' },
    members: [
      { mid: 'CMT-AB12CD34-02', firstName: 'Priya', lastName: 'Patel', email: 'priya@example.com', phone: '+14165550199', altEmails: ['priya.work@example.com'], altPhones: [] },
    ],
    currentMid: 'CMT-AB12CD34-02',
    isManager: false,
  });
  (sendContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  (verifyContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
});

describe('My contacts settings page', () => {
  it('lists the current member primary + alternate contacts', async () => {
    render(<ContactsSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('priya@example.com')).toBeInTheDocument();
      expect(screen.getByText('priya.work@example.com')).toBeInTheDocument();
      expect(screen.getByText('+14165550199')).toBeInTheDocument();
    });
  });

  it('runs the add → OTP → verify flow and shows success', async () => {
    const user = userEvent.setup();
    render(<ContactsSettingsPage />);
    await screen.findByText('priya@example.com');

    await user.click(screen.getByRole('button', { name: /add an email/i }));
    await user.type(screen.getByLabelText(/new email/i), 'priya.alt@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => expect(sendContactCode).toHaveBeenCalledWith('email', 'priya.alt@example.com'));

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() =>
      expect(verifyContactCode).toHaveBeenCalledWith('email', 'priya.alt@example.com', '123456'),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('shows an error toast when verify reports contact-in-use', async () => {
    (verifyContactCode as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'contact-in-use' });
    const user = userEvent.setup();
    render(<ContactsSettingsPage />);
    await screen.findByText('priya@example.com');

    await user.click(screen.getByRole('button', { name: /add an email/i }));
    await user.type(screen.getByLabelText(/new email/i), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(sendContactCode).toHaveBeenCalled());
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/family/settings/contacts/__tests__/page.test.tsx`
Expected: FAIL — neither the page nor the client wrapper exists.

- [ ] **Step 3: Implement the client wrapper**

Create `apps/portal/src/features/setu/contacts/contacts-client.ts`:

```ts
// Client-safe wrappers around the /api/setu/contacts/* routes. The route
// handlers use next/headers + firebase-admin, which crash in a 'use client'
// component — call these from the UI and mock THESE in component tests.

export interface ContactsResult {
  ok: boolean;
  error?: string;
  resetAt?: string;
}

export async function sendContactCode(
  type: 'email' | 'phone',
  value: string,
): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/send-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ type, value }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; resetAt?: string };
  return { ok: false, ...(body.error ? { error: body.error } : {}), ...(body.resetAt ? { resetAt: body.resetAt } : {}) };
}

export async function verifyContactCode(
  type: 'email' | 'phone',
  value: string,
  code: string,
): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ type, value, code }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, ...(body.error ? { error: body.error } : {}) };
}

export async function dismissContactsNudge(): Promise<ContactsResult> {
  const res = await fetch('/api/setu/contacts/dismiss-nudge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
  });
  return res.ok ? { ok: true } : { ok: false };
}
```

(Conditional-spread keeps `error`/`resetAt` off the object when absent — `exactOptionalPropertyTypes`.)

- [ ] **Step 4: Implement the page**

Create `apps/portal/src/app/family/settings/contacts/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { sendContactCode, verifyContactCode } from '@/features/setu/contacts/contacts-client';

type Stage = 'idle' | 'entering' | 'awaiting-code';

export default function ContactsSettingsPage() {
  const [emails, setEmails] = useState<string[]>([]);
  const [phones, setPhones] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [stage, setStage] = useState<Stage>('idle');
  const [addType, setAddType] = useState<'email' | 'phone'>('email');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await getCurrentFamilyClient();
    if (!data) {
      setLoaded(true);
      return;
    }
    const me = data.members.find((m) => m.mid === data.currentMid);
    if (me) {
      setEmails([me.email, ...(me.altEmails ?? [])].filter((v): v is string => !!v));
      setPhones([me.phone, ...(me.altPhones ?? [])].filter((v): v is string => !!v));
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  function beginAdd(type: 'email' | 'phone') {
    setAddType(type);
    setValue('');
    setCode('');
    setStage('entering');
  }

  async function handleSend() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const r = await sendContactCode(addType, value.trim());
      if (r.ok) {
        setStage('awaiting-code');
        toast.success('Code sent. Check your new contact for the code.');
      } else if (r.error === 'rate-limited') {
        toast.error('Too many codes requested. Try again later.');
      } else {
        toast.error('Could not send a code. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const r = await verifyContactCode(addType, value.trim(), code);
      if (r.ok) {
        toast.success('Contact added.');
        setStage('idle');
        await load();
      } else if (r.error === 'contact-in-use') {
        toast.error('That contact is already in use by another member — contact admin.');
      } else {
        toast.error('That code was invalid or expired. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const formSection = (
    <div>
      <SectionLabel>My contacts</SectionLabel>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Add the other emails and phone numbers you use so we always recognize you and don&apos;t create a duplicate family.
      </p>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Emails</div>
        {emails.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>None on file.</div>
        ) : (
          emails.map((e) => (
            <div key={e} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 6, fontSize: 13 }}>{e}</div>
          ))
        )}
        <button type="button" className="btn btn--g" style={{ marginTop: 6, fontSize: 13 }} onClick={() => beginAdd('email')}>
          Add an email
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Phones</div>
        {phones.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>None on file.</div>
        ) : (
          phones.map((p) => (
            <div key={p} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 6, fontSize: 13 }}>{p}</div>
          ))
        )}
        <button type="button" className="btn btn--g" style={{ marginTop: 6, fontSize: 13 }} onClick={() => beginAdd('phone')}>
          Add a phone
        </button>
      </div>

      {stage === 'entering' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>{addType === 'email' ? 'New email' : 'New phone'} <span className="req">·</span></label>
            <input
              className="input"
              type={addType === 'email' ? 'email' : 'tel'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={addType === 'email' ? 'New email' : 'New phone'}
              placeholder={addType === 'email' ? 'another@example.com' : '(416) 555-0000'}
            />
          </div>
          <button type="button" className="btn btn--p" disabled={busy} onClick={handleSend}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      )}

      {stage === 'awaiting-code' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Verification code <span className="req">·</span></label>
            <input
              className="input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Verification code"
              placeholder="6-digit code"
            />
          </div>
          <button type="button" className="btn btn--p" disabled={busy} onClick={handleVerify}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      )}

      {!loaded && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>My contacts</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              {formSection}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Settings</p>
          <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>My contacts</h1>
        </header>
        <div style={{ maxWidth: 520 }}>
          {formSection}
        </div>
      </div>
    </>
  );
}
```

> The page imports `getCurrentFamilyClient` whose return type is `FamilyWithMembers` (`members: MemberDoc[]`). `MemberDoc` now carries `altEmails`/`altPhones` (G0.1), so `me.altEmails` is typed `string[]`. The GET `/api/setu/family` route returns `getCurrentFamily()` which uses the G0.3-updated mapper, so the alt arrays arrive populated.

- [ ] **Step 4b: Make alt arrays available to the client.** Confirm `/api/setu/family` returns members with `altEmails`/`altPhones`. It returns `getCurrentFamily()` → `getFamilyByFid()` (mapper updated in G0.3). No route change needed. (If a future reviewer finds the arrays missing client-side, the bug is in G0.3's mapper, not here.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/family/settings/contacts/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/contacts/contacts-client.ts apps/portal/src/app/family/settings/contacts/page.tsx apps/portal/src/app/family/settings/contacts/__tests__/page.test.tsx
git commit -m "feat(family/settings): My contacts surface + client wrappers for add/verify (B2)"
```

---

# Group B3 — one-time post-sign-in nudge

A dismissible banner shown once on the family dashboard, pointing to the B2 add flow. Persisted via `MemberDoc.contactsNudgeDismissedAt` through a dedicated dismiss route.

## Task B3.1: POST /api/setu/contacts/dismiss-nudge

Sets `contactsNudgeDismissedAt` on the CURRENT member. Uses `getCurrentFamily()` for identity; writes directly to that member's doc; revalidates the family cache. (Kept as its own route rather than extending the members PATCH schema — that route's PATCH does contactKey rewrites we don't want to touch for a simple flag set.)

**Files:**
- Create: `apps/portal/src/app/api/setu/contacts/dismiss-nudge/route.ts`
- Test: `apps/portal/src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('@/features/setu/members/get-current-family', () => ({ getCurrentFamily: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const mockUpdate = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({
      doc: () => ({ collection: () => ({ doc: () => ({ update: mockUpdate }) }) }),
    }),
  }),
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));

import { POST } from '../route';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

function makeRequest() {
  return new Request('http://localhost/api/setu/contacts/dismiss-nudge', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(undefined);
  (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue({
    family: { fid: 'CMT-AB12CD34' },
    members: [{ mid: 'CMT-AB12CD34-02' }],
    currentMid: 'CMT-AB12CD34-02',
    isManager: false,
  });
});

describe('POST /api/setu/contacts/dismiss-nudge', () => {
  it('returns 401 when not signed in', async () => {
    (getCurrentFamily as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('sets contactsNudgeDismissedAt on the current member', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ contactsNudgeDismissedAt: { __serverTimestamp: true } }),
    );
  });

  it('returns 404 when feature flag is off', async () => {
    vi.resetModules();
    vi.doMock('@/lib/flags', () => ({ flags: { setuAuth: false } }));
    const { POST: flaggedPOST } = await import('../route');
    const res = await flaggedPOST(makeRequest());
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/portal/src/app/api/setu/contacts/dismiss-nudge/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

export async function POST(_req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const current = await getCurrentFamily();
  if (!current) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const db = portalFirestore();
  await db
    .collection('families')
    .doc(current.family.fid)
    .collection('members')
    .doc(current.currentMid)
    .update({ contactsNudgeDismissedAt: FieldValue.serverTimestamp() });

  revalidateTag(`family-${current.family.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/app/api/setu/contacts/dismiss-nudge/route.ts apps/portal/src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts
git commit -m "feat(api/setu/contacts): dismiss-nudge sets contactsNudgeDismissedAt on current member (B3)"
```

---

## Task B3.2: The dismissible nudge component

A client banner: copy + a link to `/family/settings/contacts` + a Dismiss button that calls `dismissContactsNudge()` and hides itself. Module-scope component (never declared inside another component — repo memory on remount).

**Files:**
- Create: `apps/portal/src/features/family/components/contacts-nudge.tsx`
- Test: `apps/portal/src/features/family/components/__tests__/contacts-nudge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/src/features/family/components/__tests__/contacts-nudge.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/features/setu/contacts/contacts-client', () => ({ dismissContactsNudge: vi.fn() }));

import { ContactsNudge } from '../contacts-nudge';
import { dismissContactsNudge } from '@/features/setu/contacts/contacts-client';

beforeEach(() => {
  vi.clearAllMocks();
  (dismissContactsNudge as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
});

describe('ContactsNudge', () => {
  it('renders the prompt with a link to My contacts', () => {
    render(<ContactsNudge />);
    expect(screen.getByText(/other emails/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add contacts/i })).toHaveAttribute('href', '/family/settings/contacts');
  });

  it('dismiss calls the API and hides the banner', async () => {
    const user = userEvent.setup();
    render(<ContactsNudge />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(dismissContactsNudge).toHaveBeenCalled());
    expect(screen.queryByText(/other emails/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/features/family/components/__tests__/contacts-nudge.test.tsx`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/portal/src/features/family/components/contacts-nudge.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dismissContactsNudge } from '@/features/setu/contacts/contacts-client';

export function ContactsNudge() {
  const [hidden, setHidden] = useState(false);

  async function handleDismiss() {
    setHidden(true);
    // Fire-and-forget persistence; the local hide is the user-facing effect.
    await dismissContactsNudge().catch(() => {});
  }

  if (hidden) return null;

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--accentSoft)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)',
        marginBottom: 18,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accentDeep)' }}>
          Add the other emails and phones you use
        </div>
        <div style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 2, lineHeight: 1.5 }}>
          So we always recognize you and never create a duplicate family record.
        </div>
        <Link
          href="/family/settings/contacts"
          className="btn btn--s"
          style={{ marginTop: 10, display: 'inline-block', textDecoration: 'none' }}
        >
          Add contacts →
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4 }}
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/features/family/components/__tests__/contacts-nudge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/family/components/contacts-nudge.tsx apps/portal/src/features/family/components/__tests__/contacts-nudge.test.tsx
git commit -m "feat(family): dismissible one-time contacts nudge component (B3)"
```

---

## Task B3.3: Render the nudge once on the family dashboard

Show `<ContactsNudge />` only when the current member has NOT dismissed it (`contactsNudgeDismissedAt == null`). Scoped to the real-data path (`flags.setuAuth` + a resolved member).

**Files:**
- Modify: `apps/portal/src/app/family/page.tsx`
- Test: `apps/portal/src/app/family/__tests__/page.test.tsx` (extend; if absent, create with the gate-only assertion below)

- [ ] **Step 1: Write the failing test**

The dashboard is a server component with many data deps. Test the gate via a focused unit on a small extracted predicate to avoid mocking the entire dashboard. Add an exported helper and test it.

Create `apps/portal/src/app/family/_helpers/__tests__/should-show-contacts-nudge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldShowContactsNudge } from '../should-show-contacts-nudge';

describe('shouldShowContactsNudge', () => {
  it('shows when the member has not dismissed it', () => {
    expect(shouldShowContactsNudge({ contactsNudgeDismissedAt: null })).toBe(true);
    expect(shouldShowContactsNudge({})).toBe(true);
  });
  it('hides when dismissed', () => {
    expect(shouldShowContactsNudge({ contactsNudgeDismissedAt: new Date() })).toBe(false);
  });
  it('hides when there is no member', () => {
    expect(shouldShowContactsNudge(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cmt/portal vitest run src/app/family/_helpers/__tests__/should-show-contacts-nudge.test.ts`
Expected: FAIL — the helper does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/portal/src/app/family/_helpers/should-show-contacts-nudge.ts`:

```ts
// Show the one-time "add your other contacts" nudge only when the current
// member exists and has never dismissed it. Null/absent timestamp = show.
export function shouldShowContactsNudge(
  member: { contactsNudgeDismissedAt?: Date | null } | undefined,
): boolean {
  if (!member) return false;
  return (member.contactsNudgeDismissedAt ?? null) === null;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --filter @cmt/portal vitest run src/app/family/_helpers/__tests__/should-show-contacts-nudge.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the dashboard**

In `apps/portal/src/app/family/page.tsx`:

Add imports near the top (after line 8, the `getCurrentFamily` import):

```tsx
import { ContactsNudge } from '@/features/family/components/contacts-nudge';
import { shouldShowContactsNudge } from './_helpers/should-show-contacts-nudge';
```

Add a `showContactsNudge` flag computed from the current member. Inside the `if (flags.setuAuth) { const data = await getCurrentFamily(); if (data) {` block, where `currentMember` is already computed (line 75), capture the nudge decision. Declare a mutable flag near the other `let` declarations (e.g. after line 56 `let upcomingEntries: CalendarEntry[] = [];`):

```tsx
  let showContactsNudge = false;
```

Then inside `if (currentMember) { ... }` (after line 78), set it:

```tsx
        showContactsNudge = shouldShowContactsNudge(currentMember);
```

Render `<ContactsNudge />` in BOTH the mobile and desktop branches. Mobile: immediately AFTER the greeting `<div style={{ marginBottom: 22 }}>...</div>` block (closes line 174) and BEFORE the `{needsProfile && currentMid && (...)}` block (line 175):

```tsx
            {showContactsNudge && <ContactsNudge/>}
```

Desktop: immediately AFTER the `<header className="between" ...>...</header>` (closes line 311) and BEFORE the `{needsProfile && currentMid && (...)}` desktop block (line 313):

```tsx
        {showContactsNudge && <ContactsNudge/>}
```

- [ ] **Step 6: Run the dashboard test suite to verify nothing broke**

Run: `pnpm --filter @cmt/portal vitest run src/app/family/__tests__/`
Expected: PASS — existing dashboard/model tests unaffected (the nudge is additive and gated). If a dashboard render test exists and now needs the `ContactsNudge`/`getCurrentFamilyClient` mocks, add `vi.mock('@/features/family/components/contacts-nudge', () => ({ ContactsNudge: () => null }))` to that test's mock block.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/app/family/page.tsx apps/portal/src/app/family/_helpers/should-show-contacts-nudge.ts apps/portal/src/app/family/_helpers/__tests__/should-show-contacts-nudge.test.ts
git commit -m "feat(family/dashboard): show the one-time contacts nudge until dismissed (B3)"
```

---

## Task B4: Mock-free UAT walkthrough (pre-ship discipline)

Per `CLAUDE.md` ("walk the user's exact path in UAT before declaring done"). Manual — no code. Verifies the whole flow against UAT (`chinmaya-setu-uat`), not just route 200s.

**Prereqs:** `apps/portal/.env.local` → `PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat`, `NEXT_PUBLIC_FEATURE_SETU_AUTH=true`, `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true`, and your test email/phone in `SETU_EMAIL_ALLOWLIST` / `SETU_PHONE_ALLOWLIST` (so the OTP actually sends to you). Run `pnpm --filter @cmt/portal dev:e2e` (serves on `:3001`).

- [ ] **Step 1: B1 find-screen multi-search.** Open `http://localhost:3001/register`. Enter a primary email/phone NOT on file. Click "+ add another email", enter a secondary that IS on file for an existing UAT family (e.g. a contact you registered earlier). Expected: the "We found a family with this contact" card appears — driven by the secondary contact. Confirms the array lookup.

- [ ] **Step 2: B2 add + verify.** Sign in to a UAT family (OTP). Go to `/family/settings/contacts`. Confirm the list shows your primary email + phone. Click "Add an email", enter a NEW email you control, "Send code", retrieve the real OTP from your inbox, enter it, "Verify". Expected: success toast; the new email now appears in the Emails list. In Firestore (UAT), confirm a `contactKeys/{hash}` doc with `source:'self-verified'`, `verifiedAt` set, `mid` = your member, and your member doc's `altEmails` contains the plaintext.

- [ ] **Step 3: B2 anti-theft.** Repeat the add flow with a contact already registered to a DIFFERENT UAT family/member. Complete the OTP. Expected: 409 → "already in use by another member — contact admin." No contactKey is rewritten; the other family's pointer is untouched.

- [ ] **Step 4: B1 dedup win via the new contact.** Sign out / private window. Go to `/register`, enter ONLY the email you just self-added in Step 2. Expected: the existing family is found (it resolves via the new `self-verified` contactKey) — the dedup outcome the feature exists for.

- [ ] **Step 5: B3 nudge once.** As a member who has never dismissed, load `/family`. Expected: the "Add the other emails and phones you use" banner shows. Click Dismiss. Reload `/family`. Expected: the banner is GONE (persisted via `contactsNudgeDismissedAt`). Confirm the member doc has `contactsNudgeDismissedAt` set in UAT Firestore.

- [ ] **Step 6: Record the result.** In the final summary, distinguish "tests pass" from "end-to-end verified in UAT." If any step was skipped or deviated, say so plainly (per CLAUDE.md pre-ship discipline #4).

---

## Done when

- All new/updated unit suites are green:
  - `pnpm --filter @cmt/shared-domain vitest run src/setu/schemas/__tests__/member.test.ts src/__tests__/can-access-route.test.ts`
  - `pnpm --filter @cmt/portal vitest run src/features/setu/registration/__tests__/family-lookup.test.ts src/app/api/setu/family-lookup/__tests__/route.test.ts src/app/register/__tests__/page.test.tsx src/features/setu/contacts/__tests__/add-verified-contact.test.ts src/app/api/setu/contacts/send-code/__tests__/route.test.ts src/app/api/setu/contacts/verify-code/__tests__/route.test.ts src/app/api/setu/contacts/dismiss-nudge/__tests__/route.test.ts src/app/family/settings/contacts/__tests__/page.test.tsx src/features/family/components/__tests__/contacts-nudge.test.tsx src/app/family/_helpers/__tests__/should-show-contacts-nudge.test.ts src/features/setu/members/__tests__/get-family-by-fid.test.ts src/features/setu/auth/__tests__/contact-key-doc-type.test.ts`
- The full pre-push gate (`typecheck && lint && test && build`) passes (runs on push; never `--no-verify`).
- The B4 UAT walkthrough confirms: multi-contact find search hits; OTP add writes a `self-verified` contactKey + appends `altEmails`/`altPhones`; the anti-theft check refuses a contact owned by another member (409); a self-added contact later resolves the existing family; the nudge shows once then stays dismissed.
- `canAccessRoute` opens all three `/api/setu/contacts/*` routes to `isSetuFamily`; every contact write binds to the caller's own `mid` and runs the in-transaction anti-theft refusal.

## Security recap (must hold)

- **OTP per added contact.** No contact is associated without a verified code to that contact (B2). B1 search performs no association → needs no proof.
- **One contact ↔ one (fid, mid).** `addVerifiedContact` refuses (`ContactInUseError` → 409) when the hash already maps to a different member, inside the same transaction that writes the key. Idempotent for the same member.
- **Catch-all default-deny preserved.** Only the explicit `/api/setu/contacts/*` rule opens these to `family-member`; everything else under `/api/setu/*` stays manager+welcome-team+admin.
- **Anti-enumeration on lookup** (IP rate-limit, misses consume quota) and **per-contact OTP rate-limit** on add are reused unchanged.

## Out of scope

- Admin/welcome-team contact management for OTHER members (a manager/staff cannot OTP-verify someone else's contact — the member completes their own add).
- Bulk backfill of existing families' missing spouse contacts.
- Merging two families later discovered to be duplicates ("merge families" tool).
- International phone numbers (Canadian-only stays).
- Removing/editing an existing contact from "My contacts" (this plan only ADDS verified contacts; deletion is a future task and must also delete the contactKey + prune the array).

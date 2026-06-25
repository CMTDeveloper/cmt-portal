# FID / MID Renumber (Issue #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every family a memorable 4-digit Family ID (from `1001`) and every member a memorable 5-digit Member ID (from `50001`), surfaced in the UI, while keeping every prior ID searchable — implemented as **additive public-id fields**, never a re-key.

**Architecture:** The current `CMT-XXXXXXXX` FID stays the Firestore `families` **doc-id** and the current `${fid}-NN` MID stays the `members` **doc-id**; nothing is renamed and no foreign key (donations, attendance, contactKeys, enrollments, claims, invites, routes) is touched. We add two new indexed string fields — `publicFid` on the family doc and `publicMid` on the member doc — allocated from transactional Firestore **counter** docs. New families/members get them at creation; a one-time idempotent UAT migration backfills all existing records. The UI shows `publicFid` at family level and `publicMid` on the member detail page (un-hiding the MID that issue #4's first pass hid — it is now the canonical, user-facing Member ID). Search gains lookup by both new numbers; all legacy IDs remain findable because they remain the primary keys.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `firebase-admin` Firestore, Zod (`@cmt/shared-domain`), Vitest, Playwright (deployed-UAT E2E), pnpm/Turborepo.

## Global Constraints

- **DB target is `chinmaya-setu-uat` ONLY.** Prod `chinmaya-setu-715b8` is OFF-LIMITS for every write (migration, index deploy, seed). Never `firebase deploy ... --force`.
- **Additive only — no re-key.** `families` doc-id stays `CMT-…`; `members` doc-id stays `${fid}-NN`. Do NOT change any existing doc-id, foreign key, route param, or session claim.
- **Doc-schema fields are validated on READ** → every new schema field is `.nullable().optional()`; never `.min(1)`/required on a doc schema. Enforce required-ness at write sites only.
- **`exactOptionalPropertyTypes` is on** → never assign `undefined` to an optional; omit the key or assign `null`.
- **Counters are the single source of truth** for sequential allocation, shared by runtime creation and the migration, so the two never collide.
- **Mobile contract:** family/member API shapes are hand-mirrored in `chinmaya-setu-mobile`. Any `/api/setu/**` shape change needs a dated, SHA-keyed entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.
- **FID = 4-digit from `1001`** (string, no padding needed below 9999). **MID = 5-digit from `50001`** (string).
- **Every user-facing route gets a deployed-UAT Playwright E2E** with a realistic multi-instance fixture in its active state. Green unit tests are not sufficient.
- Commit author is `CMT Developer <developer@chinmayatoronto.org>` (already set in worktree git config). After authorized commits, `git push` (pre-push hook is the gate). Never `--no-verify`.

## Blast-radius map (verified from code)

- Family doc: `families/{fid}` (doc-id == `fid`). Schema `packages/shared-domain/src/setu/schemas/family.ts`. `searchKeys` = `[name.toLowerCase(), fid]`. `legacyFid` holds the pre-CMT roster id (or `null`).
- Member doc: `families/{fid}/members/{mid}` (doc-id == `mid` == `${fid}-NN`). Schema `…/schemas/member.ts`. `legacySid` holds the old roster student id.
- `searchFamilies` (`apps/portal/src/features/setu/search/search-families.ts`) lookups: contactKey hash (email/phone), direct `fid` doc, `legacyFid` ==, `searchKeys` array-contains.
- Member-creation sites: `features/setu/registration/register-family.ts`, `…/registration/lazy-migrate.ts`, `features/setu/teacher/pending-family.ts`, `app/api/setu/members/route.ts` (POST), `app/api/setu/invite/accept/route.ts` (verify), `features/setu/enrollment/enroll-family.ts` (verify).
- No sequential allocator exists today. `runTransaction` pattern is used widely (e.g. `register-family.ts:110`).
- `firestore.indexes.json` has an `indexes` array; a `members.publicMid` collection-group query needs a field-override (single-field collection-group index).
- MID was hidden from families in commit `ba86989` (member detail page + profile header) — this plan un-hides it as `publicMid`.

---

### Task 1: Schema fields `publicFid` / `publicMid`

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/family.ts`
- Modify: `packages/shared-domain/src/setu/schemas/member.ts`
- Test: `packages/shared-domain/src/setu/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `FamilyDoc.publicFid?: string | null`, `MemberDoc.publicMid?: string | null`.

- [ ] **Step 1: Write the failing test** — add to `schemas.test.ts`:

```ts
it('FamilyDoc accepts an optional publicFid and defaults absent to undefined', () => {
  const base = {
    fid: 'CMT-A1B2C3D4', legacyFid: null, name: 'Iyer', location: 'Brampton' as const,
    createdAt: new Date(), managers: ['CMT-A1B2C3D4-01'], searchKeys: ['iyer', 'cmt-a1b2c3d4'],
  };
  expect(FamilyDocSchema.parse({ ...base, publicFid: '1042' }).publicFid).toBe('1042');
  expect(FamilyDocSchema.parse(base).publicFid).toBeUndefined();      // existing docs: read still passes
  expect(FamilyDocSchema.parse({ ...base, publicFid: null }).publicFid).toBeNull();
});

it('MemberDoc accepts an optional publicMid', () => {
  const m = {
    mid: 'CMT-A1B2C3D4-01', uid: null, firstName: 'A', lastName: 'B', type: 'Adult' as const,
    gender: 'Male' as const, manager: true, joinedAt: new Date(), email: null, phone: null,
    schoolGrade: null, birthMonthYear: null, volunteeringSkills: [], foodAllergies: null,
    emergencyContacts: [null, null] as [null, null],
  };
  expect(MemberDocSchema.parse({ ...m, publicMid: '50001' }).publicMid).toBe('50001');
  expect(MemberDocSchema.parse(m).publicMid).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/schemas.test.ts`
Expected: FAIL (`publicFid`/`publicMid` not on the parsed type / unknown key stripped).

- [ ] **Step 3: Add the fields**

In `family.ts`, inside `FamilyDocSchema` after `searchKeys`:
```ts
  // 4-digit sequential Family ID (issue #4), e.g. '1042'. Additive + user-facing;
  // the CMT- `fid` above remains the internal doc-id / join key. Optional because
  // doc schemas validate on read and pre-migration docs lack it.
  publicFid: z.string().nullable().optional(),
```
In `member.ts`, inside `MemberDocSchema` after `legacySid`:
```ts
  // 5-digit sequential Member ID (issue #4), e.g. '50001'. The canonical,
  // user-facing member identifier (replaces the legacy SID for humans); the
  // `${fid}-NN` `mid` above stays the internal doc-id / join key. Optional: read-validated.
  publicMid: z.string().nullable().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/family.ts packages/shared-domain/src/setu/schemas/member.ts packages/shared-domain/src/setu/__tests__/schemas.test.ts
git commit -m "feat(setu): add publicFid/publicMid optional doc-schema fields (issue #4)"
```

---

### Task 2: Display helpers `displayFid` / `displayMid`

Pure helpers so every UI surface shows the new number with a safe fallback to the legacy id while migration is in flight.

**Files:**
- Create: `packages/shared-domain/src/setu/public-ids.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (or the package barrel that re-exports setu helpers — match existing export style)
- Test: `packages/shared-domain/src/setu/__tests__/public-ids.test.ts`

**Interfaces:**
- Produces: `displayFid(f: { publicFid?: string | null; fid: string }): string`, `displayMid(m: { publicMid?: string | null; mid: string }): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { displayFid, displayMid } from '../public-ids';

describe('public-id display helpers', () => {
  it('prefers the public id when present', () => {
    expect(displayFid({ publicFid: '1042', fid: 'CMT-A1B2C3D4' })).toBe('1042');
    expect(displayMid({ publicMid: '50001', mid: 'CMT-A1B2C3D4-01' })).toBe('50001');
  });
  it('falls back to the legacy id when the public id is null/absent', () => {
    expect(displayFid({ publicFid: null, fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayFid({ fid: 'CMT-A1B2C3D4' })).toBe('CMT-A1B2C3D4');
    expect(displayMid({ mid: 'CMT-A1B2C3D4-01' })).toBe('CMT-A1B2C3D4-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/public-ids.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`public-ids.ts`:
```ts
/** User-facing Family ID: the 4-digit publicFid when assigned, else the legacy CMT- fid. */
export function displayFid(f: { publicFid?: string | null; fid: string }): string {
  return f.publicFid ?? f.fid;
}

/** User-facing Member ID: the 5-digit publicMid when assigned, else the legacy ${fid}-NN mid. */
export function displayMid(m: { publicMid?: string | null; mid: string }): string {
  return m.publicMid ?? m.mid;
}
```
Re-export both from the setu barrel (follow the existing `export *`/named-export convention in that file).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/shared-domain exec vitest run src/setu/__tests__/public-ids.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/public-ids.ts packages/shared-domain/src/setu/__tests__/public-ids.test.ts packages/shared-domain/src/setu/index.ts
git commit -m "feat(setu): add displayFid/displayMid public-id helpers (issue #4)"
```

---

### Task 3: Transactional public-id allocator (counters)

**Files:**
- Create: `apps/portal/src/features/setu/ids/public-id-allocator.ts`
- Test: `apps/portal/src/features/setu/ids/__tests__/public-id-allocator.test.ts`

**Interfaces:**
- Produces:
  - `allocateFamilyPublicId(): Promise<string>` → next FID string, starts `'1001'`.
  - `allocateMemberPublicIds(count: number): Promise<string[]>` → `count` contiguous MID strings, starts `'50001'`. (`count` ≥ 1.)
- Consumes: `portalFirestore()` from `@cmt/firebase-shared/admin/firestore`. Counter docs `counters/familyPublicId` and `counters/memberPublicId`, shape `{ next: number }`.

**Design notes:** Allocation runs in its **own** `runTransaction`, so callers MUST allocate **before** opening their own registration/member transaction (Firestore forbids nested transactions). `allocateMemberPublicIds(n)` reserves a block in one txn (increment by `n`) so a multi-member registration takes a single round-trip.

- [ ] **Step 1: Write the failing test** (uses the repo's fake-firestore harness — match the import used by other `features/setu/**/__tests__`):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { allocateFamilyPublicId, allocateMemberPublicIds } from '../public-id-allocator';
// (mock @cmt/firebase-shared/admin/firestore -> fake firestore, per existing test pattern)

describe('public-id allocator', () => {
  beforeEach(() => {/* reset fake firestore */});

  it('family ids start at 1001 and increment', async () => {
    expect(await allocateFamilyPublicId()).toBe('1001');
    expect(await allocateFamilyPublicId()).toBe('1002');
  });

  it('member ids start at 50001 and reserve contiguous blocks', async () => {
    expect(await allocateMemberPublicIds(1)).toEqual(['50001']);
    expect(await allocateMemberPublicIds(3)).toEqual(['50002', '50003', '50004']);
  });

  it('rejects a non-positive count', async () => {
    await expect(allocateMemberPublicIds(0)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/ids/__tests__/public-id-allocator.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const FAMILY_COUNTER = 'familyPublicId';
const MEMBER_COUNTER = 'memberPublicId';
const FAMILY_START = 1001;
const MEMBER_START = 50001;

async function allocateBlock(counter: string, start: number, count: number): Promise<number[]> {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const db = portalFirestore();
  const ref = db.collection('counters').doc(counter);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.next ?? start) : start;
    const base = Number.isFinite(current) ? current : start;
    tx.set(ref, { next: base + count }, { merge: true });
    return Array.from({ length: count }, (_, i) => base + i);
  });
}

export async function allocateFamilyPublicId(): Promise<string> {
  const [n] = await allocateBlock(FAMILY_COUNTER, FAMILY_START, 1);
  return String(n);
}

export async function allocateMemberPublicIds(count: number): Promise<string[]> {
  const ids = await allocateBlock(MEMBER_COUNTER, MEMBER_START, count);
  return ids.map(String);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/ids/__tests__/public-id-allocator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/ids/
git commit -m "feat(setu): transactional public-id allocator with counters (issue #4)"
```

---

### Task 4: Mint `publicFid`/`publicMid` in `registerFamily`

**Files:**
- Modify: `apps/portal/src/features/setu/registration/register-family.ts`
- Test: `apps/portal/src/features/setu/registration/__tests__/register-family.test.ts` (extend existing)

**Interfaces:**
- Consumes: `allocateFamilyPublicId`, `allocateMemberPublicIds` (Task 3); `FamilyDoc.publicFid`, `MemberDoc.publicMid` (Task 1).

- [ ] **Step 1: Write the failing test** — assert the written family + members carry the new fields:

```ts
it('assigns publicFid to the family and a publicMid to every member', async () => {
  const res = await registerFamily({
    email: 'a@b.com', phone: '+14165550000', familyName: 'Iyer', location: 'Brampton',
    manager: { firstName: 'Asha', lastName: 'Iyer', gender: 'Female' },
    additionalMembers: [
      { firstName: 'Dev', lastName: 'Iyer', type: 'Child', gender: 'Male' },
      { firstName: 'Mira', lastName: 'Iyer', type: 'Child', gender: 'Female' },
    ],
  });
  const fam = (await fakeDb.collection('families').doc(res.fid).get()).data();
  expect(fam?.publicFid).toBe('1001');
  const members = (await fakeDb.collection('families').doc(res.fid).collection('members').get())
    .docs.map((d) => d.data());
  expect(members.map((m) => m.publicMid).sort()).toEqual(['50001', '50002', '50003']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/registration/__tests__/register-family.test.ts`
Expected: FAIL (`publicFid` undefined).

- [ ] **Step 3: Implement** — allocate BEFORE the transaction, thread into the `set` calls:

After `const fid = generateFid();` (line ~66) add:
```ts
  const publicFid = await allocateFamilyPublicId();
  // manager + each additional member, contiguous: index 0 = manager.
  const publicMids = await allocateMemberPublicIds(1 + input.additionalMembers.length);
  const managerPublicMid = publicMids[0]!;
```
Add `publicFid` to the family `txn.set` payload; add `publicMid: managerPublicMid` to the manager `txn.set`; in the additional-members loop use `publicMids[seq - 1]` (seq starts at 2, so member i gets `publicMids[i+1]`) — set `publicMid: publicMids[memberIndex + 1]`. Add the import at top:
```ts
import { allocateFamilyPublicId, allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS. Then run the whole registration test file to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/registration/register-family.ts apps/portal/src/features/setu/registration/__tests__/register-family.test.ts
git commit -m "feat(setu): assign publicFid/publicMid at family registration (issue #4)"
```

---

### Task 5: Mint at the remaining creation paths

Cover every other place a family or member doc is born so no new record ships without a public id.

**Files (modify each + extend its test):**
- `apps/portal/src/features/setu/registration/lazy-migrate.ts` (lazy legacy migration on first sign-in) — allocate `publicFid` for the family + `publicMid` per member it creates.
- `apps/portal/src/features/setu/teacher/pending-family.ts` — new family → `publicFid`; new child (`nextMid`) → one `publicMid`.
- `apps/portal/src/app/api/setu/members/route.ts` (POST add member, ~line 166 txn) — allocate one `publicMid` before the txn, set on the new member.
- `apps/portal/src/app/api/setu/invite/accept/route.ts` — **first read** the route: if accepting creates/links a *new* member doc, allocate a `publicMid`; if it only attaches a `uid` to an existing member, no change (note the finding in the commit body).
- `apps/portal/src/features/setu/enrollment/enroll-family.ts` (~line 113) — **first read** the route: confirm it does NOT create member docs (it should create enrollments). If it does create members, allocate `publicMid`; otherwise no change.

**Interfaces:** Consumes Task 3 allocators. Each path allocates **before** its `runTransaction`.

- [ ] **Step 1:** For `lazy-migrate.ts` write a failing test asserting a lazily-migrated family has `publicFid` and each created member has `publicMid`. Run it (FAIL). Implement (allocate before the `runTransaction` at line ~47; set fields on each `members.doc(mid)` set at lines ~74/105/128 and on the family doc). Run it (PASS).
- [ ] **Step 2:** For `pending-family.ts` write a failing test (new child gets a `publicMid`; new family gets a `publicFid`). The MID block is built inside a txn at line ~72 — allocate the `publicMid` (and `publicFid` when `createdFamily`) BEFORE the txn opens. Run FAIL → implement → PASS.
- [ ] **Step 3:** For `members/route.ts` POST write a failing test (added member doc has `publicMid`). Allocate before the txn at ~166; set on the new member doc at ~201. Run FAIL → implement → PASS.
- [ ] **Step 4:** Read `invite/accept/route.ts` and `enroll-family.ts`. For each that creates a member doc, add allocation + a test as above. If neither creates members, record that explicitly in the commit message ("invite/accept attaches uid to an existing member — no publicMid mint needed"). 
- [ ] **Step 5:** Run the full portal suite to confirm no regression:

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/registration/lazy-migrate.ts apps/portal/src/features/setu/teacher/pending-family.ts apps/portal/src/app/api/setu/members/ apps/portal/src/app/api/setu/invite/ apps/portal/src/features/setu/enrollment/
git commit -m "feat(setu): mint public ids at all family/member creation paths (issue #4)"
```

---

### Task 6: Search by `publicFid` and `publicMid`

**Files:**
- Modify: `apps/portal/src/features/setu/search/search-families.ts`
- Modify: `firestore.indexes.json` (add a `members.publicMid` collection-group field-override)
- Test: `apps/portal/src/app/api/setu/family/search/__tests__/route.test.ts` and/or the searchFamilies unit test (extend existing)

**Interfaces:** Consumes `publicFid`/`publicMid` fields. The non-contact branch gains two parallel lookups.

**Index note:** `families.where('publicFid','==')` is a single-field collection-scoped query — Firestore auto-indexes it, **no JSON entry**. `db.collectionGroup('members').where('publicMid','==')` needs a single-field **collection-group** index → add a `fieldOverrides` entry. Run the `auditing-firestore-indexes` skill; deploy to UAT only (`--project chinmaya-setu-uat`, never `--force`).

- [ ] **Step 1: Write the failing test** — searching the 4-digit FID and the 5-digit MID each return the family:

```ts
it('finds a family by its 4-digit publicFid', async () => {
  // seed family CMT-X with publicFid '1042'
  const hits = await searchFamilies('1042');
  expect(hits.map((h) => h.fid)).toContain('CMT-X');
});
it('finds a family by a member 5-digit publicMid', async () => {
  // seed family CMT-X with a member publicMid '50007'
  const hits = await searchFamilies('50007');
  expect(hits.map((h) => h.fid)).toContain('CMT-X');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/search`
Expected: FAIL (no match).

- [ ] **Step 3: Implement** — extend the non-contact `Promise.all` in `searchFamilies`:

```ts
const [fidSnap, legacySnap, nameSnap, publicFidSnap, publicMidSnap] = await Promise.all([
  familiesCol.doc(trimmed).get(),
  familiesCol.where('legacyFid', '==', trimmed).limit(1).get(),
  familiesCol.where('searchKeys', 'array-contains', trimmed.toLowerCase()).limit(20).get(),
  familiesCol.where('publicFid', '==', trimmed).limit(5).get(),
  db.collectionGroup('members').where('publicMid', '==', trimmed).limit(5).get(),
]);
```
After the existing `nameSnap` loop, add:
```ts
for (const doc of publicFidSnap.docs) {
  if (!rawHits.has(doc.id)) rawHits.set(doc.id, doc.data() as RawFamilyData);
}
for (const memberDoc of publicMidSnap.docs) {
  const familyRef = memberDoc.ref.parent.parent;   // families/{fid}/members/{mid} -> families/{fid}
  if (familyRef && !rawHits.has(familyRef.id)) {
    const famSnap = await familyRef.get();
    if (famSnap.exists) rawHits.set(familyRef.id, famSnap.data() as RawFamilyData);
  }
}
```
Add the `fieldOverrides` entry to `firestore.indexes.json`:
```json
"fieldOverrides": [
  {
    "collectionGroup": "members",
    "fieldPath": "publicMid",
    "indexes": [
      { "queryScope": "COLLECTION_GROUP", "order": "ASCENDING" }
    ]
  }
]
```
(If `fieldOverrides` already exists, append to it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/search`
Expected: PASS.

- [ ] **Step 5: Deploy the index to UAT and commit**

```bash
firebase deploy --only firestore:indexes --project chinmaya-setu-uat   # NEVER --force, NEVER prod
git add apps/portal/src/features/setu/search/search-families.ts firestore.indexes.json apps/portal/src/app/api/setu/family/search/__tests__/route.test.ts
git commit -m "feat(setu): search families by publicFid + publicMid (issue #4)"
```

---

### Task 7: Show `publicFid` at family level, `publicMid` on member detail

Surface the new numbers via the Task-2 helpers. FID is the prominent family-facing id (per CMT Developer); MID is the per-member id shown only on the member detail page (un-hiding what `ba86989` hid).

**Files (locate exact render sites in Step 1; known leads):**
- Family-level FID display: `apps/portal/src/app/family/_helpers/load-dashboard.ts` consumers — the family dashboard header / family card, and `apps/portal/src/features/setu/search/get-family-for-welcome.ts` consumers (`/welcome/family/[fid]`), welcome roster rows.
- Member MID display: the member detail page under `apps/portal/src/app/family/members/[mid]/` and the profile header component changed in `ba86989` (`git show ba86989 --stat` to find the exact files).
- Test: component tests next to each changed component + the E2E in Task 10.

**Interfaces:** Consumes `displayFid` / `displayMid` (Task 2). Render `displayFid(family)` wherever the family id is shown; render `displayMid(member)` on the member detail page only.

- [ ] **Step 1:** `git show ba86989 --stat` to identify the two files that hid the MID; `grep -rn "\.fid" apps/portal/src/app/family apps/portal/src/app/welcome --include=*.tsx` to find where the raw fid is rendered. List the exact files/lines to change.
- [ ] **Step 2:** Write/extend a component test asserting the family header renders `displayFid(family)` (e.g. shows `1042`, not `CMT-…`) and the member detail page renders `displayMid(member)` (e.g. shows `50001`). Run → FAIL.
- [ ] **Step 3:** Replace each rendered raw `family.fid` with `displayFid(family)` at family-level surfaces; on the member detail page render `displayMid(member)` as the labelled "Member ID" (un-hide the block hidden in `ba86989`). Do NOT add MID to the family-level or family-member-list surfaces (MID stays member-detail-only, per Decision 3). Run → PASS.
- [ ] **Step 4:** Run `pnpm --filter @cmt/portal exec vitest run` for the touched component dirs. Expected PASS.
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(setu): show 4-digit FID at family level + un-hide 5-digit MID on member detail (issue #4)"
```

---

### Task 8: One-time backfill migration script

**Files:**
- Create: `apps/portal/scripts/assign-public-ids.ts`
- Modify: `apps/portal/package.json` (add `"migrate:public-ids": "tsx --env-file=.env.local scripts/assign-public-ids.ts"`)
- Test: `apps/portal/scripts/__tests__/assign-public-ids.test.ts` (if scripts are unit-tested in this repo; else cover the core assign function by extracting it)

**Interfaces:** Reuses Task-3 allocators so runtime + migration draw from the same counters. Mirrors `scripts/migrate-legacy-families.ts` for flag-parsing, the UAT guard, and idempotency.

**Behavior:**
- Iterate all `families` ordered by `createdAt` ASC (oldest family → `1001`, deterministic).
- For each family with no `publicFid`: allocate one, `update({ publicFid })`.
- For each member (subcollection) with no `publicMid`: allocate one, `update({ publicMid })`.
- **Idempotent:** a record that already has its public id is skipped (re-runs are safe).
- **Flags:** `--dry-run` (log, no writes), `--limit N`, `--fid X` (single family), `--csv-out PATH` (old→new mapping), `--allow-prod` (else refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'`).

- [ ] **Step 1:** Read `scripts/migrate-legacy-families.ts` end-to-end; copy its arg-parsing, Firestore init, UAT guard, dry-run/limit/csv-out scaffolding.
- [ ] **Step 2:** Write the script. Core loop (real code):

```ts
const families = await db.collection('families').orderBy('createdAt', 'asc').get();
for (const fam of families.docs) {
  if (limit && processed >= limit) break;
  const data = fam.data();
  if (!data.publicFid) {
    const publicFid = await allocateFamilyPublicId();
    rows.push({ kind: 'family', oldId: fam.id, newId: publicFid });
    if (!dryRun) await fam.ref.update({ publicFid });
  }
  const members = await fam.ref.collection('members').orderBy('joinedAt', 'asc').get();
  for (const mem of members.docs) {
    if (mem.data().publicMid) continue;
    const [publicMid] = await allocateMemberPublicIds(1);
    rows.push({ kind: 'member', oldId: mem.id, newId: publicMid, fid: fam.id });
    if (!dryRun) await mem.ref.update({ publicMid });
  }
  processed++;
}
```
Guard at top: `if (projectId !== 'chinmaya-setu-uat' && !allowProd) { throw new Error('refusing: target is not UAT'); }`.

- [ ] **Step 3:** Add the pnpm alias. Run a dry-run against UAT and eyeball the mapping:

Run: `pnpm --filter @cmt/portal migrate:public-ids --dry-run --limit 5 --csv-out /tmp/public-ids-dry.csv`
Expected: logs 5 families + their members with assigned numbers, **no writes**.

- [ ] **Step 4: Commit (script only — do NOT run the live migration yet)**

```bash
git add apps/portal/scripts/assign-public-ids.ts apps/portal/package.json apps/portal/scripts/__tests__/
git commit -m "feat(setu): idempotent assign-public-ids backfill script, UAT-guarded (issue #4)"
```

---

### Task 9: Mobile changelog + cutover runbook

**Files:**
- Modify: `apps/portal/docs/MOBILE_API_CHANGELOG.md` (prepend a dated, SHA-keyed entry)
- Modify: `docs/runbooks/production-cutover-checklist.md` (record the new UAT migration + counters + index + change-log entry)

- [ ] **Step 1:** Prepend to `MOBILE_API_CHANGELOG.md` (SHA filled at commit time):

```markdown
## `<sha>` · 2026-06-24 · families/members gain public ids (FID 4-digit, MID 5-digit)
- **Family responses** (`GET /api/setu/dashboard`, `GET /api/setu/family`, family search hits, welcome family) gain an additive **`publicFid: string | null`** (4-digit, e.g. `'1042'`). The existing `fid` (`CMT-…`) is unchanged and remains the join key.
- **Member responses** (`GET /api/setu/dashboard` members, `GET /api/setu/members`, member detail) gain an additive **`publicMid: string | null`** (5-digit, e.g. `'50001'`). The existing `mid` (`${fid}-NN`) is unchanged and remains the join key / route param.
  - **Mobile:** add optional `publicFid`/`publicMid` to the family/member schemas; display `publicFid` as the Family ID and `publicMid` as the Member ID (fall back to `fid`/`mid` when null). **Do NOT** use them as join keys or route params — keep using `fid`/`mid`. No request-shape change.
```

- [ ] **Step 2:** Append a dated Change-log entry to the cutover runbook describing: new `counters` collection (`familyPublicId`@1001, `memberPublicId`@50001), the `members.publicMid` collection-group index (UAT-deployed), and the `migrate:public-ids` backfill (UAT, on-demand).
- [ ] **Step 3: Commit**

```bash
git commit -am "docs(setu): mobile changelog + cutover runbook for public ids (issue #4)"
```

---

### Task 10: Run the UAT migration + deployed-UAT E2E verification

**This is the irreversible step — get explicit go-ahead before running the live migration (see Execution Handoff).**

**Files:**
- Create: `apps/portal/e2e/setu/public-ids.spec.ts` (Playwright `setu` project, against `https://cmt-setu.vercel.app`)

- [ ] **Step 1:** Confirm the search/display code is deployed to UAT (`git push` already triggered the Vercel build; verify the deployment is live).
- [ ] **Step 2:** Live backfill, UAT only, with a CSV record:

Run: `pnpm --filter @cmt/portal migrate:public-ids --csv-out /tmp/public-ids-migration.csv`
Expected: every UAT family gets a `publicFid`, every member a `publicMid`; CSV holds the old→new mapping. Re-run once to confirm **idempotency** (0 new assignments).

- [ ] **Step 3:** Write the E2E with a realistic seeded family (the existing seed fixture, now carrying public ids post-migration): sign in, assert the family header shows the 4-digit FID, open a member's detail page and assert the 5-digit MID is shown, and (welcome/admin) search the 4-digit FID and the 5-digit MID and land on the family. Clean up any seeded mutation.
- [ ] **Step 4:** Run the E2E against deployed UAT:

Run: `pnpm --filter @cmt/portal test:e2e -- setu/public-ids.spec.ts` (or the repo's `setu`-project invocation; `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`)
Expected: PASS.

- [ ] **Step 5: Commit + close-out**

```bash
git add apps/portal/e2e/setu/public-ids.spec.ts
git commit -m "test(setu): deployed-UAT e2e for public FID/MID display + search (issue #4)"
git push
```
Then comment the outcome on issue #4 (numbers assigned, counters at, E2E green) and update the relevant memory/resume note.

---

## Self-Review

**Spec coverage:** FID 4-digit/1001 (Tasks 1,3,4,8) · MID 5-digit/50001 (Tasks 1,3,4,8) · MID decoupled + user-facing (Tasks 1,2,7) · all-existing one-time migration (Task 8,10) · assign-at-creation (Tasks 4,5) · FID family-level / MID member-only display (Task 7) · all legacy IDs searchable (Task 6 + additive architecture) · mobile contract (Task 9) · UAT-only + index audit + E2E (Tasks 6,9,10). All decisions covered.

**Open items folded into tasks (not gaps):** exact display render sites (Task 7 Step 1 discovery), whether invite/accept + enroll-family create members (Task 5 Step 4 discovery), migration ordering = `createdAt` ASC (Task 8, stated).

**Type consistency:** `publicFid`/`publicMid` are `string | null | undefined` everywhere; allocators return `string`/`string[]`; helpers accept `{ publicFid?; fid }` / `{ publicMid?; mid }`. Counter docs `{ next: number }`. Consistent across tasks.

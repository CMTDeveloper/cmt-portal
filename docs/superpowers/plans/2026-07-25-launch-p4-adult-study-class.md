# P4 - Adult Study Class - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add an adult-only program that is free to Bala Vihar families and `$101` to everyone else, with a persistent post-donation prompt asking which adults will attend.

**Architecture:** the program is created through the existing admin UI - `programKey` is a free slug, so no schema change is needed. The per-family fee waiver relaxes `suggestedAmountOverride` from `positive()` to `nonnegative()` and writes `0` for Bala Vihar families. The chosen adults are persisted with a new `membershipMode: 'manual'` so the member-sync routine stops recomputing them. The requirement is enforced as a fourth gate alongside profile-completion and disclaimers - never as a block on Bala Vihar enrollment.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Firebase Admin Firestore, Vitest, Playwright.

**Depends on:** P1 (coordinator's `/api/admin/offerings` grant, so a coordinator can set the fee).

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. Specific to this plan:

- **Bespoke single-program surfaces must select by `programKey`** - never `find(e => e.status === 'active')`. That pattern silently broke a real family's attendance on 2026-06-01 and is lint-guarded.
- **N=2**: every fixture needs two adults. A one-adult family passes multi-select tests trivially.

---

## File Structure

- `packages/shared-domain/src/setu/schemas/enrollment.ts` - relax the override, add `membershipMode`
- `apps/portal/src/features/setu/enrollment/enroll-family.ts` - accept an override and explicit mids
- `apps/portal/src/features/setu/enrollment/sync-enrollment-members.ts` - skip manual enrollments
- `apps/portal/src/features/setu/adult-class/eligibility.ts` - NEW: who may be selected
- `apps/portal/src/features/setu/adult-class/gate.ts` - NEW: does the gate fire
- `apps/portal/src/app/adult-class/page.tsx` - NEW: **top-level**, outside `/family`
- `apps/portal/src/app/api/setu/adult-class/route.ts` - NEW: record the selection
- `apps/portal/src/app/family/layout.tsx` - add the gate after the disclaimer gate

---

### Task 1: Allow a zero-amount per-family override

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts:26` and `:53`
- Test: `packages/shared-domain/src/setu/__tests__/schemas.test.ts`
- Test: `apps/portal/src/features/setu/enrollment/__tests__/get-enrollments.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `suggestedAmountOverride` accepts `0`

- [ ] **Step 1: Write the failing test**

```ts
it('accepts a zero override (a waived fee)', () => {
  const parsed = EnrollmentDocSchema.safeParse({ ...baseEnrollment, suggestedAmountOverride: 0 });
  expect(parsed.success).toBe(true);
});

it('still rejects a negative override', () => {
  const parsed = EnrollmentDocSchema.safeParse({ ...baseEnrollment, suggestedAmountOverride: -1 });
  expect(parsed.success).toBe(false);
});
```

And the resolution regression test - **the load-bearing one for this whole plan**:

```ts
it('resolves a ZERO override to 0 and does not fall through to the tier', async () => {
  // get-enrollments resolves with ?? (nullish), NOT ||. If anyone ever
  // "tidies" that into ||, a 0 override falls through to the offering's
  // pricing tier and every waived family is silently charged again.
  // This test is the tripwire for that change.
  await seedOffering({ oid: 'asc-brampton-2026-27', pricingTiers: [{ effectiveFrom: '2026-01-01', amountCAD: 101, label: 'Full year' }] });
  await seedEnrollment({ fid: 'CMT-BV', oid: 'asc-brampton-2026-27', suggestedAmountOverride: 0 });

  const [enrollment] = await getEnrollments('CMT-BV');
  expect(enrollment!.effectiveSuggestedAmount).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/shared-domain test -- schemas && pnpm --filter @cmt/portal test -- get-enrollments`
Expected: FAIL - `positive()` rejects `0`.

- [ ] **Step 3: Relax the constraint**

`enrollment.ts:26`:

```ts
  // nonnegative, not positive: 0 means "fee waived for this family" (Adult
  // Study Class is free to Bala Vihar families). get-enrollments resolves this
  // with ?? so a 0 is honoured rather than falling through to the tier.
  suggestedAmountOverride: z.number().int().nonnegative().nullable(),
```

Apply the same change to the mirrored constraint at `:53`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/shared-domain test && pnpm --filter @cmt/portal test -- get-enrollments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/enrollment.ts \
        packages/shared-domain/src/setu/__tests__/schemas.test.ts \
        apps/portal/src/features/setu/enrollment/__tests__/get-enrollments.test.ts
git commit -m "feat(enrollment): allow a zero suggestedAmountOverride

positive() excluded 0, so no field could express a per-family waived fee -
free-ness was offering-level and all-or-nothing. Adult Study Class needs it
per family: free for Bala Vihar families, \$101 otherwise.

Safe because get-enrollments resolves with ?? (nullish), not ||, so a 0
override is honoured. A regression test pins that: anyone tidying ?? into ||
would silently re-charge every waived family."
```

---

### Task 2: Manual membership that survives member edits

Without this, the selection appears to work, passes its tests, and is silently overwritten the first time a family edits any member - because `sync-enrollment-members.ts:76-88` recomputes `enrolledMids` from eligibility alone on every add, edit and delete.

**Files:**
- Modify: `packages/shared-domain/src/setu/schemas/enrollment.ts`
- Modify: `apps/portal/src/features/setu/enrollment/sync-enrollment-members.ts:76-88`
- Test: `apps/portal/src/features/setu/enrollment/__tests__/sync-enrollment-members.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EnrollmentDoc.membershipMode?: 'auto' | 'manual'` (absent means `'auto'`)

- [ ] **Step 1: Write the failing test**

```ts
it('does NOT add members to a manual enrollment when an unrelated member changes', async () => {
  // The chosen adults must survive an unrelated edit. Without this guard the
  // family picks one parent, later corrects a child's grade, and both parents
  // silently become enrolled.
  await seedFamily({ fid: 'CMT-F', adults: ['CMT-F-01', 'CMT-F-02'], children: ['CMT-F-03'] });
  await seedEnrollment({
    fid: 'CMT-F', oid: 'asc-brampton-2026-27', programKey: 'adult-study-class',
    enrolledMids: ['CMT-F-01'], membershipMode: 'manual',
  });

  await syncActiveEnrollmentMemberships('CMT-F');

  const e = await readEnrollment('CMT-F', 'CMT-F-asc-brampton-2026-27');
  expect(e.enrolledMids).toEqual(['CMT-F-01']);   // CMT-F-02 was NOT added
});

it('still PRUNES a member who left the family from a manual enrollment', async () => {
  await seedFamily({ fid: 'CMT-F', adults: ['CMT-F-01'], children: [] });
  await seedEnrollment({
    fid: 'CMT-F', oid: 'asc-brampton-2026-27', programKey: 'adult-study-class',
    enrolledMids: ['CMT-F-01', 'CMT-F-99'], membershipMode: 'manual',
  });

  await syncActiveEnrollmentMemberships('CMT-F');

  const e = await readEnrollment('CMT-F', 'CMT-F-asc-brampton-2026-27');
  expect(e.enrolledMids).toEqual(['CMT-F-01']);   // the departed mid is gone
});

it('auto enrollments are unaffected', async () => {
  await seedFamily({ fid: 'CMT-G', adults: ['CMT-G-01'], children: ['CMT-G-02', 'CMT-G-03'] });
  await seedEnrollment({
    fid: 'CMT-G', oid: 'bv-brampton-2026-27', programKey: 'bala-vihar',
    enrolledMids: ['CMT-G-02'],
  });

  await syncActiveEnrollmentMemberships('CMT-G');

  const e = await readEnrollment('CMT-G', 'CMT-G-bv-brampton-2026-27');
  expect(e.enrolledMids.sort()).toEqual(['CMT-G-02', 'CMT-G-03']);  // recomputed as before
});
```

Three tests, because "manual" must mean **never add**, **still prune**, and **change nothing for existing programs**.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- sync-enrollment-members`
Expected: FAIL - the first test finds both adults enrolled.

- [ ] **Step 3: Add the field**

In `enrollment.ts`:

```ts
  // 'manual': enrolledMids were chosen explicitly (e.g. which adults attend the
  // Adult Study Class) and must NOT be recomputed from eligibility. Absent or
  // 'auto' keeps the historical behaviour for every existing enrollment.
  membershipMode: z.enum(['auto', 'manual']).optional(),
```

Optional, so every existing document stays valid on read.

- [ ] **Step 4: Teach sync to respect it**

In `sync-enrollment-members.ts`, when `membershipMode === 'manual'`, compute the next `enrolledMids` as the **intersection** of the stored list with currently-eligible members - pruning departures without ever adding. Otherwise keep the existing recomputation untouched.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- sync-enrollment-members`
Expected: PASS, all three.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-domain/src/setu/schemas/enrollment.ts \
        apps/portal/src/features/setu/enrollment/sync-enrollment-members.ts \
        apps/portal/src/features/setu/enrollment/__tests__/sync-enrollment-members.test.ts
git commit -m "feat(enrollment): membershipMode so a manual selection survives edits

sync recomputed enrolledMids from eligibility on every member add, edit and
delete, so an explicitly chosen set would be silently overwritten - a family
picks one parent, later fixes a child's grade, and both parents are enrolled.

Manual enrollments now prune departed members but never add. Optional field,
so every existing enrollment keeps its current behaviour."
```

---

### Task 3: Who may be selected

**Files:**
- Create: `apps/portal/src/features/setu/adult-class/eligibility.ts`
- Test: `apps/portal/src/features/setu/adult-class/__tests__/eligibility.test.ts`

**Interfaces:**
- Consumes: `isTeacherAssigned` from `@/features/setu/teacher/assignments`
- Produces:
  ```ts
  export interface SelectableAdult { mid: string; firstName: string; lastName: string }
  export async function selectableAdults(members: readonly MemberDoc[]): Promise<SelectableAdult[]>
  ```

- [ ] **Step 1: Write the failing test**

One test per row of spec §2.3:

```ts
describe('selectableAdults', () => {
  it('row 1: two non-teaching adults are both selectable', async () => {
    mockTeacherAssigned({});
    const out = await selectableAdults([adult('A1'), adult('A2'), child('C1')]);
    expect(out.map(a => a.mid)).toEqual(['A1', 'A2']);
  });

  it('row 2: a teaching adult is NOT offered', async () => {
    mockTeacherAssigned({ A1: true });
    const out = await selectableAdults([adult('A1'), adult('A2')]);
    expect(out.map(a => a.mid)).toEqual(['A2']);
  });

  it('row 3: both parents teach - nobody is selectable', async () => {
    mockTeacherAssigned({ A1: true, A2: true });
    expect(await selectableAdults([adult('A1'), adult('A2')])).toEqual([]);
  });

  it('row 4: a single teaching parent - nobody is selectable', async () => {
    mockTeacherAssigned({ A1: true });
    expect(await selectableAdults([adult('A1')])).toEqual([]);
  });

  it('row 7: childless family, all adults teach - nobody is selectable', async () => {
    mockTeacherAssigned({ A1: true, A2: true });
    expect(await selectableAdults([adult('A1'), adult('A2')])).toEqual([]);
  });

  it('excludes an adult whose invite is still pending', async () => {
    mockTeacherAssigned({});
    const out = await selectableAdults([adult('A1'), { ...adult('A2'), inviteStatus: 'pending' }]);
    expect(out.map(a => a.mid)).toEqual(['A1']);
  });

  it('children are never selectable', async () => {
    mockTeacherAssigned({});
    const out = await selectableAdults([adult('A1'), child('C1')]);
    expect(out.map(a => a.mid)).toEqual(['A1']);
  });

  it('a teacher between assignments (no levels) reads as selectable', async () => {
    // isTeacherAssigned requires a NON-EMPTY levelIds. Erring toward "asked
    // unnecessarily" is far cheaper than erring toward "silently exempted".
    mockTeacherAssigned({ A1: false });
    const out = await selectableAdults([adult('A1')]);
    expect(out.map(a => a.mid)).toEqual(['A1']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- adult-class/eligibility`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
import 'server-only';
import type { MemberDoc } from '@cmt/shared-domain';
import { isTeacherAssigned } from '@/features/setu/teacher/assignments';

export interface SelectableAdult { mid: string; firstName: string; lastName: string }

/**
 * The adults a family may pick for the Adult Study Class.
 *
 * Teacher-assigned adults are excluded because they are running a class at
 * that hour - the stated reason the requirement does not apply to them. Deriving
 * the rule from that reason rather than from the phrase "if both parents are
 * teachers" is what makes it cover the single-teaching-parent and childless
 * teacher-couple cases too (spec 2.3 rows 3, 4 and 7 all reduce to an empty
 * result here).
 *
 * MUST use isTeacherAssigned (teacherAssignments/{mid}), NOT the `teachers`
 * collection: a sevak who is also a parent has no teachers/ doc, so a
 * teachers-based lookup would find nobody and the rule would never fire.
 */
export async function selectableAdults(
  members: readonly MemberDoc[],
): Promise<SelectableAdult[]> {
  const adults = members.filter(
    (m) => m.type === 'Adult' && m.inviteStatus !== 'pending',
  );
  const teaching = await Promise.all(adults.map((m) => isTeacherAssigned(m.mid)));
  return adults
    .filter((_, i) => !teaching[i])
    .map((m) => ({ mid: m.mid, firstName: m.firstName, lastName: m.lastName }));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- adult-class/eligibility`
Expected: PASS, all eight.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/adult-class/
git commit -m "feat(adult-class): selectable adults are non-teaching adults

Teacher-assigned adults are excluded because they are teaching at that hour.
One rule covers spec 2.3 rows 3, 4 and 7 - both parents teach, a single
teaching parent, and a childless teacher couple - all reduce to an empty
result, where a literal 'if both parents are teachers' check would have
handled only the first.

Uses isTeacherAssigned (teacherAssignments/{mid}), never the teachers
collection: a parent-teacher has no teachers/ doc, so that lookup would find
nobody and the rule would never fire."
```

---

### Task 4: The gate condition

**Files:**
- Create: `apps/portal/src/features/setu/adult-class/gate.ts`
- Test: `apps/portal/src/features/setu/adult-class/__tests__/gate.test.ts`

**Interfaces:**
- Consumes: `selectableAdults` (Task 3), `selectBalaViharEnrollment`
- Produces: `export async function needsAdultClassSelection(fid: string, isManager: boolean): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
describe('needsAdultClassSelection', () => {
  it('fires for a manager of a paid BV family with no selection yet', async () => {
    await seedPaidBvFamily('CMT-A', { adults: ['A1', 'A2'] });
    expect(await needsAdultClassSelection('CMT-A', true)).toBe(true);
  });

  it('does not fire for a non-manager', async () => {
    await seedPaidBvFamily('CMT-A', { adults: ['A1', 'A2'] });
    expect(await needsAdultClassSelection('CMT-A', false)).toBe(false);
  });

  it('does not fire before the BV donation is paid', async () => {
    await seedUnpaidBvFamily('CMT-B', { adults: ['A1'] });
    expect(await needsAdultClassSelection('CMT-B', true)).toBe(false);
  });

  it('does not fire for a family with no BV enrollment (row 6/7)', async () => {
    await seedFamilyNoEnrollments('CMT-C', { adults: ['A1', 'A2'] });
    expect(await needsAdultClassSelection('CMT-C', true)).toBe(false);
  });

  it('does not fire when every adult teaches (row 3)', async () => {
    await seedPaidBvFamily('CMT-D', { adults: ['A1', 'A2'], teaching: ['A1', 'A2'] });
    expect(await needsAdultClassSelection('CMT-D', true)).toBe(false);
  });

  it('stops firing once an adult is selected', async () => {
    await seedPaidBvFamily('CMT-E', { adults: ['A1', 'A2'] });
    await seedAdultClassEnrollment('CMT-E', { enrolledMids: ['A1'] });
    expect(await needsAdultClassSelection('CMT-E', true)).toBe(false);
  });

  it('fires again when the enrollment exists but has NO adults left', async () => {
    // The selected adult later left the family, so enrolledMids is empty.
    // Somebody still needs to attend, so the gate must fire again rather
    // than treat an empty enrollment as satisfied.
    await seedPaidBvFamily('CMT-F', { adults: ['A1'] });
    await seedAdultClassEnrollment('CMT-F', { enrolledMids: [] });
    expect(await needsAdultClassSelection('CMT-F', true)).toBe(true);
  });

  it('fires again for a NEW term when only last term is satisfied', async () => {
    // Offerings are per-term. Checking "any enrollment ever" would silently
    // exempt every returning family after the first year.
    await seedPaidBvFamily('CMT-G', { adults: ['A1'] });
    await seedAdultClassEnrollment('CMT-G', { oid: 'asc-brampton-2025-26', enrolledMids: ['A1'] });
    expect(await needsAdultClassSelection('CMT-G', true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- adult-class/gate`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Implement the five conditions from spec §2.1 in order, returning `false` at the first that fails. Select the Bala Vihar enrollment with `selectBalaViharEnrollment` (never "the first active enrollment"), and scope the adult-class check to the **current term's offering**.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- adult-class/gate`
Expected: PASS, all eight.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/adult-class/gate.ts \
        apps/portal/src/features/setu/adult-class/__tests__/gate.test.ts
git commit -m "feat(adult-class): the gate condition

Fires only for a manager of a Bala-Vihar family whose donation is paid, who
has no current-term selection, and who has at least one non-teaching adult.

Two conditions are tested in isolation for the childless-teacher-couple case
because it fails the gate twice over - a fixture satisfying both would prove
neither. Term-scoped by the current offering: checking 'any enrollment ever'
would silently exempt every returning family after year one."
```

---

### Task 5: The selection screen and its API

**Files:**
- Create: `apps/portal/src/app/adult-class/page.tsx` (**top-level, NOT under `/family`**)
- Create: `apps/portal/src/app/api/setu/adult-class/route.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: route + page tests

**Interfaces:**
- Consumes: `selectableAdults` (Task 3), `enrollFamily`
- Produces: `POST /api/setu/adult-class` with body `{ mids: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
it('rejects an empty selection', async () => {
  const res = await POST(jsonReq({ mids: [] }, MANAGER));
  expect(res.status).toBe(400);
});

it('rejects a mid that is not a selectable adult', async () => {
  // A teaching adult or a child must not be enrollable by crafting a request.
  const res = await POST(jsonReq({ mids: ['CMT-F-03'] }, MANAGER));
  expect(res.status).toBe(400);
});

it('enrolls ALL chosen adults at zero cost for a BV family', async () => {
  const res = await POST(jsonReq({ mids: ['CMT-F-01', 'CMT-F-02'] }, MANAGER));
  expect(res.status).toBe(200);
  const e = await readAdultClassEnrollment('CMT-F');
  expect(e.enrolledMids.sort()).toEqual(['CMT-F-01', 'CMT-F-02']);
  expect(e.suggestedAmountOverride).toBe(0);       // two adults still cost 0
  expect(e.membershipMode).toBe('manual');
});

it('does NOT waive the fee for a family with no BV enrollment', async () => {
  const res = await POST(jsonReq({ mids: ['CMT-N-01'] }, MANAGER_NO_BV));
  expect(res.status).toBe(200);
  const e = await readAdultClassEnrollment('CMT-N');
  expect(e.suggestedAmountOverride).toBeNull();    // resolves to the $101 tier
});

it('403 for a non-manager family member', async () => {
  const res = await POST(jsonReq({ mids: ['CMT-F-01'] }, MEMBER));
  expect(res.status).toBe(403);
});
```

The third and fourth tests together are the fee rule: selecting two adults still costs `$0`, and a childless family is not waived.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- api/setu/adult-class`
Expected: FAIL - route missing.

- [ ] **Step 3: Implement the route**

Manager-only. Validate that every submitted mid is in `selectableAdults` for **this** family - never trust the client's list. Resolve the current adult-class offering, then enroll with `enrolledMids` = the chosen mids, `membershipMode: 'manual'`, `enrolledVia: 'family-initiated'`, and `suggestedAmountOverride: 0` **only when** the family has an active Bala Vihar enrollment (selected by `programKey`).

> `enrolledVia: 'family-initiated'` matters beyond bookkeeping: it self-confirms in `isEnrollmentConfirmed` (`enrollment-confirmation.ts:34`), so a `$0` adult-class enrollment reads **Enrolled** without any donation. No new confirmation logic is needed.

- [ ] **Step 4: Add the canAccessRoute rule**

`/api/setu/adult-class` would otherwise fall to the `/api/setu/` catch-all, which grants welcome-team. Add an explicit rule limiting it to `isSetuManager`, plus a test.

`/adult-class` is a **page** outside `/family`, so it also needs its own rule granting `isSetuFamily` - exactly like `/complete-profile` and `/acknowledgements`.

- [ ] **Step 5: Build the page**

Top-level route at `/adult-class`. Lists `selectableAdults` as a **multi-select, minimum one**, preselecting when there is only one. Copy must include the note that **one parent needs to be present during Bala Vihar classes** (O7 - use Vaibhav's wording when it arrives; ship a clear placeholder sentence, not an empty element).

On save, use `window.location.assign('/family')` - **never `router.push`**. A soft push back into a `redirect()` gate re-reads a stale `use cache` value, bounces to the same route, and React preserves component state; that is precisely what once stranded `/complete-profile` on "Saving…" forever.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- adult-class && pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: PASS.

- [ ] **Step 7: Mobile API changelog**

Add a dated entry for `POST /api/setu/adult-class`: body, auth, error codes, and that the mobile app should surface the same selection.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/app/adult-class/ apps/portal/src/app/api/setu/adult-class/ \
        packages/shared-domain/src/auth/can-access-route.ts apps/portal/docs/MOBILE_API_CHANGELOG.md
git commit -m "feat(adult-class): selection screen and enrollment endpoint

Multi-select, minimum one, every chosen adult free for a Bala Vihar family -
the waiver sits on the enrollment, so two adults cost exactly what one does.
A test pins that. Families without a BV enrollment are not waived and pay
the configurable \$101 through the existing Stripe path.

The page is TOP-LEVEL, outside /family, like /complete-profile and
/acknowledgements: a gated screen nested inside the gated layout inherits
the gate and loops under soft navigation. Leaving it uses
window.location.assign so the gate re-runs server-side on fresh data.

The server re-derives selectable adults and rejects anything else, so a
crafted request cannot enroll a child or a teaching adult."
```

---

### Task 6: Wire the gate into the family layout

**Files:**
- Modify: `apps/portal/src/app/family/layout.tsx`
- Test: `apps/portal/src/app/family/__tests__/layout.test.tsx`

**Interfaces:**
- Consumes: `needsAdultClassSelection` (Task 4)
- Produces: `AdultClassGate`

- [ ] **Step 1: Write the failing test**

```tsx
it('redirects a paid BV manager with no selection to /adult-class', async () => { /* ... */ });

it('defers to the profile gate when the profile is incomplete', async () => {
  // Ordering must not depend on Suspense resolution order: an incomplete
  // profile must never be asked to pick an adult first.
  expect(await AdultClassGate()).toBeNull();
});

it('defers to the disclaimer gate when disclaimers are unaccepted', async () => {
  expect(await AdultClassGate()).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- family/layout`
Expected: FAIL - `AdultClassGate` does not exist.

- [ ] **Step 3: Implement**

Add `AdultClassGate` after `DisclaimerGate`, guarding on both earlier gates exactly as `DisclaimerGate` already guards on profile completeness (`layout.tsx:76`), then `redirect('/adult-class')`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- family/layout`
Expected: PASS.

- [ ] **Step 5: Deployed-UAT E2E**

Create `apps/portal/e2e/setu/family/adult-class.spec.ts`:
- password sign-in as a **two-adult, paid-BV** family manager
- assert the redirect to `/adult-class`
- select **both** adults and save
- assert landing on `/family` with no bounce-back
- **soft-navigate** away and back to `/family` and assert the gate does not re-fire (the loop this design exists to prevent)
- assert the enrollment shows `$0`

Run: `pnpm test:e2e -- adult-class`

> A unit test cannot prove the gate does not loop. That failure lives in the interaction between `redirect()`, `use cache` and soft navigation - the integration layer mocks cannot see.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/app/family/layout.tsx apps/portal/e2e/setu/family/adult-class.spec.ts
git commit -m "feat(adult-class): enforce the selection as a fourth family gate

Runs after profile-completion and disclaimers, deferring to both explicitly
so Suspense resolution order cannot decide which screen a family lands on.
Never blocks Bala Vihar enrollment - by the time it fires, enrollment and
payment are already complete.

E2E covers the soft-navigation loop case, which no unit test can reach."
```

---

### Task 7: Create the program in UAT

**Files:** none - configuration through the existing admin UI.

- [ ] **Step 1: Create the program**

As an admin at `/admin/programs`, create:
- `programKey`: `adult-study-class`
- label: `Adult Study Class`
- status: `active`
- eligibility: `memberType: 'adult'`
- capabilities: `usesOfferings: true`, `usesDonation: true`, `usesLevels: false`, `usesCalendar: false`, `attendanceMode: 'none'`

- [ ] **Step 2: Create the offering**

One offering per location for the launch term, with `pricingTiers: [{ effectiveFrom: '<term start>', amountCAD: 101, label: 'Full year' }]`.

- [ ] **Step 3: Verify the coordinator can edit the amount**

Sign in as the **coordinator** persona (seeded in P1 Task 4), open the offerings panel, change the amount, and save. This is the P1 `/api/admin/offerings` grant working end to end - **without it the panel renders and the save 403s.**

- [ ] **Step 4: Verify the adult-only path**

Register a family with **no children**, confirm the Adult Study Class is offered, enroll, and confirm it routes to Stripe for `$101`.

> No adult-only family exists in production today, and `memberType: 'adult'` has never run in production. Two things to check rather than assume: registration completes with zero children, and the enroll surface offers an adult program to a childless family. If `no-eligible-members` surfaces, its copy is Bala-Vihar-specific (*"Add a child to your family before enrolling in Bala Vihar"*) and would read as nonsense here.

- [ ] **Step 5: Update the runbook**

Add the program and offering creation to §6 of `docs/runbooks/production-cutover-checklist.md` as prod-cutover steps, plus a dated §14 entry.

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md
git commit -m "docs(runbook): adult-study-class program setup for prod cutover

Records the program and offering to create at cutover, and the two paths
that have never run in production: memberType 'adult' enrollment, and a
family with no children."
```

---

## Self-Review

**Spec coverage** - `2026-07-25-adult-study-class-design.md`:
- §2.1 all five gate conditions → Task 4 ✅
- §2.2 selectable = non-teaching adults → Task 3 ✅
- §2.3 scenario matrix rows 1-7 → Task 3 (rows 1-4, 7) + Task 4 (rows 6, 7) + Task 7 Step 4 (row 6 live) ✅
- §4.1 program definition → Task 7 ✅
- §4.2 zero override + `??` regression → Task 1 ✅
- §4.3 multi-select, min one, copy note → Task 5 ✅
- §4.3a adult-only Stripe path → Task 7 Step 4 ✅
- §4.3b coordinator-editable amount → Task 7 Step 3 (grant itself is P1) ✅
- §4.4 `isTeacherAssigned`, pending invites, zero-level teachers → Task 3 ✅
- §4.5 selected parent removed → Task 2 test 2 + Task 4 test 7 ✅
- §4.6 R1-R4 gate rules → Task 5 Step 5 (R1, R2), Task 6 Step 3 (R4) ✅
- §4.6.1 term scoping → Task 4 test 8 ✅
- §5 roster-confirmation bug → **P2 Task 1** (cross-plan, deliberate) ✅
- §6 verification 1-7 → Tasks 1-7 ✅

> **R3 note** (do not decide from a read you just invalidated): enforced by Task 5's `window.location.assign`, which re-runs the gate server-side rather than re-reading client-side. No separate task.

**Placeholder scan:** no TBD/TODO. Task 5 Step 5 ships a clear sentence pending Vaibhav's exact copy (O7) rather than an empty element - stated explicitly.

**Type consistency:** `SelectableAdult` (Task 3) is consumed in Task 5. `needsAdultClassSelection(fid, isManager)` (Task 4) is called with that signature in Task 6. `membershipMode: 'auto' | 'manual'` (Task 2) is written in Task 5 and read in Task 2's sync. `suggestedAmountOverride: 0` (Task 1) is written in Task 5 and asserted in both.

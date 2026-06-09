# Rollover "Set grade" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an admin resolve a "needs‑grade" child during the school‑year rollover without leaving the flow — (1) an inline **Set grade** control on each *need‑attention* row of the rollover preview, and (2) make the **"Review →"** target (the welcome member detail page) actually editable by an admin for the child's grade. Both write through one new admin endpoint.

**Architecture:** A new admin-only `POST /api/admin/school-year/set-grade` (covered by the existing `/api/admin/*` canAccessRoute catch-all) writes `families/{fid}/members/{mid}.schoolGrade` via a shared `setMemberGrade()` server helper. The rollover preview's need‑attention rows (which already carry `fid` + `mid`) gain an inline grade picker that calls it, then re-runs the dry‑run preview. The welcome member detail page gains an admin‑gated grade editor that calls the same endpoint. No schema change (`schoolGrade` already exists), no new index.

**Tech Stack:** Next.js 16 App Router, TS (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` ON), Firestore Admin, Zod in `@cmt/shared-domain`, Vitest + Testing Library, Playwright (deployed-UAT).

## Standing constraints
- UAT-only DB writes; never prod 715b8; never `--force` indexes; never `--no-verify`; `git push` after each commit (pre-push gate).
- Roles via `isAdmin` helper. New `/api/admin/*` path is admin-only via the catch-all — still add a canAccessRoute test for it.
- Grade values are the canonical `GRADE_LADDER` (`JK, SK, 1…12`) from `@cmt/shared-domain`.
- Mobile-ready (the inline control must work in the rollover screen's mobile layout); `.csp` token scoping; ≥44px tap targets.
- TDD; tests in the same commit; designer-quality UI on the two interactive surfaces.

## Confirmed facts
- `PromotionRow` (`@cmt/shared-domain`) carries `fid`, `mid`, `childName`, `outcomeKind`. The preview's `report.attention: PromotionRow[]` is rendered in `apps/portal/src/features/setu/rollover/components/promotion-preview.tsx`.
- The preview is produced by `POST /api/admin/school-year/promote {dryRun:true}` via `rollover-client.ts` (`previewPromotion()` / `commitPromotion()`). The page component that owns refresh: `apps/portal/src/features/setu/rollover/components/{rollover-page,promote-step}.tsx`.
- `decidePromotion` (grade-ladder.ts): a child with a valid ladder grade → `advance`; so setting a grade flips a `needs-grade` row to `advance` on the next preview.
- Member doc write: `families/{fid}/members/{mid}`, field `schoolGrade`. `portalFirestore()` from `@cmt/firebase-shared/admin/firestore`.
- The welcome member detail page is `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx` (currently read-only; admins reach it because they inherit welcome-team). The "Review →" link already points here.
- `/api/admin/*` is admin-only (can-access-route.ts:42). `readSessionFromHeaders` (`@/lib/auth/headers`) for API auth.
- Seed E2E child: `fid=CMT-FSWEDU2X`, child `mid=CMT-FSWEDU2X-02`, `schoolGrade='Grade 4'` — usable for a set→revert E2E.

---

### Task 1: Shared set-grade schema

**Files:** Create `packages/shared-domain/src/setu/set-grade.ts`; modify `packages/shared-domain/src/setu/index.ts`; test `packages/shared-domain/src/setu/__tests__/set-grade.test.ts`.

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SetMemberGradeBodySchema } from '../set-grade';

describe('SetMemberGradeBodySchema', () => {
  it('accepts a fid/mid + a ladder grade', () => {
    const p = SetMemberGradeBodySchema.parse({ fid: 'CMT-X', mid: 'CMT-X-01', schoolGrade: '4' });
    expect(p.schoolGrade).toBe('4');
  });
  it('rejects an off-ladder grade and a missing fid', () => {
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'CMT-X', mid: 'm', schoolGrade: 'Grade 4' }).success).toBe(false);
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'CMT-X', mid: 'm', schoolGrade: '13' }).success).toBe(false);
    expect(SetMemberGradeBodySchema.safeParse({ mid: 'm', schoolGrade: '4' }).success).toBe(false);
  });
  it('accepts JK and SK', () => {
    expect(SetMemberGradeBodySchema.safeParse({ fid: 'f', mid: 'm', schoolGrade: 'JK' }).success).toBe(true);
  });
});
```

- [ ] **Step 2:** run → fail (`pnpm --filter @cmt/shared-domain test -- set-grade`).
- [ ] **Step 3: implement**

```ts
// packages/shared-domain/src/setu/set-grade.ts
import { z } from 'zod';
import { GRADE_LADDER } from './grade-ladder';

// Grade is restricted to the canonical promotion ladder so a set value always
// resolves on the next rollover preview (no free-text "Grade 4" that needs
// normalizing). Shishu (age-based, no grade) is out of scope for this control.
export const SetMemberGradeBodySchema = z.object({
  fid: z.string().min(1),
  mid: z.string().min(1),
  schoolGrade: z.enum(GRADE_LADDER),
});
export type SetMemberGradeBody = z.infer<typeof SetMemberGradeBodySchema>;
```

Add `export * from './set-grade';` to `src/setu/index.ts`.

- [ ] **Step 4:** run → pass.
- [ ] **Step 5: commit**

```bash
git add packages/shared-domain/src/setu/set-grade.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/set-grade.test.ts
git commit -m "feat(rollover): shared set-member-grade schema (ladder-validated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 2: Server helper + admin endpoint

**Files:** Create `apps/portal/src/features/setu/rollover/set-member-grade.ts`; create `apps/portal/src/app/api/admin/school-year/set-grade/route.ts`; test the route `apps/portal/src/app/api/admin/school-year/set-grade/__tests__/route.test.ts`; add a canAccessRoute test case in `packages/shared-domain/src/__tests__/can-access-route.test.ts`.

- [ ] **Step 1: server helper**

```ts
// apps/portal/src/features/setu/rollover/set-member-grade.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { SetMemberGradeBody } from '@cmt/shared-domain';

/** Sets one child's schoolGrade. Returns false if the member doc doesn't exist. */
export async function setMemberGrade({ fid, mid, schoolGrade }: SetMemberGradeBody): Promise<boolean> {
  const ref = portalFirestore().collection('families').doc(fid).collection('members').doc(mid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ schoolGrade });
  return true;
}
```

- [ ] **Step 2: failing canAccessRoute test** (admin-only)

```ts
// add to can-access-route.test.ts
it('set-grade is admin only', () => {
  expect(canAccessRoute({ role: 'admin' } as SessionClaims, '/api/admin/school-year/set-grade', 'POST')).toBe(true);
  expect(canAccessRoute({ role: 'welcome-team' } as SessionClaims, '/api/admin/school-year/set-grade', 'POST')).toBe(false);
});
```
(This passes via the existing `/api/admin/*` catch-all — the test just locks it in; no rule change needed.)

- [ ] **Step 3: failing route test** (mock `setMemberGrade` + `flags`)

Cover: 401 no session; 403 non-admin (`x-portal-role: welcome-team`); 400 bad body (off-ladder grade); 404 when `setMemberGrade` returns false; 200 on success.

- [ ] **Step 4: implement route**

```ts
// apps/portal/src/app/api/admin/school-year/set-grade/route.ts
import { NextResponse } from 'next/server';
import { isAdmin, SetMemberGradeBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { setMemberGrade } from '@/features/setu/rollover/set-member-grade';

export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = SetMemberGradeBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  const ok = await setMemberGrade(parsed.data);
  if (!ok) return NextResponse.json({ error: 'member-not-found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 5:** run both test files green; typecheck.
- [ ] **Step 6: commit**

```bash
git add apps/portal/src/features/setu/rollover/set-member-grade.ts apps/portal/src/app/api/admin/school-year/set-grade/ packages/shared-domain/src/__tests__/can-access-route.test.ts
git commit -m "feat(rollover): admin set-grade endpoint + server helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 3: Inline "Set grade" on rollover need-attention rows (designer)

**Files:** Create `apps/portal/src/features/setu/rollover/set-grade-client.ts`; modify `promotion-preview.tsx` (inline control on each `attention` row) and thread an `onResolved` refresh callback from `rollover-page.tsx` / `promote-step.tsx` (whichever owns the dry-run fetch) down to the preview; component test `components/__tests__/` (extend the existing rollover-ui test or add one).

- **Client:** `setGradeClient({fid,mid,schoolGrade})` → `POST /api/admin/school-year/set-grade`, throw on non-OK (toast on failure, like other clients).
- **Inline control:** on each need-attention `<li>`, render a compact grade `<select>` (the `GRADE_LADDER` options, placeholder "Set grade") + a "Save" button (≥44px, brand tokens). On save → `setGradeClient` → toast success → call `onResolved()` (re-runs the dry-run preview so the row leaves *need attention*). Keep the existing "Review →" link too. Disable the row while saving.
- **Refresh wiring:** find where `previewPromotion()` result is held; expose a `refresh()` that re-fetches it and pass it to `<PromotionPreview onResolved={refresh} … />`. (The page already has a "Refresh preview" affordance — reuse that handler.)
- Per the avoid-nested-component rule, keep any new row component module-scope.

- [ ] **Step 1:** failing component test — render `PromotionPreview` with a `needs-grade` attention row + a mocked `setGradeClient`/`onResolved`; select a grade, click Save, assert `setGradeClient` called with the row's fid/mid + grade and `onResolved` fired.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3:** implement client + inline control + refresh wiring.
- [ ] **Step 4:** run component test green; `pnpm --filter @cmt/portal typecheck && lint`.
- [ ] **Step 5: commit**

```bash
git add apps/portal/src/features/setu/rollover/set-grade-client.ts apps/portal/src/features/setu/rollover/components/
git commit -m "feat(rollover): inline Set grade control on need-attention rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 4: Admin grade editor on the welcome member detail page (designer)

**Files:** modify `apps/portal/src/app/welcome/family/[fid]/members/[mid]/page.tsx` (+ a small `'use client'` editor component under `features/setu/...` or co-located) ; resolve `isAdmin` from the session cookie (mirror `welcome/layout.tsx`); render an admin-only **Set grade** inline editor (reuses `setGradeClient` from Task 3). Welcome-team (non-admin) sees the page unchanged (read-only). Component/render test.

- The editor: shows the current grade + a `GRADE_LADDER` `<select>` + "Save" (admin only). On save → `setGradeClient({ fid, mid, grade })` → toast → refresh the page data (router.refresh()).
- Keep it minimal: grade only (not a full member edit).

- [ ] **Step 1:** failing render test — the member detail body renders the grade editor when `isAdmin` and not when not. (Mock the client.)
- [ ] **Step 2:** run → fail.
- [ ] **Step 3:** implement (gate on `isAdmin`; the page already resolves the session — add `isAdmin` if not present).
- [ ] **Step 4:** run test green; typecheck + lint.
- [ ] **Step 5: commit**

```bash
git add apps/portal/src/app/welcome/family/
git commit -m "feat(rollover): admin grade editor on welcome member detail (Review → is now actionable)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 5: Full gate + Playwright E2E (deployed UAT)

**Files:** Create `apps/portal/e2e/setu/admin/rollover-set-grade.spec.ts`.

- [ ] **Step 1: full gate** `pnpm typecheck && lint && test && build` (each push already ran it; confirm once more).
- [ ] **Step 2: re-seed** `pnpm --filter @cmt/portal seed:e2e-family`.
- [ ] **Step 3: write the spec** — as admin (setu storageState), against deployed UAT:
  - **set-grade endpoint round-trip (mutation + revert):** `POST /api/admin/school-year/set-grade {fid:'CMT-FSWEDU2X', mid:'CMT-FSWEDU2X-02', schoolGrade:'5'}` → 200; then revert `→ '4'` → 200 (the seed child is normally 'Grade 4'; re-seed restores it). Also assert `{schoolGrade:'13'}` → 400 and a non-existent mid → 404.
  - **rollover screen renders the inline control:** go to `/admin/school-year`; if the need-attention disclosure is open with rows, assert a visible grade `<select>` / "Save" within a need-attention row (skip the assertion gracefully if UAT currently has 0 need-attention rows).
  - **member detail admin editor:** go to `/welcome/family/CMT-FSWEDU2X/members/CMT-FSWEDU2X-02`; assert the admin grade editor renders.
- [ ] **Step 4: run** `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu --project=setup rollover-set-grade` → green (after Tasks 1–4 deployed). Then full suite regression: `PLAYWRIGHT_BASE_URL=… pnpm test:e2e | tail`.
- [ ] **Step 5: commit**

```bash
git add apps/portal/e2e/setu/admin/rollover-set-grade.spec.ts
git commit -m "test(rollover): E2E for admin set-grade (endpoint round-trip + UI) vs deployed UAT

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 6: Runbook + final review

- [ ] **Step 1:** runbook §14 note — new admin route `POST /api/admin/school-year/set-grade` (admin-only); members' `schoolGrade` is now admin-settable from the rollover screen + the welcome member detail; no schema/index change; UAT writes are feature writes (not a migration).
- [ ] **Step 2:** final code review (UI + endpoint); address findings; commit.

```bash
git add docs/runbooks/production-cutover-checklist.md
git commit -m "docs: runbook note for admin set-grade route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

## Self-review
- Both asks covered: inline set-grade on the rollover row (T3) + actionable "Review →" via an admin editor on the member detail (T4), sharing one admin endpoint (T2) + schema (T1).
- No schema/index change; admin-only via existing catch-all (+ a locking test). Mutation E2E reverts (T5). Grade restricted to the ladder so a set value always resolves on the next preview.

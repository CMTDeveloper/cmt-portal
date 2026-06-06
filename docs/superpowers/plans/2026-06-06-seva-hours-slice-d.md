# Seva Hours — Slice D (Surfacing & compliance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make seva progress visible everywhere. (1) The family dashboard (`/family`) gets a **"Seva hours · X of {target}"** progress card with a gentle reminder when short. (2) Admin/welcome-team get a **compliance report** at `/welcome/seva/compliance` (every registered family vs the target) backed by `GET /api/welcome/seva/compliance`. (3) The welcome family-detail page (`/welcome/family/[fid]`) shows that family's seva hours for the year. The admin requirement-config editor already exists (Slice A `SevaManager`) — no new editor.

**Architecture:** A light `getFamilySevaProgress(fid)` reader (`getSevaRequirement` + `listFamilySignups`, summing completed hours for the current year — does NOT fetch opportunities, unlike `getFamilySevaView`) feeds the dashboard card and the family-detail line. A pure `deriveSevaCardView` makes the card's display values unit-testable. Compliance enumerates ALL setu families (`listAllSetuFamilies`) and left-joins each family's completed hours for the year (`getSevaCompliance`), so a family with zero sign-ups still shows "0 of {target}". All single-field Firestore queries — no new composite index.

**Tech Stack / strict flags / conventions:** identical to Slices A–C — see those plans + `docs/superpowers/specs/2026-06-05-seva-hours-design.md`.

## Cross-cutting (REPEAT of the hard rules — do not skip)
- **Mobile-app readiness:** the new `/api/welcome/seva/compliance` handler derives identity via `readSessionFromHeaders(req)` + `isWelcomeTeam(session)` — NEVER `cookies()`/`getCurrentFamily()` in a handler. JSON, ISO dates, numbers-as-numbers, `{ ... }`/`{ error }` envelope. Server **pages** (`/family`, `/welcome/seva/compliance`, `/welcome/family/[fid]`) are web render and MAY use `getCurrentFamily()`/`cookies()`.
- **Modern on-theme UX:** Cool-Mist tokens, `CspRoot`/`.csp` scoping, real mobile (`block md:hidden`) + desktop (`hidden md:block`) layouts, designer pass for new surfaces. Mirror the existing dashboard cards (`app/family/page.tsx`), `SevaManager`, and `app/welcome/family/[fid]/page.tsx`.
- **Role checks via helpers** (`isWelcomeTeam`/`isAdmin`), never strict equality. **`exactOptionalPropertyTypes`** — conditional-spread, never assign `undefined`.
- **N=2 trap:** every family-hours sum must add ALL completed sign-ups for the year, never "the first". Test with TWO completed sign-ups summing.

## Index strategy — still NO new composite index
Compliance queries completed sign-ups for a year via a SINGLE-field `where('seva_signups').where('sevaYear','==',year)` and filters `status==='completed'` + groups by `fid` IN MEMORY. `listAllSetuFamilies` is a plain `collection('families').get()`. `getFamilySevaProgress` reuses the single-field `listFamilySignups(fid)`. No two-field `where`/`orderBy` on `seva_signups` is introduced, so **no `firestore.indexes.json` change and no index deploy.** (If scale ever makes the year-wide read too heavy, revisit with a `(sevaYear,status)` composite in a dedicated change, UAT-only, never `--force` prod.)

## canAccessRoute — one addition
`/api/welcome/seva/compliance` is under `/api/welcome/seva/`, already gated to `isWelcomeTeam` by the existing rule (`can-access-route.ts:159`). The page `/welcome/seva/compliance` is under `/welcome/*` → `isWelcomeTeam`. **No `can-access-route.ts` production change** — add a confirming assertion test only (Task D3).

---

## File structure

**Create:**
- `apps/portal/src/features/setu/seva/get-family-seva-progress.ts` — `getFamilySevaProgress(fid)` + `FamilySevaProgress` type + pure `deriveSevaCardView`.
- `apps/portal/src/features/setu/seva/get-seva-compliance.ts` — `listAllSetuFamilies()`, `getSevaCompliance()` + types.
- `apps/portal/src/app/api/welcome/seva/compliance/route.ts` — GET.
- `apps/portal/src/features/admin/seva/compliance-client.ts` — client wrapper + serialized types.
- `apps/portal/src/features/admin/seva/compliance-report.tsx` — themed report UI.
- `apps/portal/src/app/welcome/seva/compliance/page.tsx` — server page.
- `apps/portal/src/features/family/components/seva-progress-card.tsx` — the dashboard card (server-safe presentational component).
- Tests alongside each.

**Modify:**
- `apps/portal/src/features/setu/seva/get-signups.ts` (+ test) — add `listCompletedSignupsForYear(sevaYear)`.
- `apps/portal/src/app/family/page.tsx` — fetch `getFamilySevaProgress` + render `<SevaProgressCard>` (mobile + desktop) when a seva year is set.
- `apps/portal/src/app/welcome/family/[fid]/page.tsx` (+ test) — fetch + show the family's seva hours.
- `apps/portal/src/features/admin/seva/seva-manager.tsx` (+ test) — add a "Compliance report" link near the header.

---

## Task D1: Family seva-progress reader + pure card view

**Files:** create `apps/portal/src/features/setu/seva/get-family-seva-progress.ts` + `__tests__/get-family-seva-progress.test.ts`.

- [ ] **Step 1 — failing test:** mock `@/lib/seva-requirement` (`getSevaRequirement`) and `./get-signups` (`listFamilySignups`). Assert:
  - `getFamilySevaProgress`: when `currentSevaYear` is null → `{ currentSevaYear: null, hoursPerYear, hoursEarned: 0 }` and does NOT call `listFamilySignups`.
  - sums ONLY `completed` sign-ups in the current year: two completed (`hoursAwarded` 3 and 2) ⇒ `hoursEarned === 5`; a `signed-up`, a `no-show`, a `cancelled`, and a completed sign-up from a DIFFERENT `sevaYear` are all excluded.
  - `deriveSevaCardView` (pure): `currentSevaYear` null → `{ show: false, pct: 0, remaining: hoursPerYear, complete: false }`; `hoursEarned: 5, hoursPerYear: 20` → `{ show: true, pct: 25, remaining: 15, complete: false }`; `hoursEarned: 22, hoursPerYear: 20` → `{ show: true, pct: 100, remaining: 0, complete: true }`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/seva-requirement', () => ({ getSevaRequirement: vi.fn() }));
vi.mock('../get-signups', () => ({ listFamilySignups: vi.fn() }));
import { getFamilySevaProgress, deriveSevaCardView } from '../get-family-seva-progress';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listFamilySignups } from '../get-signups';

function su(over: Record<string, unknown>) {
  return { signupId: 'x', oppId: 'o', fid: 'F1', mid: null, sevaYear: '2025-26', status: 'completed', hoursAwarded: 0, signedUpAt: new Date(), signedUpByMid: null, confirmedAt: null, confirmedBy: null, ...over };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' }); });

describe('getFamilySevaProgress', () => {
  it('returns zero + skips the signup read when no seva year', async () => {
    vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: null });
    const p = await getFamilySevaProgress('F1');
    expect(p).toEqual({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 });
    expect(listFamilySignups).not.toHaveBeenCalled();
  });
  it('sums only completed signups in the current year', async () => {
    vi.mocked(listFamilySignups).mockResolvedValue([
      su({ status: 'completed', hoursAwarded: 3 }),
      su({ status: 'completed', hoursAwarded: 2 }),
      su({ status: 'signed-up', hoursAwarded: 0 }),
      su({ status: 'no-show', hoursAwarded: 0 }),
      su({ status: 'cancelled', hoursAwarded: 9 }),
      su({ status: 'completed', hoursAwarded: 7, sevaYear: '2024-25' }),
    ] as never);
    expect((await getFamilySevaProgress('F1')).hoursEarned).toBe(5);
  });
});

describe('deriveSevaCardView', () => {
  it('hidden when no seva year', () => {
    expect(deriveSevaCardView({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 })).toEqual({ show: false, pct: 0, remaining: 20, complete: false });
  });
  it('partial progress', () => {
    expect(deriveSevaCardView({ currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 5 })).toEqual({ show: true, pct: 25, remaining: 15, complete: false });
  });
  it('complete + capped at 100', () => {
    expect(deriveSevaCardView({ currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 22 })).toEqual({ show: true, pct: 100, remaining: 0, complete: true });
  });
});
```

- [ ] **Step 2 — confirm RED.**
- [ ] **Step 3 — implement** (`get-family-seva-progress.ts`):
```ts
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listFamilySignups } from './get-signups';

export interface FamilySevaProgress {
  currentSevaYear: string | null;
  hoursPerYear: number;
  hoursEarned: number;
}

export async function getFamilySevaProgress(fid: string): Promise<FamilySevaProgress> {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) return { currentSevaYear: null, hoursPerYear, hoursEarned: 0 };
  const signups = await listFamilySignups(fid);
  const hoursEarned = signups
    .filter((s) => s.sevaYear === currentSevaYear && s.status === 'completed')
    .reduce((sum, s) => sum + (s.hoursAwarded ?? 0), 0);
  return { currentSevaYear, hoursPerYear, hoursEarned };
}

export interface SevaCardView {
  show: boolean;
  pct: number;
  remaining: number;
  complete: boolean;
}

// Pure derivation for the dashboard card — unit-tested without Firestore.
export function deriveSevaCardView(p: FamilySevaProgress): SevaCardView {
  if (p.currentSevaYear == null) {
    return { show: false, pct: 0, remaining: p.hoursPerYear, complete: false };
  }
  const pct = p.hoursPerYear > 0 ? Math.min(100, Math.round((p.hoursEarned / p.hoursPerYear) * 100)) : 0;
  const remaining = Math.max(0, p.hoursPerYear - p.hoursEarned);
  return { show: true, pct, remaining, complete: p.hoursEarned >= p.hoursPerYear };
}
```

- [ ] **Step 4 — run + `tsc --noEmit` → green. Step 5 — commit:** `feat(seva): family seva-progress reader + pure card view`.

---

## Task D2: Dashboard seva-hours card

**Files:** create `apps/portal/src/features/family/components/seva-progress-card.tsx` + `__tests__/seva-progress-card.test.tsx`; modify `apps/portal/src/app/family/page.tsx`.

The card is a presentational (NOT `'use client'` needed — pure render) component used in both the mobile and desktop dashboard branches. It shows the family's seva hours vs target with a progress bar, a short reminder when short, a congratulation when complete, and a link to `/family/seva`.

- [ ] **Step 1 — component test** (`seva-progress-card.test.tsx`, `@testing-library/react`, mock `@cmt/ui` `SetuIcon` as stub glyphs):
  - given `view={{ show: true, pct: 25, remaining: 15, complete: false }}`, `hoursEarned={5}`, `hoursPerYear={20}` → renders the contiguous text `5 of 20`, a "15 hours to go" style reminder, and a link with `href="/family/seva"`.
  - given `complete: true`, `hoursEarned={20}` → renders a "Goal reached" / "complete" affirmation (assert that text) and still the `5 of 20`-style "20 of 20".
  - the component renders nothing (returns null) when `view.show === false` — assert the container is empty.

- [ ] **Step 2 — confirm RED.**
- [ ] **Step 3 — implement** (`seva-progress-card.tsx`). Props:
```ts
{ view: SevaCardView; hoursEarned: number; hoursPerYear: number; currentSevaYear: string | null }
```
Return `null` when `!view.show`. Otherwise a `card` mirroring the donation card's idiom:
- header row: a "Seva hours" label (with `SetuIcon.heart`) + the seva year pill;
- big value: `{hoursEarned} of {hoursPerYear}` (the `{hoursEarned} of {hoursPerYear}` must be a single contiguous text node for the test) + a "hours" suffix;
- a progress bar (height 6, `var(--surface2)` track, `var(--accent)` fill at `view.pct%`) — mirror the donation card bar;
- a sub-line: when `complete`, an affirming "Goal reached — thank you for your seva." with an accent treatment; else `{remaining} {remaining === 1 ? 'hour' : 'hours'} to go — find an opportunity.`;
- a link `<Link href="/family/seva" className="btn btn--s">` ("Find seva" / "View seva") — full-width-friendly on mobile.
Keep it token-only and tidy; the designer pass elevates it.

- [ ] **Step 4 — wire into `app/family/page.tsx`:**
  - import `getFamilySevaProgress`, `deriveSevaCardView` from `@/features/setu/seva/get-family-seva-progress` and `SevaProgressCard` from `@/features/family/components/seva-progress-card`.
  - inside `if (flags.setuAuth) { if (data) { ... } }`, after the existing reads, add `const sevaProgress = await getFamilySevaProgress(data.family.fid);` (or fold into one of the `Promise.all` groups). Hold it in an outer-scoped `let sevaProgress: FamilySevaProgress = { currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 };` declared near `model` so the non-setuAuth path has a default (card hidden).
  - compute `const sevaView = deriveSevaCardView(sevaProgress);`
  - **Mobile:** render `<SevaProgressCard ... />` after the donation `card` (around line 246), before the `otherProgramCards` map.
  - **Desktop:** render it as a standalone `card` after the BV/Donation 2-col grid (around line 449) — wrap in the same `style={{ marginTop: 18 }}` rhythm as the Upcoming card; OR place it in a tidy spot consistent with the layout. The card returns null when no seva year, so the layout stays clean for families before seva launches.

- [ ] **Step 5 — run the card test + `tsc --noEmit` → green; `pnpm lint` on the touched files → clean.**
- [ ] **Step 6 — designer pass:** dispatch `oh-my-claudecode:designer` (opus) to make the dashboard seva card visually first-class and consistent with the donation/attendance cards (mobile + desktop), behavior + test-labels unchanged. Re-run tests.
- [ ] **Step 7 — commit:** `feat(seva): dashboard seva-hours progress card`.

---

## Task D3: Compliance reader + API + report page

**Files:** create `apps/portal/src/features/setu/seva/get-seva-compliance.ts` + `__tests__/get-seva-compliance.test.ts`, `apps/portal/src/app/api/welcome/seva/compliance/route.ts` + `__tests__`, `apps/portal/src/features/admin/seva/compliance-client.ts`, `apps/portal/src/features/admin/seva/compliance-report.tsx` + `__tests__`, `apps/portal/src/app/welcome/seva/compliance/page.tsx`. Modify `apps/portal/src/features/setu/seva/get-signups.ts` (+ test) and add a canAccessRoute assertion test.

### D3.1 — `listCompletedSignupsForYear` (get-signups.ts)
- [ ] Test: mock `portalFirestore`; assert `listCompletedSignupsForYear('2025-26')` calls `.collection('seva_signups').where('sevaYear','==','2025-26')` and returns ONLY `completed` rows (filter in memory).
- [ ] Implement (append to `get-signups.ts`):
```ts
export async function listCompletedSignupsForYear(sevaYear: string): Promise<SevaSignupDoc[]> {
  const snap = await portalFirestore().collection('seva_signups').where('sevaYear', '==', sevaYear).get();
  return snap.docs.map((doc) => mapSignup(doc.data())).filter((s) => s.status === 'completed');
}
```

### D3.2 — `get-seva-compliance.ts`
- [ ] Test: mock `@/lib/seva-requirement`, `@cmt/firebase-shared/admin/firestore` (for `listAllSetuFamilies`'s `collection('families').get()`), and `./get-signups` (`listCompletedSignupsForYear`). Assert:
  - no seva year → `{ currentSevaYear: null, hoursPerYear, rows: [], summary: { totalFamilies: 0, metCount: 0, shortCount: 0 } }`.
  - left-join: a family with zero completed sign-ups shows `hoursEarned: 0, met: false`; a family with TWO completed sign-ups (3 + 4) shows `hoursEarned: 7`; with `hoursPerYear: 5`, that family `met: true`.
  - rows sorted short-first (lowest hours first), then by name; summary counts correct.
- [ ] Implement:
```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listCompletedSignupsForYear } from './get-signups';

export interface SetuFamilyLite { fid: string; name: string; }

export async function listAllSetuFamilies(): Promise<SetuFamilyLite[]> {
  const snap = await portalFirestore().collection('families').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { fid: (data['fid'] as string | undefined) ?? d.id, name: (data['name'] as string | undefined) ?? d.id };
  });
}

export interface ComplianceRow { fid: string; name: string; hoursEarned: number; met: boolean; }
export interface SevaCompliance {
  currentSevaYear: string | null;
  hoursPerYear: number;
  rows: ComplianceRow[];
  summary: { totalFamilies: number; metCount: number; shortCount: number };
}

export async function getSevaCompliance(): Promise<SevaCompliance> {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return { currentSevaYear: null, hoursPerYear, rows: [], summary: { totalFamilies: 0, metCount: 0, shortCount: 0 } };
  }
  const [families, completed] = await Promise.all([
    listAllSetuFamilies(),
    listCompletedSignupsForYear(currentSevaYear),
  ]);
  const hoursByFid = new Map<string, number>();
  for (const s of completed) hoursByFid.set(s.fid, (hoursByFid.get(s.fid) ?? 0) + (s.hoursAwarded ?? 0));
  const rows = families
    .map((f) => {
      const hoursEarned = hoursByFid.get(f.fid) ?? 0;
      return { fid: f.fid, name: f.name, hoursEarned, met: hoursEarned >= hoursPerYear };
    })
    .sort((a, b) => a.hoursEarned - b.hoursEarned || a.name.localeCompare(b.name));
  const metCount = rows.filter((r) => r.met).length;
  return { currentSevaYear, hoursPerYear, rows, summary: { totalFamilies: rows.length, metCount, shortCount: rows.length - metCount } };
}
```

### D3.3 — `GET /api/welcome/seva/compliance/route.ts`
- [ ] Test: mock `@/features/setu/seva/get-seva-compliance` (`getSevaCompliance`). 401 no session; 403 family-member; 200 returns the compliance object for welcome-team and admin.
- [ ] Implement:
```ts
import { NextResponse } from 'next/server';
import { isWelcomeTeam } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaCompliance } from '@/features/setu/seva/get-seva-compliance';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const compliance = await getSevaCompliance();
  return NextResponse.json(compliance);
}
```
- [ ] canAccessRoute test: assert `/api/welcome/seva/compliance` GET is `true` for welcome-team + admin, `false` for a family-member (existing rule covers it; NO production change).

### D3.4 — `compliance-client.ts` + `compliance-report.tsx` + page
- [ ] `compliance-client.ts`: types (`ComplianceRow`, `SevaComplianceData` = the serialized object) + `fetchCompliance(): Promise<SevaComplianceData | null>` (`GET /api/welcome/seva/compliance`, `credentials: 'same-origin'`, null on `!res.ok`).
- [ ] `compliance-report.tsx` (`'use client'`, props `{ initial: SevaComplianceData }`): test (mock `@cmt/ui` + `../compliance-client`) asserting it renders the summary (e.g. "{metCount} of {totalFamilies} met"), the seva year, each family row with its `hoursEarned of {hoursPerYear}` and a met/short badge, and a friendly empty/no-year state. Implement: header (eyebrow "Seva" + `<h1>` "Compliance", the year), a summary stat strip (total / met / short, mirror the roster's stat dashboard idiom), a search/filter input is NOT required (YAGNI), and a list of family rows (name, `hoursEarned of {hoursPerYear}`, a small progress bar or a met/short pill). Short-first ordering comes from the server. Mobile-first: rows wrap cleanly at 375px; the row links to `/welcome/family/${fid}` (welcome detail) via `next/link`. No nested component declarations.
- [ ] `app/welcome/seva/compliance/page.tsx`: mirror `app/welcome/seva/[oppId]/page.tsx` — thin `<Suspense>` + body with `await connection()`, the defensive `isWelcomeTeam` re-check (`cookies()` → `verifyPortalSessionCookie`), `getSevaCompliance()`, and the mobile (`CspRoot` + back link to `/welcome/seva`) / desktop (capped width + back link) split rendering `<ComplianceReport initial={compliance} />`. `export const metadata = { title: 'Seva compliance — CMT Portal' }`.

### D3.5 — link from SevaManager
- [ ] In `seva-manager.tsx`, near the page header (or the Opportunities section header), add a `next/link` `btn btn--s` to `/welcome/seva/compliance` labelled "Compliance report". Update `seva-manager.test.tsx` to assert the link href.

- [ ] **Verify D3:** all new test files green; `pnpm --filter @cmt/portal exec tsc --noEmit` + `@cmt/shared-domain` tsc → 0; `pnpm lint` clean on touched files.
- [ ] **Designer pass:** `oh-my-claudecode:designer` (opus) on `compliance-report.tsx` (summary strip, rows, met/short treatment, mobile) — behavior + test labels unchanged.
- [ ] **Commit:** `feat(seva): compliance report (families vs target) + API`.

---

## Task D4: Welcome family-detail seva hours

**Files:** modify `apps/portal/src/app/welcome/family/[fid]/page.tsx` (+ its test if one exists — check `apps/portal/src/app/welcome/family/[fid]/__tests__/`).

- [ ] **Step 1 — test (if a body test exists):** the `WelcomeFamilyDetailBody` already renders family + members. Add a `getFamilySevaProgress` mock and assert a "Seva hours" line shows `{hoursEarned} of {hoursPerYear}` when a seva year is set, and is hidden (or shows "—") when `currentSevaYear` is null. If no test file exists, add a focused one for the seva line OR rely on tsc + the build + the designer/UAT walkthrough (note which in the commit).
- [ ] **Step 2 — implement:** in `WelcomeFamilyDetailBody`, after `getFamilyForWelcome(fid)` succeeds, also `const sevaProgress = await getFamilySevaProgress(fid);` (import from `@/features/setu/seva/get-family-seva-progress`). Pass it into `FamilyDetailBody` and render a small "Seva hours" card/line near the family header card: when `sevaProgress.currentSevaYear`, show `{hoursEarned} of {hoursPerYear} hrs · {currentSevaYear}` with a met/short hint; when null, omit the card. Keep it token-only and consistent with the existing detail cards. Both mobile + desktop branches share `FamilyDetailBody`, so one addition covers both.
- [ ] **Step 3 — run any touched tests + `tsc --noEmit` → green; `pnpm lint` clean. Step 4 — commit:** `feat(seva): show seva hours on the welcome family-detail page`.

---

## Slice D verification (before done)

- [ ] `tsc --noEmit` (portal + shared-domain) → 0; `pnpm lint` clean; full vitest suites green; `pnpm build` green (watch the new `/welcome/seva/compliance` prerender + the dashboard card).
- [ ] **Mobile-app readiness:** `/api/welcome/seva/compliance` uses `readSessionFromHeaders` + `isWelcomeTeam` (grep: no `cookies()`/`getCurrentFamily()` in the handler); ISO/JSON envelope.
- [ ] **No new Firestore index** (single-field queries only — confirm no two-field `where`/`orderBy` on `seva_signups`).
- [ ] **N=2 check:** both `getFamilySevaProgress` and `getSevaCompliance` SUM multiple completed sign-ups (tests prove it).
- [ ] Final review pass (spec-compliance + code-quality, Opus) over the whole slice.
- [ ] **Mock-free UAT walkthrough:** as a family → `/family` shows the seva card (X of {target}, reminder/▮complete); as welcome-team → `/welcome/seva` → "Compliance report" → families vs target (short-first), click a family → `/welcome/family/[fid]` shows its seva hours. Report UAT status explicitly (OTP sign-in may block the agent — flag for CMT Developer if so).
- [ ] Push (full gate). Update resume-note memory: **Seva Hours feature COMPLETE (Slices A–D shipped)**.

## Out of scope (future, per the umbrella spec)
- Enforcement teeth (blocking re-enrollment when short). Track & remind only.
- Free-form self-logging without an opportunity. Email/automated seva reminders. CSV export of the compliance report. Per-member (not just per-family) compliance breakdowns.

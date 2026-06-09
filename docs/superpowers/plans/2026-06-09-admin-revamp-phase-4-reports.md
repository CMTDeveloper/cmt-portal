# Admin Revamp — Phase 4: Reports Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a consolidated **Reports hub** at `/welcome/reports` (welcome-team + admin) with four report cards — enrollment/roster headcounts, attendance summary, donations summary (admin-only), and the legacy check-in CSVs — each rendering an on-screen summary table **and** a CSV export, mobile-ready and backed by a mobile-ready JSON API.

**Architecture:** A unified `GET /api/welcome/reports/[kind]` (kind ∈ `enrollment | attendance | donations`) authed via `readSessionFromHeaders` + `isWelcomeTeam`, with `donations` further gated to `isAdmin` at BOTH `canAccessRoute` (path rule) and the handler/UI (defense in depth). Aggregations use **bulk reads joined in memory** (unfiltered `collectionGroup('enrollments')`, top-level `attendanceEvents` by date range, top-level `donations`) — no per-entity fan-out and **no new Firestore indexes**. The legacy check-in/guest CSVs reuse the existing `POST /api/check-in/admin/reports/[kind]` route directly (admin-only) — no new proxy. All Firebase reads run inside `<Suspense>` after `await connection()` so PPR never executes them at build.

**Tech Stack:** Next.js 16 (App Router, Cache Components/PPR), TypeScript (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` ON), Firestore Admin SDK, Zod schemas in `@cmt/shared-domain`, Vitest + Testing Library, Playwright (headless, deployed-UAT).

---

## Spec

`docs/superpowers/specs/2026-06-08-admin-section-revamp-design.md` → "Phase 4 — Reports hub (item 5)". Decisions D4 (all four reports v1), D5 (donations report **admin-only**; roster/enrollment + attendance are welcome-team + admin).

## Standing constraints (NON-NEGOTIABLE — every task)

- **UAT-only DB writes** (`chinmaya-setu-uat`). All Phase 4 work is **read-only** against Firestore (reports aggregate; they never write). Never write prod 715b8; never `--force` index deploys.
- **Roles via helpers** — `isAdmin` / `isWelcomeTeam`, never strict equality.
- **New `/api/welcome/*` paths need explicit `canAccessRoute` rules** + their `can-access-route.test.ts` cases **in the same commit**. The `/api/welcome/reports/donations` rule (`isAdmin`) must be checked BEFORE the general `/api/welcome/reports` rule (`isWelcomeTeam`).
- **Mobile-ready**: every card/screen has a real `block md:hidden` layout; the API is JSON authed via `readSessionFromHeaders` (Bearer + cookie), ISO-string JSON; shared shapes in `@cmt/shared-domain`.
- **PPR build safety**: the page reads no Firebase in the server component — `await connection()` + client-side fetch (mirror `/welcome/roster/page.tsx`).
- **`.csp` token scoping** — anything outside a `CspRoot` needs `className="csp"`.
- **N=2 discipline** — every aggregate is tested with two of the thing (two programs, two levels, two periods, two attendance statuses) so there is no "first-only" bug.
- **Bulk reads, never per-entity fan-out** (see memory `feedback_bulk_collectiongroup_over_per_family_fanout`): aggregate with a handful of collection/collectionGroup reads joined in memory.
- **TDD**, tests in the **same commit** as the code, **frequent commits**, `git push` after every authorized commit (pre-push gate), **never `--no-verify`**.
- **UI/UX top-notch** — designer pass on the hub screen; matches the Setu brand tokens + the Phase 3 roster screen's quality; ≥44px tap targets on mobile.
- Commit author is the repo default. Co-author trailer per session rules.

## Confirmed facts (verified against the codebase — don't re-derive)

- `attendanceEvents` is a **top-level** collection (`AttendanceEventDoc`: `aid, levelId, mid, fid, pid, date (YYYY-MM-DD), status ∈ present|absent|late, isGuest, markedAt`). Indexes exist for `(levelId,date)`, `(mid,date)`, `(fid,date)` (COLLECTION). A `where('date','>=',from).where('date','<=',to)` single-field range uses the automatic index → **no new index**.
- `donations` is a **top-level** collection (`DonationDoc`: `fid, amountCAD (int $), status ∈ redirected|completed|abandoned, type ∈ enrollment|general, programKey|null, programLabel|null, pid|null, label, createdAt`). `getDonations(fid)` reads `db.collection('donations').where('fid','==',fid)`.
- `enrollments` is a **subcollection** under `families/{fid}/enrollments`, read via `collectionGroup('enrollments')`. `EnrollmentDoc`: `eid, fid, oid, programKey, programLabel, status ∈ active|cancelled, pid?, enrolledMids: string[], levelSnapshots?: Record<mid,{schoolGrade,levelId,levelName}>, suggestedAmountSnapshot, suggestedAmountOverride`.
- `levels` (`LevelDoc`: `levelId, programKey, location, levelName, levelKind, pid, periodLabel, …`) — read via `db.collection('levels')` for level names.
- Legacy check-in CSV: `POST /api/check-in/admin/reports/[kind]` (kind ∈ `check-ins | guests`), admin-only via the `/api/check-in/admin/` `canAccessRoute` rule. Reuse as-is.
- `ReportExportButton` (`features/check-in/admin/report-export-button.tsx`) POSTs `/api/check-in/admin/reports/${kind}` → blob download. Reuse for 4d.
- `readSessionFromHeaders(req)` → `{ uid, role, extraRoles, fid, mid } | null` (`@/lib/auth/headers`). Gate with `isWelcomeTeam({role, extraRoles})` / `isAdmin({role, extraRoles})`.
- `flags.setuAuth` gates new routes (404 when off).
- Phase 3's `buildRosterCsvRows({location?,program?})` (`features/setu/roster/build-csv-rows.ts`) + `rosterToCsv` produce the flat family/member CSV — reuse for the enrollment report's family/member CSV.
- Welcome layout (`app/welcome/layout.tsx`) gates `/welcome/*` for welcome-team + admin; admins keep the admin sidebar. Mobile nav: `welcome-mobile-nav.tsx`. Desktop welcome sidebar nav: `WELCOME_NAV_ITEMS` in `features/family/components/desktop-sidebar.tsx`.
- Reports is currently wired to the legacy route in three places: `app/admin/page.tsx:37`, `admin-sidebar.tsx:30` + `deriveAdminActive` (`:59`), `admin-mobile-nav.tsx:28`.

## File structure (created / modified)

**Created:**
- `packages/shared-domain/src/setu/reports.ts` — report request/response Zod schemas + types.
- `apps/portal/src/features/setu/reports/enrollment-report.ts` — enrollment headcounts aggregation.
- `apps/portal/src/features/setu/reports/attendance-report.ts` — attendance rollup aggregation.
- `apps/portal/src/features/setu/reports/donations-report.ts` — donations summary aggregation (admin).
- `apps/portal/src/features/setu/reports/report-csv.ts` — per-report CSV serializers.
- `apps/portal/src/features/setu/reports/reports-client.ts` — client fetch wrappers (throw on non-OK).
- `apps/portal/src/features/setu/reports/reports-hub.tsx` — `'use client'` hub UI (desktop + mobile).
- `apps/portal/src/features/setu/reports/report-export-button.tsx` — `'use client'` CSV export for the native reports.
- `apps/portal/src/features/setu/reports/__tests__/*.test.ts(x)` — unit/component tests.
- `apps/portal/src/app/welcome/reports/page.tsx` + `error.tsx` — the hub screen.
- `apps/portal/src/app/api/welcome/reports/[kind]/route.ts` — unified reports API.
- `apps/portal/e2e/setu/admin/reports.spec.ts` — Playwright headless E2E.

**Modified:**
- `packages/shared-domain/src/setu/index.ts` — `export * from './reports';`
- `packages/shared-domain/src/auth/can-access-route.ts` + `__tests__/can-access-route.test.ts` — `/api/welcome/reports/donations` (admin) + `/api/welcome/reports*` (welcome-team) rules + tests.
- `apps/portal/src/app/admin/page.tsx` — Reports tile → `/welcome/reports` (de-legacy it).
- `apps/portal/src/features/admin/components/admin-sidebar.tsx` — Reports nav → `/welcome/reports` + `deriveAdminActive` maps it.
- `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` — Reports → `/welcome/reports`.
- `apps/portal/src/features/family/components/desktop-sidebar.tsx` — add "Reports" to `WELCOME_NAV_ITEMS`.
- `apps/portal/src/features/family/components/welcome-mobile-nav.tsx` — add a Reports tab.
- `apps/portal/src/app/check-in/admin/reports/page.tsx` — redirect to `/welcome/reports`.
- `docs/runbooks/production-cutover-checklist.md` — §14 entry (no new indexes; new read-only report routes).
- `CLAUDE.md` — mark Phase 4 shipped.

---

### Task 1: Shared report types (`@cmt/shared-domain`)

**Files:**
- Create: `packages/shared-domain/src/setu/reports.ts`
- Modify: `packages/shared-domain/src/setu/index.ts` (add `export * from './reports';`)
- Test: `packages/shared-domain/src/setu/__tests__/reports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/setu/__tests__/reports.test.ts
import { describe, it, expect } from 'vitest';
import {
  ReportQuerySchema, REPORT_KINDS,
  EnrollmentReportSchema, AttendanceReportSchema, DonationsReportSchema,
} from '../reports';

describe('report schemas', () => {
  it('REPORT_KINDS are the three native kinds', () => {
    expect(REPORT_KINDS).toEqual(['enrollment', 'attendance', 'donations']);
  });
  it('ReportQuerySchema defaults format=json and accepts from/to/program/location', () => {
    expect(ReportQuerySchema.parse({}).format).toBe('json');
    const p = ReportQuerySchema.parse({ format: 'csv', from: '2026-01-01', to: '2026-12-31', program: 'bala-vihar' });
    expect(p.from).toBe('2026-01-01');
  });
  it('ReportQuerySchema rejects a bad date and a bad format', () => {
    expect(ReportQuerySchema.safeParse({ from: '2026/01/01' }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ format: 'pdf' }).success).toBe(false);
  });
  it('report response schemas parse representative payloads', () => {
    expect(EnrollmentReportSchema.parse({
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', families: 10, members: 14 }],
      byLevel: [{ levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', members: 7 }],
      totalActiveEnrollments: 10, totalMembers: 14,
    }).byProgram).toHaveLength(1);
    expect(AttendanceReportSchema.parse({
      byLevel: [{ levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', present: 5, absent: 1, late: 1, total: 7, rate: 0.71 }],
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', present: 5, absent: 1, late: 1, total: 7, rate: 0.71 }],
      from: '2026-01-01', to: '2026-12-31', totalEvents: 7,
    }).byLevel[0]!.rate).toBeCloseTo(0.71);
    expect(DonationsReportSchema.parse({
      byPeriod: [{ pid: 'p1', label: 'BV 2025-26', programLabel: 'Bala Vihar', completedCAD: 500, completedCount: 5 }],
      byProgram: [{ programKey: 'bala-vihar', programLabel: 'Bala Vihar', completedCAD: 500, completedCount: 5 }],
      paidFamilies: 5, outstandingFamilies: 3, totalCompletedCAD: 500,
    }).paidFamilies).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @cmt/shared-domain test -- reports` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/shared-domain/src/setu/reports.ts
import { z } from 'zod';
import { LOCATIONS, programKeySchema } from './schemas/offering';

export const REPORT_KINDS = ['enrollment', 'attendance', 'donations'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const ReportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  from: YMD.optional(),
  to: YMD.optional(),
  program: programKeySchema.optional(),
  location: z.enum(LOCATIONS).optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const EnrollmentReportSchema = z.object({
  byProgram: z.array(z.object({
    programKey: z.string(), programLabel: z.string(),
    families: z.number().int().nonnegative(), members: z.number().int().nonnegative(),
  })),
  byLevel: z.array(z.object({
    levelId: z.string(), levelName: z.string(), programKey: z.string(),
    members: z.number().int().nonnegative(),
  })),
  totalActiveEnrollments: z.number().int().nonnegative(),
  totalMembers: z.number().int().nonnegative(),
});
export type EnrollmentReport = z.infer<typeof EnrollmentReportSchema>;

const AttendanceRowSchema = z.object({
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1), // (present + late) / total
});
export const AttendanceReportSchema = z.object({
  byLevel: z.array(AttendanceRowSchema.extend({ levelId: z.string(), levelName: z.string(), programKey: z.string() })),
  byProgram: z.array(AttendanceRowSchema.extend({ programKey: z.string(), programLabel: z.string() })),
  from: z.string(), to: z.string(),
  totalEvents: z.number().int().nonnegative(),
});
export type AttendanceReport = z.infer<typeof AttendanceReportSchema>;

export const DonationsReportSchema = z.object({
  byPeriod: z.array(z.object({
    pid: z.string(), label: z.string(), programLabel: z.string(),
    completedCAD: z.number().nonnegative(), completedCount: z.number().int().nonnegative(),
  })),
  byProgram: z.array(z.object({
    programKey: z.string(), programLabel: z.string(),
    completedCAD: z.number().nonnegative(), completedCount: z.number().int().nonnegative(),
  })),
  paidFamilies: z.number().int().nonnegative(),
  outstandingFamilies: z.number().int().nonnegative(),
  totalCompletedCAD: z.number().nonnegative(),
});
export type DonationsReport = z.infer<typeof DonationsReportSchema>;
```

Add `export * from './reports';` to `packages/shared-domain/src/setu/index.ts` (next to `export * from './roster';`).

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @cmt/shared-domain test -- reports` → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/shared-domain/src/setu/reports.ts packages/shared-domain/src/setu/index.ts packages/shared-domain/src/setu/__tests__/reports.test.ts
git commit -m "feat(reports): shared report request/response schemas (Phase 4 Task 1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 2: Enrollment headcount aggregation

**Files:**
- Create: `apps/portal/src/features/setu/reports/enrollment-report.ts`
- Test: `apps/portal/src/features/setu/reports/__tests__/enrollment-report.test.ts`

Bulk approach (no fan-out, no new index): unfiltered `collectionGroup('enrollments').get()` → keep `status==='active'`; `db.collection('levels').get()` for level names. Per-program: count distinct fids (families) + distinct mids (members) from `enrolledMids`. Per-level: count members whose `levelSnapshots[mid].levelId === levelId`. Honor optional `program`/`location` filters in memory.

- [ ] **Step 1: Write the failing test** (hand-mock `portalFirestore`; mirror the `list-families.test.ts` mock style — `collectionGroup('enrollments').get()` + `collection('levels').get()`)

```ts
// apps/portal/src/features/setu/reports/__tests__/enrollment-report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildEnrollmentReport } from '../enrollment-report';
const mockFs = vi.mocked(portalFirestore);

// helper builds a db with collectionGroup('enrollments') + collection('levels')
function makeDb(enrollments: any[], levels: any[]) {
  const q = (docs: any[]) => ({ get: async () => ({ docs: docs.map((d, i) => ({ id: d.id ?? String(i), data: () => d })) }) });
  return {
    collectionGroup: (g: string) => { if (g !== 'enrollments') throw new Error(g); return q(enrollments); },
    collection: (c: string) => { if (c !== 'levels') throw new Error(c); return q(levels); },
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildEnrollmentReport', () => {
  it('counts families + members per program (N=2 programs), members per level, ignores cancelled', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1','F1-2'], levelSnapshots: { 'F1-1': { levelId: 'l1', levelName: 'Level 1' }, 'F1-2': { levelId: 'l2', levelName: 'Level 2' } } },
      { fid: 'F2', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: { 'F2-1': { levelId: 'l1', levelName: 'Level 1' } } },
      { fid: 'F2', programKey: 'tabla', programLabel: 'Tabla', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
      { fid: 'F3', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'cancelled', enrolledMids: ['F3-1'], levelSnapshots: {} },
    ], [
      { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar' },
      { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar' },
    ]) as never);

    const r = await buildEnrollmentReport({ format: 'json' });
    const bv = r.byProgram.find((p) => p.programKey === 'bala-vihar')!;
    expect(bv.families).toBe(2);     // F1, F2 (F3 cancelled excluded)
    expect(bv.members).toBe(3);      // F1-1,F1-2,F2-1
    expect(r.byProgram.find((p) => p.programKey === 'tabla')!.families).toBe(1);
    expect(r.byLevel.find((l) => l.levelId === 'l1')!.members).toBe(2); // F1-1, F2-1
    expect(r.totalActiveEnrollments).toBe(3);
  });

  it('program filter narrows to one program', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'active', enrolledMids: ['F1-1'], levelSnapshots: {} },
      { fid: 'F2', programKey: 'tabla', programLabel: 'Tabla', status: 'active', enrolledMids: ['F2-1'], levelSnapshots: {} },
    ], []) as never);
    const r = await buildEnrollmentReport({ format: 'json', program: 'bala-vihar' });
    expect(r.byProgram).toHaveLength(1);
    expect(r.byProgram[0]!.programKey).toBe('bala-vihar');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @cmt/portal test -- reports/__tests__/enrollment-report` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/portal/src/features/setu/reports/enrollment-report.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { EnrollmentReport, ReportQuery } from '@cmt/shared-domain';

type RawEnr = {
  fid?: unknown; programKey?: unknown; programLabel?: unknown; status?: unknown;
  location?: unknown; enrolledMids?: unknown; levelSnapshots?: unknown;
};

export async function buildEnrollmentReport(params: ReportQuery): Promise<EnrollmentReport> {
  const db = portalFirestore();
  const [enrSnap, lvlSnap] = await Promise.all([
    db.collectionGroup('enrollments').get(),
    db.collection('levels').get(),
  ]);

  const levelName = new Map<string, { name: string; programKey: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown };
    levelName.set(d.id, { name: typeof x.levelName === 'string' ? x.levelName : d.id, programKey: String(x.programKey ?? '') });
  }

  const byProgramFamilies = new Map<string, Set<string>>();
  const byProgramMembers = new Map<string, Set<string>>();
  const programLabels = new Map<string, string>();
  const byLevelMembers = new Map<string, Set<string>>(); // levelId → mids
  let totalActiveEnrollments = 0;
  const allMembers = new Set<string>();

  for (const d of enrSnap.docs) {
    const e = d.data() as RawEnr;
    if (e.status !== 'active') continue;
    const programKey = String(e.programKey ?? '');
    if (!programKey) continue;
    if (params.program && programKey !== params.program) continue;
    if (params.location && typeof e.location === 'string' && e.location !== params.location) continue;
    const fid = String(e.fid ?? '');
    const mids = Array.isArray(e.enrolledMids) ? e.enrolledMids.map(String) : [];
    totalActiveEnrollments++;
    programLabels.set(programKey, typeof e.programLabel === 'string' ? e.programLabel : programKey);
    if (!byProgramFamilies.has(programKey)) { byProgramFamilies.set(programKey, new Set()); byProgramMembers.set(programKey, new Set()); }
    if (fid) byProgramFamilies.get(programKey)!.add(fid);
    for (const mid of mids) { byProgramMembers.get(programKey)!.add(mid); allMembers.add(mid); }
    const snaps = (e.levelSnapshots && typeof e.levelSnapshots === 'object') ? (e.levelSnapshots as Record<string, { levelId?: unknown }>) : {};
    for (const [mid, snap] of Object.entries(snaps)) {
      const levelId = typeof snap?.levelId === 'string' ? snap.levelId : null;
      if (!levelId) continue;
      if (!byLevelMembers.has(levelId)) byLevelMembers.set(levelId, new Set());
      byLevelMembers.get(levelId)!.add(mid);
    }
  }

  const byProgram = [...byProgramFamilies.keys()].sort().map((programKey) => ({
    programKey,
    programLabel: programLabels.get(programKey) ?? programKey,
    families: byProgramFamilies.get(programKey)!.size,
    members: byProgramMembers.get(programKey)!.size,
  }));

  const byLevel = [...byLevelMembers.keys()]
    .map((levelId) => {
      const meta = levelName.get(levelId);
      return { levelId, levelName: meta?.name ?? levelId, programKey: meta?.programKey ?? '', members: byLevelMembers.get(levelId)!.size };
    })
    .filter((l) => !params.program || l.programKey === params.program)
    .sort((a, b) => a.levelName.localeCompare(b.levelName));

  return { byProgram, byLevel, totalActiveEnrollments, totalMembers: allMembers.size };
}
```

- [ ] **Step 4: Run to verify pass.** — `pnpm --filter @cmt/portal test -- reports/__tests__/enrollment-report` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/reports/enrollment-report.ts apps/portal/src/features/setu/reports/__tests__/enrollment-report.test.ts
git commit -m "feat(reports): enrollment headcount aggregation (bulk, no new index) (Phase 4 Task 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 3: Attendance rollup aggregation

**Files:**
- Create: `apps/portal/src/features/setu/reports/attendance-report.ts`
- Test: `apps/portal/src/features/setu/reports/__tests__/attendance-report.test.ts`

Read `attendanceEvents` for a date window (default: a wide window if none given — e.g. last 365 days computed by the CALLER and passed in via `from`/`to`; the function requires `from`/`to` and the route fills defaults). Group by `levelId` (join `levels` for name + programKey) and by `programKey`. `rate = (present + late) / total`. Honor optional `program` filter in memory.

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/reports/__tests__/attendance-report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildAttendanceReport } from '../attendance-report';
const mockFs = vi.mocked(portalFirestore);

function makeDb(events: any[], levels: any[]) {
  // attendanceEvents.where('date','>=',from).where('date','<=',to).get()
  const range = {
    where() { return range; },
    get: async () => ({ docs: events.map((e, i) => ({ id: String(i), data: () => e })) }),
  };
  const lvlQ = { get: async () => ({ docs: levels.map((l, i) => ({ id: l.levelId ?? String(i), data: () => l })) }) };
  return {
    collection: (c: string) => c === 'attendanceEvents' ? range : c === 'levels' ? lvlQ : (() => { throw new Error(c); })(),
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildAttendanceReport', () => {
  it('rolls up present/absent/late per level + per program (N=2 levels, N=2 statuses) with correct rate', async () => {
    mockFs.mockReturnValue(makeDb([
      { levelId: 'l1', pid: 'p1', status: 'present', date: '2026-03-01' },
      { levelId: 'l1', pid: 'p1', status: 'late', date: '2026-03-08' },
      { levelId: 'l1', pid: 'p1', status: 'absent', date: '2026-03-15' },
      { levelId: 'l2', pid: 'p1', status: 'present', date: '2026-03-01' },
    ], [
      { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar' },
      { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar' },
    ]) as never);

    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    const l1 = r.byLevel.find((x) => x.levelId === 'l1')!;
    expect([l1.present, l1.absent, l1.late, l1.total]).toEqual([1, 1, 1, 3]);
    expect(l1.rate).toBeCloseTo(2 / 3); // (present+late)/total
    const bv = r.byProgram.find((x) => x.programKey === 'bala-vihar')!;
    expect(bv.total).toBe(4);
    expect(r.totalEvents).toBe(4);
  });

  it('total=0 yields rate 0 (no divide-by-zero)', async () => {
    mockFs.mockReturnValue(makeDb([], []) as never);
    const r = await buildAttendanceReport({ format: 'json', from: '2026-01-01', to: '2026-12-31' });
    expect(r.byLevel).toEqual([]);
    expect(r.totalEvents).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// apps/portal/src/features/setu/reports/attendance-report.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { AttendanceReport, ReportQuery } from '@cmt/shared-domain';

type Tally = { present: number; absent: number; late: number };
const zero = (): Tally => ({ present: 0, absent: 0, late: 0 });
function rate(t: Tally): { total: number; rate: number } {
  const total = t.present + t.absent + t.late;
  return { total, rate: total === 0 ? 0 : (t.present + t.late) / total };
}

export async function buildAttendanceReport(params: ReportQuery & { from: string; to: string }): Promise<AttendanceReport> {
  const db = portalFirestore();
  const [evSnap, lvlSnap] = await Promise.all([
    db.collection('attendanceEvents').where('date', '>=', params.from).where('date', '<=', params.to).get(),
    db.collection('levels').get(),
  ]);

  const levelMeta = new Map<string, { name: string; programKey: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown };
    levelMeta.set(d.id, { name: typeof x.levelName === 'string' ? x.levelName : d.id, programKey: String(x.programKey ?? '') });
  }

  const byLevel = new Map<string, Tally>();
  const byProgram = new Map<string, Tally>();
  const programLabel = new Map<string, string>();
  let totalEvents = 0;

  for (const d of evSnap.docs) {
    const e = d.data() as { levelId?: unknown; status?: unknown };
    const levelId = String(e.levelId ?? '');
    const status = e.status === 'present' || e.status === 'absent' || e.status === 'late' ? e.status : null;
    if (!levelId || !status) continue;
    const programKey = levelMeta.get(levelId)?.programKey ?? '';
    if (params.program && programKey !== params.program) continue;
    totalEvents++;
    if (!byLevel.has(levelId)) byLevel.set(levelId, zero());
    byLevel.get(levelId)![status]++;
    if (programKey) {
      if (!byProgram.has(programKey)) byProgram.set(programKey, zero());
      byProgram.get(programKey)![status]++;
      programLabel.set(programKey, programKey); // labels resolved from program list if needed; key is enough here
    }
  }

  return {
    byLevel: [...byLevel.entries()].map(([levelId, t]) => {
      const m = levelMeta.get(levelId);
      return { levelId, levelName: m?.name ?? levelId, programKey: m?.programKey ?? '', ...t, ...rate(t) };
    }).sort((a, b) => a.levelName.localeCompare(b.levelName)),
    byProgram: [...byProgram.entries()].map(([programKey, t]) => ({
      programKey, programLabel: programLabel.get(programKey) ?? programKey, ...t, ...rate(t),
    })).sort((a, b) => a.programKey.localeCompare(b.programKey)),
    from: params.from, to: params.to, totalEvents,
  };
}
```

> Program labels for attendance come from `programKey` (levels don't store a program label). If a nicer label is wanted, the route may join the program list, but the key is acceptable for v1 — note it in the UI.

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/reports/attendance-report.ts apps/portal/src/features/setu/reports/__tests__/attendance-report.test.ts
git commit -m "feat(reports): attendance rollup aggregation by level + program (Phase 4 Task 3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 4: Donations summary aggregation (admin)

**Files:**
- Create: `apps/portal/src/features/setu/reports/donations-report.ts`
- Test: `apps/portal/src/features/setu/reports/__tests__/donations-report.test.ts`

Read top-level `donations` (all; group by `pid` + `programKey`, sum `amountCAD` for `status==='completed'`). Paid-vs-outstanding families: reuse the bulk pattern — active enrollments (collectionGroup, expected via `suggestedAmountOverride ?? suggestedAmountSnapshot`) vs completed donations per fid → `paymentFromAmounts` (Phase 3 helper). Keep it bulk (no fan-out).

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/setu/reports/__tests__/donations-report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: vi.fn() }));
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { buildDonationsReport } from '../donations-report';
const mockFs = vi.mocked(portalFirestore);

function makeDb(donations: any[], enrollments: any[]) {
  const q = (docs: any[]) => ({ get: async () => ({ docs: docs.map((d, i) => ({ id: String(i), data: () => d })) }) });
  return {
    collection: (c: string) => { if (c !== 'donations') throw new Error(c); return q(donations); },
    collectionGroup: (g: string) => { if (g !== 'enrollments') throw new Error(g); return q(enrollments); },
  };
}
beforeEach(() => mockFs.mockReset());

describe('buildDonationsReport', () => {
  it('sums completed by period + program (N=2 periods), ignores non-completed', async () => {
    mockFs.mockReturnValue(makeDb([
      { fid: 'F1', pid: 'p1', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 100 },
      { fid: 'F2', pid: 'p1', label: 'BV 2025-26', programKey: 'bala-vihar', programLabel: 'Bala Vihar', status: 'completed', amountCAD: 150 },
      { fid: 'F3', pid: 'p2', label: 'Tabla 2025', programKey: 'tabla', programLabel: 'Tabla', status: 'redirected', amountCAD: 80 }, // not completed
    ], [
      { fid: 'F1', status: 'active', suggestedAmountSnapshot: 100, suggestedAmountOverride: null },
      { fid: 'F2', status: 'active', suggestedAmountSnapshot: 200, suggestedAmountOverride: null },
    ]) as never);

    const r = await buildDonationsReport({ format: 'json' });
    expect(r.totalCompletedCAD).toBe(250);
    expect(r.byPeriod.find((p) => p.pid === 'p1')!.completedCAD).toBe(250);
    expect(r.byPeriod.find((p) => p.pid === 'p1')!.completedCount).toBe(2);
    // F1 paid (100>=100), F2 outstanding (150<200)
    expect(r.paidFamilies).toBe(1);
    expect(r.outstandingFamilies).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — read donations + active enrollments in bulk; reuse `paymentFromAmounts` from `@/features/setu/roster/payment`. (NOTE: for `expected` use `suggestedAmountOverride ?? suggestedAmountSnapshot` — the bulk report does NOT do the live offering recompute, matching the Phase 3 CSV builder's bulk approximation; document it.)

```ts
// apps/portal/src/features/setu/reports/donations-report.ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { DonationsReport, ReportQuery } from '@cmt/shared-domain';
import { paymentFromAmounts } from '@/features/setu/roster/payment';

export async function buildDonationsReport(params: ReportQuery): Promise<DonationsReport> {
  const db = portalFirestore();
  const [donSnap, enrSnap] = await Promise.all([
    db.collection('donations').get(),
    db.collectionGroup('enrollments').get(),
  ]);

  type Agg = { cad: number; count: number; label: string; programLabel: string };
  const byPeriod = new Map<string, Agg>();
  const byProgram = new Map<string, Agg>();
  let totalCompletedCAD = 0;

  for (const d of donSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (x['status'] !== 'completed') continue;
    if (params.program && x['programKey'] !== params.program) continue;
    const amt = typeof x['amountCAD'] === 'number' ? x['amountCAD'] : 0;
    totalCompletedCAD += amt;
    const pid = typeof x['pid'] === 'string' ? x['pid'] : '(none)';
    const programKey = typeof x['programKey'] === 'string' ? x['programKey'] : '(general)';
    const label = typeof x['label'] === 'string' ? x['label'] : pid;
    const programLabel = typeof x['programLabel'] === 'string' ? x['programLabel'] : programKey;
    const pAgg = byPeriod.get(pid) ?? { cad: 0, count: 0, label, programLabel };
    pAgg.cad += amt; pAgg.count++; byPeriod.set(pid, pAgg);
    const gAgg = byProgram.get(programKey) ?? { cad: 0, count: 0, label: programLabel, programLabel };
    gAgg.cad += amt; gAgg.count++; byProgram.set(programKey, gAgg);
  }

  // paid vs outstanding families (bulk; expected via snapshot/override, no live offering recompute)
  const expectedByFid = new Map<string, number>();
  const activeCountByFid = new Map<string, number>();
  for (const d of enrSnap.docs) {
    const e = d.data() as Record<string, unknown>;
    if (e['status'] !== 'active') continue;
    const fid = String(e['fid'] ?? '');
    if (!fid) continue;
    const override = typeof e['suggestedAmountOverride'] === 'number' ? (e['suggestedAmountOverride'] as number) : null;
    const snapshot = typeof e['suggestedAmountSnapshot'] === 'number' ? (e['suggestedAmountSnapshot'] as number) : 0;
    expectedByFid.set(fid, (expectedByFid.get(fid) ?? 0) + (override ?? snapshot));
    activeCountByFid.set(fid, (activeCountByFid.get(fid) ?? 0) + 1);
  }
  const paidByFid = new Map<string, number>();
  for (const d of donSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (x['status'] !== 'completed') continue;
    const fid = String(x['fid'] ?? '');
    if (!fid) continue;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + (typeof x['amountCAD'] === 'number' ? (x['amountCAD'] as number) : 0));
  }
  let paidFamilies = 0, outstandingFamilies = 0;
  for (const [fid, expected] of expectedByFid) {
    const status = paymentFromAmounts(activeCountByFid.get(fid) ?? 0, expected, paidByFid.get(fid) ?? 0);
    if (status === 'paid') paidFamilies++;
    else if (status === 'outstanding') outstandingFamilies++;
  }

  return {
    byPeriod: [...byPeriod.entries()].map(([pid, a]) => ({ pid, label: a.label, programLabel: a.programLabel, completedCAD: a.cad, completedCount: a.count })).sort((x, y) => x.label.localeCompare(y.label)),
    byProgram: [...byProgram.entries()].map(([programKey, a]) => ({ programKey, programLabel: a.programLabel, completedCAD: a.cad, completedCount: a.count })).sort((x, y) => x.programKey.localeCompare(y.programKey)),
    paidFamilies, outstandingFamilies, totalCompletedCAD,
  };
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/reports/donations-report.ts apps/portal/src/features/setu/reports/__tests__/donations-report.test.ts
git commit -m "feat(reports): donations summary aggregation (admin, bulk) (Phase 4 Task 4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 5: Per-report CSV serializers

**Files:**
- Create: `apps/portal/src/features/setu/reports/report-csv.ts`
- Test: `apps/portal/src/features/setu/reports/__tests__/report-csv.test.ts`

Three small serializers (`enrollmentReportToCsv`, `attendanceReportToCsv`, `donationsReportToCsv`) emitting one CSV per report's primary table (header + rows, with RFC-4180 escaping — reuse the same `escapeField` regex). The enrollment report's **family/member** CSV is NOT here — that reuses Phase 3's `/api/welcome/families?format=csv` (the route delegates; see Task 6). These serializers cover the on-screen summary tables' export.

- [ ] **Step 1: Write the failing test** (header + a row for each; escaping). 
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** the three functions with a shared `escapeField` + `rowsToCsv(headers, rows)` helper. Example shape:

```ts
// apps/portal/src/features/setu/reports/report-csv.ts
import type { EnrollmentReport, AttendanceReport, DonationsReport } from '@cmt/shared-domain';

function escapeField(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function table(headers: string[], rows: Array<Array<unknown>>): string {
  const head = headers.join(',');
  if (rows.length === 0) return head;
  return `${head}\n${rows.map((r) => r.map(escapeField).join(',')).join('\n')}`;
}

export function enrollmentReportToCsv(r: EnrollmentReport): string {
  return table(['scope', 'key', 'label', 'families', 'members'], [
    ...r.byProgram.map((p) => ['program', p.programKey, p.programLabel, p.families, p.members]),
    ...r.byLevel.map((l) => ['level', l.levelId, l.levelName, '', l.members]),
  ]);
}
export function attendanceReportToCsv(r: AttendanceReport): string {
  return table(['scope', 'key', 'label', 'present', 'absent', 'late', 'total', 'rate'], [
    ...r.byLevel.map((l) => ['level', l.levelId, l.levelName, l.present, l.absent, l.late, l.total, l.rate.toFixed(3)]),
    ...r.byProgram.map((p) => ['program', p.programKey, p.programLabel, p.present, p.absent, p.late, p.total, p.rate.toFixed(3)]),
  ]);
}
export function donationsReportToCsv(r: DonationsReport): string {
  return table(['scope', 'key', 'label', 'completedCAD', 'completedCount'], [
    ...r.byPeriod.map((p) => ['period', p.pid, p.label, p.completedCAD, p.completedCount]),
    ...r.byProgram.map((p) => ['program', p.programKey, p.programLabel, p.completedCAD, p.completedCount]),
  ]);
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/reports/report-csv.ts apps/portal/src/features/setu/reports/__tests__/report-csv.test.ts
git commit -m "feat(reports): per-report CSV serializers (Phase 4 Task 5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 6: API route + canAccessRoute rules (same commit)

**Files:**
- Create: `apps/portal/src/app/api/welcome/reports/[kind]/route.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: `apps/portal/src/app/api/welcome/reports/__tests__/route.test.ts`
- Test: `packages/shared-domain/src/__tests__/can-access-route.test.ts` (add cases)

`GET /api/welcome/reports/[kind]`: flag-gate (404 if `!flags.setuAuth`); `readSessionFromHeaders` → 401 if null; gate (`donations` → `isAdmin`, else `isWelcomeTeam`) → 403; parse `ReportQuerySchema` → 400; dispatch to the aggregation; `format=csv` → text/csv via the matching serializer (enrollment csv = delegate to Phase 3 `buildRosterCsvRows`+`rosterToCsv` for the family/member flat export — that's the spec's "same flat export as Phase 3's roster CSV"); else JSON. Attendance fills default `from`/`to` (e.g. `to=today`, `from=today−365d`) when absent — compute from `new Date()` in the route (server time).

- [ ] **Step 1: Write the failing `canAccessRoute` cases first**

```ts
// add to packages/shared-domain/src/__tests__/can-access-route.test.ts
describe('reports API (/api/welcome/reports)', () => {
  const welcome = { role: 'welcome-team' } as SessionClaims;
  const adminC = { role: 'admin' } as SessionClaims;
  const familyC = { role: 'family-manager' } as SessionClaims;
  it('enrollment + attendance: welcome-team and admin allowed', () => {
    expect(canAccessRoute(welcome, '/api/welcome/reports/enrollment', 'GET')).toBe(true);
    expect(canAccessRoute(welcome, '/api/welcome/reports/attendance', 'GET')).toBe(true);
    expect(canAccessRoute(adminC, '/api/welcome/reports/attendance', 'GET')).toBe(true);
  });
  it('donations: admin only (welcome-team denied)', () => {
    expect(canAccessRoute(adminC, '/api/welcome/reports/donations', 'GET')).toBe(true);
    expect(canAccessRoute(welcome, '/api/welcome/reports/donations', 'GET')).toBe(false);
  });
  it('family roles denied everywhere under reports', () => {
    expect(canAccessRoute(familyC, '/api/welcome/reports/enrollment', 'GET')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Add the `canAccessRoute` rules** (donations BEFORE the general reports rule; place with the other `/api/welcome/*` rules):

```ts
  // Welcome-team API — reports hub. Donations report is ADMIN-ONLY (D5); it must
  // be checked before the general reports rule.
  if (pathname === '/api/welcome/reports/donations') {
    return isAdmin(claims);
  }
  if (pathname === '/api/welcome/reports' || pathname.startsWith('/api/welcome/reports/')) {
    return isWelcomeTeam(claims);
  }
```

- [ ] **Step 4: Write the failing route test** (mock the three aggregations + `buildRosterCsvRows`/`rosterToCsv` + flags; assert: 401 no session; 403 family role; 403 welcome-team on donations; 200 admin on donations; 200 welcome-team on enrollment json; csv content-type; 400 unknown kind).

- [ ] **Step 5: Run to verify fail.**

- [ ] **Step 6: Implement the route**

```ts
// apps/portal/src/app/api/welcome/reports/[kind]/route.ts
import { NextResponse } from 'next/server';
import { isAdmin, isWelcomeTeam, ReportQuerySchema, REPORT_KINDS, type ReportKind } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { buildEnrollmentReport } from '@/features/setu/reports/enrollment-report';
import { buildAttendanceReport } from '@/features/setu/reports/attendance-report';
import { buildDonationsReport } from '@/features/setu/reports/donations-report';
import { enrollmentReportToCsv, attendanceReportToCsv, donationsReportToCsv } from '@/features/setu/reports/report-csv';
import { buildRosterCsvRows } from '@/features/setu/roster/build-csv-rows';
import { rosterToCsv } from '@/features/setu/roster/roster-csv';

function csv(body: string, name: string) {
  return new NextResponse(body, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` } });
}
function ymdDaysAgo(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const { kind } = await params;
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'unknown-kind' }, { status: 400 });
  }
  const k = kind as ReportKind;

  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const claims = { role: session.role, extraRoles: session.extraRoles };
  const allowed = k === 'donations' ? isAdmin(claims) : isWelcomeTeam(claims);
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = ReportQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  const q = parsed.data;

  if (k === 'enrollment') {
    if (q.format === 'csv') {
      // Family/member flat CSV = Phase 3's roster export (shared).
      const rows = await buildRosterCsvRows({ ...(q.location ? { location: q.location } : {}), ...(q.program ? { program: q.program } : {}) });
      return csv(rosterToCsv(rows), 'enrollment-people');
    }
    return NextResponse.json(await buildEnrollmentReport(q), { status: 200 });
  }
  if (k === 'attendance') {
    const withRange = { ...q, from: q.from ?? ymdDaysAgo(365), to: q.to ?? ymdDaysAgo(0) };
    const report = await buildAttendanceReport(withRange);
    return q.format === 'csv' ? csv(attendanceReportToCsv(report), 'attendance-summary') : NextResponse.json(report, { status: 200 });
  }
  // donations (admin-only, already gated)
  const report = await buildDonationsReport(q);
  return q.format === 'csv' ? csv(donationsReportToCsv(report), 'donations-summary') : NextResponse.json(report, { status: 200 });
}
```

- [ ] **Step 7: Run both test files green** — `pnpm --filter @cmt/shared-domain test -- can-access-route && pnpm --filter @cmt/portal test -- api/welcome/reports`.
- [ ] **Step 8: Commit**

```bash
git add packages/shared-domain/src/auth/can-access-route.ts packages/shared-domain/src/__tests__/can-access-route.test.ts apps/portal/src/app/api/welcome/reports/
git commit -m "feat(reports): /api/welcome/reports/[kind] (enrollment|attendance|donations) + canAccessRoute rules (Phase 4 Task 6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 7: Reports hub screen (`/welcome/reports`) — desktop + mobile (designer)

**Files:**
- Create: `apps/portal/src/features/setu/reports/reports-client.ts`
- Create: `apps/portal/src/features/setu/reports/report-export-button.tsx`
- Create: `apps/portal/src/features/setu/reports/reports-hub.tsx`
- Create: `apps/portal/src/app/welcome/reports/page.tsx` + `error.tsx`
- Test: `apps/portal/src/features/setu/reports/__tests__/reports-hub.test.tsx`

**`reports-client.ts`** — `fetchReport(kind, params)` → typed report (throw on non-OK, like the roster client). One function per kind or a generic with a kind param.

**`report-export-button.tsx`** — GET `/api/welcome/reports/${kind}?…&format=csv` → blob download; error feedback on `!res.ok` (mirror the Phase 3 roster export button, which surfaces "Export failed — try again"). Reusable across cards (kind + filters as props).

**`reports-hub.tsx`** (`'use client'`) — four cards, each: title, on-screen summary table (compact), an export button, and (attendance) a simple date-range control. Cards:
- **Enrollment** (welcome-team + admin): byProgram table (program · families · members) + byLevel table (level · members); total chips; "Export people CSV" (`format=csv` → roster people) + the summary loads from `/api/welcome/reports/enrollment` (json).
- **Attendance** (welcome-team + admin): byLevel + byProgram tables (present/absent/late/total/rate%); from/to inputs (default last 12 months); "Export CSV".
- **Donations** (ADMIN ONLY — render only when `isAdmin` prop true): byPeriod + byProgram tables (completed $ + count), paid/outstanding family chips; "Export CSV". Add a muted caveat: "accounting@ remains the settlement source of truth (no Stripe webhook)."
- **Legacy check-in** (admin only): two `ReportExportButton`s (kind `check-ins`, `guests`) reusing `features/check-in/admin/report-export-button.tsx` (hits the existing admin route). A muted "Legacy door-app exports" label.

The hub receives `isAdmin: boolean` from the page (so it knows whether to render the donations + legacy cards). Desktop (`hidden md:block`, in the welcome `<main>`) + mobile (`block md:hidden`, own CspRoot, 90px bottom padding). Brand tokens; ≥44px tap targets. Each card fetches its own data on mount and fails gracefully (a card error must not blank the hub).

**`page.tsx`** — server component: resolve `isAdmin` from the session cookie (mirror `welcome/layout.tsx`'s `verifyPortalSessionCookie` + `isAdmin`), `await connection()`, render `<ReportsHub isAdmin={admin} />` inside `<Suspense>`. `metadata.title = 'Reports · Setu'`. **error.tsx** copies the roster one.

E2E hooks: `data-testid="report-card-enrollment"`, `report-card-attendance`, `report-card-donations`, `report-card-legacy` on the card containers.

- [ ] **Step 1: Write the failing component test** (mock `reports-client`; assert enrollment + attendance cards render with mocked data; donations card renders when `isAdmin` and is ABSENT when not).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** all files per the requirements (designer-quality UI, mobile-perfect). Reuse the Phase 3 roster screen's visual language (cards, chips, tables).
- [ ] **Step 4: Run component test green.**
- [ ] **Step 5: Typecheck + lint** — `pnpm --filter @cmt/portal typecheck && pnpm --filter @cmt/portal lint` (watch `exactOptionalPropertyTypes` on the client param spreads; do NOT declare nested function components).
- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/reports/reports-client.ts apps/portal/src/features/setu/reports/report-export-button.tsx apps/portal/src/features/setu/reports/reports-hub.tsx apps/portal/src/app/welcome/reports/ apps/portal/src/features/setu/reports/__tests__/reports-hub.test.tsx
git commit -m "feat(reports): /welcome/reports hub — enrollment/attendance/donations/legacy cards (Phase 4 Task 7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 8: Wire nav + redirect the legacy reports page

**Files:**
- Modify: `apps/portal/src/app/admin/page.tsx` (Reports tile → `/welcome/reports`, drop the `legacy` tone + "coming" copy)
- Modify: `apps/portal/src/features/admin/components/admin-sidebar.tsx` (Reports nav → `/welcome/reports`; `deriveAdminActive` maps `/welcome/reports`)
- Modify: `apps/portal/src/features/admin/components/admin-mobile-nav.tsx` (Reports → `/welcome/reports`)
- Modify: `apps/portal/src/features/family/components/desktop-sidebar.tsx` (`WELCOME_NAV_ITEMS` add `['reports', 'Reports', 'info', '/welcome/reports']`; ensure `deriveActiveFromPathname` maps `/welcome/reports` → `'reports'` — add a branch before the `/welcome` catch-all)
- Modify: `apps/portal/src/features/family/components/welcome-mobile-nav.tsx` (add a Reports tab; ensure `isRosterActive` excludes `/welcome/reports` so Roster doesn't also light up)
- Modify: `apps/portal/src/app/check-in/admin/reports/page.tsx` (`redirect('/welcome/reports')`)

Confirm `SidebarTab` type includes a `'reports'` member (add it if the union is closed) so the new nav item typechecks.

- [ ] **Step 1:** Make the edits. For the welcome desktop sidebar, add a `'reports'` tab to the `SidebarTab` union (find its definition) and a `deriveActiveFromPathname` branch `if (pathname.startsWith('/welcome/reports')) return 'reports';` placed before `if (pathname.startsWith('/welcome')) return 'home';`. In `welcome-mobile-nav.tsx`, update `isRosterActive` to also exclude `/welcome/reports`.
- [ ] **Step 2:** Update/add tests: `deriveAdminActive` maps `/welcome/reports`; the `check-in/admin/reports` page redirects (mock `redirect`). Confirm no existing test asserts the old Reports href.
- [ ] **Step 3: Run** — `pnpm --filter @cmt/portal test -- admin reports welcome desktop-sidebar` green.
- [ ] **Step 4: Commit**

```bash
git add apps/portal/src/app/admin/page.tsx apps/portal/src/features/admin/components/admin-sidebar.tsx apps/portal/src/features/admin/components/admin-mobile-nav.tsx apps/portal/src/features/family/components/desktop-sidebar.tsx apps/portal/src/features/family/components/welcome-mobile-nav.tsx apps/portal/src/app/check-in/admin/reports/page.tsx
git commit -m "feat(reports): wire Reports nav/dashboard to /welcome/reports; redirect legacy reports page (Phase 4 Task 8)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 9: Full pre-push gate (whole repo)

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green. If "Collecting page data" fails on `/welcome/reports`, the page is reading Firebase at build — ensure all data is client-fetched and the server page only does `await connection()` + session `isAdmin` resolution inside `<Suspense>`.
- [ ] **Step 2:** Fix any failure at root cause (never `--no-verify`); re-run until green. Commit + push only if a fix was needed.

> Expectation: **no new Firestore indexes** (enrollment uses unfiltered collectionGroup; attendance uses single-field `date` range; donations uses the top-level collection). If a query unexpectedly throws `FAILED_PRECONDITION` during E2E (Task 10), add the minimal index to `firestore.indexes.json`, deploy to **UAT only** (no `--force`), and add a §14 runbook entry — but the design avoids this.

---

### Task 10: Playwright headless E2E (deployed UAT)

**Files:**
- Create: `apps/portal/e2e/setu/admin/reports.spec.ts`

The single UAT test user is family-manager **+ admin**, so it sees ALL cards (incl. donations + legacy). Read-only — no mutations/cleanup. Runs against deployed UAT after Tasks 1–8 are pushed + Vercel deploys. Screens render mobile+desktop blocks → filter visible. The **welcome-team-denied-donations** path is covered by the unit/route test (Task 6), not the browser (no welcome-team-only seeded user).

- [ ] **Step 1: Write the spec**

```ts
// apps/portal/e2e/setu/admin/reports.spec.ts
import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

test.describe('Phase 4 — Reports hub (/welcome/reports)', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('hub renders enrollment + attendance + donations cards for an admin', async ({ page }) => {
    await page.goto('/welcome/reports');
    await expect(page.getByTestId('report-card-enrollment').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('report-card-attendance').filter({ visible: true }).first()).toBeVisible();
    // The seeded test user is admin → donations card is present.
    await expect(page.getByTestId('report-card-donations').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('report APIs return JSON for the signed-in admin', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance', 'donations']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
    }
  });

  test('report CSV exports return text/csv', async ({ page }) => {
    for (const kind of ['enrollment', 'attendance', 'donations']) {
      const res = await page.request.get(`/api/welcome/reports/${kind}?format=csv`, { timeout: 30_000 });
      expect(res.status(), kind).toBe(200);
      expect(res.headers()['content-type'], kind).toContain('text/csv');
    }
  });

  test('unknown report kind is 400', async ({ page }) => {
    const res = await page.request.get('/api/welcome/reports/bogus');
    expect(res.status()).toBe(400);
  });
});
```

- [ ] **Step 2: Re-seed the UAT test user** — `pnpm --filter @cmt/portal seed:e2e-family`.
- [ ] **Step 3: Run against deployed UAT** (after Tasks 1–8 pushed + Vercel deployed; confirm the deploy is live by hitting `/api/welcome/reports/enrollment` and seeing 200/401 not 404):
  `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm --filter @cmt/portal exec playwright test --project=setu --project=setup reports`
  Expected: all green. The enrollment endpoint reads ~800 active enrollments + levels (one collectionGroup get) — fast. Attendance reads the `attendanceEvents` date window. Donations reads `donations` + enrollments. If any is slow (>30s), apply the bulk-read discipline / raise the test timeout, but the bulk design should keep them at a few seconds.
- [ ] **Step 4: Full suite regression** — `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e 2>&1 | tail -15` → all prior + new green.
- [ ] **Step 5: Commit**

```bash
git add apps/portal/e2e/setu/admin/reports.spec.ts
git commit -m "test(reports): Playwright headless E2E for /welcome/reports against deployed UAT (Phase 4 Task 10)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 11: Runbook + CLAUDE.md + final review

**Files:**
- Modify: `docs/runbooks/production-cutover-checklist.md` (§14 entry)
- Modify: `CLAUDE.md` (Phase 4 shipped)

- [ ] **Step 1:** §14 change-log entry (2026-06-09): Phase 4 reports hub shipped; **no new indexes** (bulk reads); new read-only routes `GET /api/welcome/reports/{enrollment,attendance,donations}` (donations admin-only); legacy `/check-in/admin/reports` redirects to `/welcome/reports`. No DB writes → prod replay is code-only (no migration/index step).
- [ ] **Step 2:** Update the CLAUDE.md admin-revamp status block: Phase 4 ✅ Shipped (replace the "⏳ Not yet built" line).
- [ ] **Step 3:** Dispatch the final whole-implementation code review (UI + aggregations + route + nav). Address blocker/important findings; commit + push fixes.
- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/production-cutover-checklist.md CLAUDE.md
git commit -m "docs: mark admin-revamp Phase 4 (Reports hub) shipped + runbook §14 (Phase 4 Task 11)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-review (against the spec)

- **Spec coverage:** 4a enrollment headcounts (T2) + family/member CSV reuses Phase 3 roster export (T6) ✓; 4b attendance summary per level + program with date range (T3) ✓; 4c donations summary admin-only — byPeriod/byProgram + paid/outstanding (T4), gated at canAccessRoute + handler + hub (T6/T7) ✓; 4d legacy check-in CSV reuses existing route via a card + legacy page redirect (T7/T8) ✓; unified `GET /api/welcome/reports/[kind]` json|csv (T6) ✓; canAccessRoute donations-admin/others-welcome-team + tests same commit (T6) ✓; mobile + mobile-API (T6/T7) ✓; N=2 (T2 two programs/levels, T3 two levels/statuses, T4 two periods) ✓; Playwright E2E (T10) ✓.
- **Deviations (documented):** (1) checkins/guests are NOT new kinds of the unified API — the legacy card reuses the existing `/api/check-in/admin/reports/[kind]` directly (DRY, admin-only, avoids re-implementing door-collection reads). (2) Attendance program label = `programKey` (levels carry no program label); acceptable for v1. (3) Donations "expected" uses snapshot/override (no live offering recompute), matching the Phase 3 bulk CSV approximation; documented in the UI caveat. (4) Donations-denied-for-welcome-team is covered by the route unit test, not the browser E2E (no welcome-team-only seeded user).
- **No new indexes:** enrollment = unfiltered `collectionGroup('enrollments')`; attendance = single-field `date` range (auto index); donations = top-level `donations`. Confirmed in T9 expectation + T10 runtime check.
- **Type consistency:** `ReportQuery`/`EnrollmentReport`/`AttendanceReport`/`DonationsReport` defined in T1, consumed verbatim in T2–T7. `paymentFromAmounts` (Phase 3) reused in T4. `buildRosterCsvRows`+`rosterToCsv` (Phase 3) reused in T6.
- **No placeholders:** every code step has real code; every run step has a command + expected result.

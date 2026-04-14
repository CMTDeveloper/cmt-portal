# Slice B3 — Teacher Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the teacher attendance workflow: teacher dashboard listing classes from RTDB, attendance marking page with `{present, absent, late, uninformed}` per student, attendance report with date-range filter and CSV export, and an "uninformed absentees" list across classes for follow-up. Teacher login already works from B0 (shared `TEACHER_PASSPHRASE`); this slice wires the pages, APIs, and components behind it. Dual-mode auth (cookie + Bearer) on every endpoint.

**Architecture:** Every teacher session is the deterministic shared user `teacher-shared-v1` (limitation accepted per spec §4 and §7.6 risk #3 — no per-teacher audit trail). Pages under `/check-in/teacher/*` render server components that fetch class rosters from RTDB through the shared `family-lookup` helper evolved with class APIs. Attendance writes go to `attendance/{yyyy-mm-dd}/{classId}/{sid}` in portal Firestore. The report endpoint serializes to JSON by default or streams CSV when `Accept: text/csv`. All components use `@cmt/ui` shadcn primitives — no `react-datepicker`.

**Tech Stack:** Builds on B0 session infrastructure and B2's `features/check-in/shared/*` modules. Adds `features/check-in/teacher/*` with attendance marker + CSV serializer. Extends `@cmt/shared-domain/check-in/*` with `AttendanceRecord`, `ClassRoster`, `AttendanceStatus` types.

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` §11 (B3 detail)

**Predecessor plans:** B0 (`slice-b0-portal-auth-foundation.md`), B2 (`slice-b2-family-portal.md`).

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisites:** B0 + B2 shipped. Verify:

```sh
test -f apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts && \
test -f apps/portal/src/app/api/auth/teacher/signin/route.ts && \
echo "B0+B2 present" || echo "MISSING prerequisite"
```

**Branch model:** solo-dev main-only. Final task pushes.

**Feature flag during execution:** `NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER=false` in `.env.local` until Task 15.

---

## File structure overview

```
chinmaya-mission-portal/
├── packages/shared-domain/src/check-in/
│   ├── attendance.ts                                       [Task 1]
│   └── index.ts                                            [Task 1, MODIFIED]
│
├── apps/portal/src/features/check-in/shared/rtdb/
│   ├── classlist.ts                                        [Task 2]
│   └── __tests__/classlist.test.ts                         [Task 2]
│
├── apps/portal/src/features/check-in/teacher/
│   ├── teacher-dashboard.tsx                               [Task 3]
│   ├── class-list-card.tsx                                 [Task 3]
│   ├── attendance-marker.tsx                               [Task 5]
│   ├── attendance-status-badge.tsx                         [Task 4]
│   ├── attendance-report-table.tsx                         [Task 9]
│   ├── csv-export-button.tsx                               [Task 10]
│   ├── csv.ts                                              [Task 7]
│   ├── index.ts                                            [Task 3, MODIFIED each]
│   └── __tests__/
│       ├── teacher-dashboard.test.tsx                      [Task 3]
│       ├── attendance-status-badge.test.tsx                [Task 4]
│       ├── attendance-marker.test.tsx                      [Task 5]
│       ├── csv.test.ts                                     [Task 7]
│       └── attendance-report-table.test.tsx                [Task 9]
│
├── apps/portal/src/app/
│   ├── api/check-in/teacher/
│   │   ├── classlist/route.ts                              [Task 6]
│   │   ├── roster/[classId]/route.ts                       [Task 6]
│   │   ├── attendance/route.ts                             [Task 8]
│   │   ├── report/route.ts                                 [Task 9]
│   │   ├── uninformed/route.ts                             [Task 11]
│   │   └── __tests__/
│   │       ├── classlist.test.ts                           [Task 6]
│   │       ├── attendance.test.ts                          [Task 8]
│   │       ├── report.test.ts                              [Task 9]
│   │       └── uninformed.test.ts                          [Task 11]
│   └── check-in/teacher/
│       ├── page.tsx                                        [Task 3]
│       ├── error.tsx                                       [Task 3]
│       ├── loading.tsx                                     [Task 3]
│       ├── attendance/
│       │   ├── page.tsx                                    [Task 5]
│       │   └── error.tsx                                   [Task 5]
│       ├── report/
│       │   ├── page.tsx                                    [Task 9]
│       │   └── error.tsx                                   [Task 9]
│       └── uninformed/
│           ├── page.tsx                                    [Task 11]
│           └── error.tsx                                   [Task 11]
│
├── apps/portal/e2e/b3-teacher.spec.ts                      [Task 13]
├── README.md                                               [Task 14, MODIFIED]
├── CLAUDE.md                                               [Task 14, MODIFIED]
```

**Task count:** 14. **Final task pushes.**

---

## Task 1: Add `@cmt/shared-domain/check-in/attendance.ts`

**Files:**
- Create: `packages/shared-domain/src/check-in/attendance.ts`
- Modify: `packages/shared-domain/src/check-in/index.ts` (add export)
- Test: `packages/shared-domain/src/__tests__/attendance-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/__tests__/attendance-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type AttendanceRecord,
  type ClassRoster,
  type TeacherAttendanceRequest,
  type TeacherReportQuery,
  type TeacherReportResponse,
} from '../check-in/attendance';

describe('ATTENDANCE_STATUSES', () => {
  it('lists the four statuses', () => {
    expect(ATTENDANCE_STATUSES).toEqual(['present', 'absent', 'late', 'uninformed']);
  });
});

describe('AttendanceRecord', () => {
  it('has required fields', () => {
    const record: AttendanceRecord = {
      date: '2026-04-13',
      classId: 'K',
      sid: '1',
      status: 'present',
      markedAt: '2026-04-13T14:00:00Z',
      markedByUid: 'teacher-shared-v1',
    };
    expect(record.status).toBe('present');
  });
});

describe('ClassRoster', () => {
  it('contains a class id and an array of students', () => {
    const roster: ClassRoster = {
      classId: 'K',
      name: 'Kindergarten',
      students: [
        { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
      ],
    };
    expect(roster.students).toHaveLength(1);
  });
});

describe('TeacherAttendanceRequest', () => {
  it('carries classId, date, and a status map', () => {
    const req: TeacherAttendanceRequest = {
      classId: 'K',
      date: '2026-04-13',
      statuses: { '1': 'present', '2': 'late' },
    };
    expect(req.statuses['1']).toBe('present');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/attendance-types.test.ts
```

- [ ] **Step 3: Create `packages/shared-domain/src/check-in/attendance.ts`**

```ts
import type { Student } from './family';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'uninformed'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceRecord {
  date: string;         // yyyy-mm-dd
  classId: string;
  sid: string;
  status: AttendanceStatus;
  markedAt: string;     // ISO
  markedByUid: string;
  notes?: string;
}

export interface ClassRoster {
  classId: string;
  name: string;
  students: Student[];
}

export interface TeacherClassListResponse {
  classes: Array<{ classId: string; name: string; studentCount: number }>;
}

export interface TeacherAttendanceRequest {
  classId: string;
  date: string;
  statuses: Record<string, AttendanceStatus>;  // sid -> status
}

export interface TeacherAttendanceResponse {
  success: true;
  recorded: number;
}

export interface TeacherReportQuery {
  classId?: string;
  from?: string;
  to?: string;
}

export interface TeacherReportEntry {
  date: string;
  classId: string;
  sid: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus;
}

export interface TeacherReportResponse {
  entries: TeacherReportEntry[];
}

export interface TeacherUninformedResponse {
  entries: TeacherReportEntry[];
}
```

- [ ] **Step 4: Modify `packages/shared-domain/src/check-in/index.ts` — add `export * from './attendance';`**

- [ ] **Step 5: Run test — expect pass**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/attendance-types.test.ts
```

- [ ] **Step 6: Commit**

```sh
git add packages/shared-domain/src/check-in/attendance.ts packages/shared-domain/src/check-in/index.ts packages/shared-domain/src/__tests__/attendance-types.test.ts
git commit -m "feat(shared-domain): add attendance types (AttendanceStatus, AttendanceRecord, ClassRoster, API contracts)"
```

---

## Task 2: `features/check-in/shared/rtdb/classlist.ts` — class/roster reader

RTDB master data exposes classes under `/classes/{classId}` with a student-id list. Reuses `readRtdb` + `findFamilyById`-style pattern.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/rtdb/classlist.ts`
- Modify: `apps/portal/src/features/check-in/shared/index.ts` (re-export)
- Test: `apps/portal/src/features/check-in/shared/__tests__/classlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/classlist.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { listClasses, getRosterForClass } from '../rtdb/classlist';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listClasses', () => {
  it('returns classes from /classes path with student counts', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      K: { name: 'Kindergarten', studentIds: ['1', '2'] },
      G1: { name: 'Grade 1', studentIds: ['3'] },
    });
    const classes = await listClasses();
    expect(readRtdb).toHaveBeenCalledWith('/classes');
    expect(classes).toHaveLength(2);
    const k = classes.find((c) => c.classId === 'K');
    expect(k?.studentCount).toBe(2);
    expect(k?.name).toBe('Kindergarten');
  });

  it('returns an empty array when no classes exist', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const classes = await listClasses();
    expect(classes).toEqual([]);
  });
});

describe('getRosterForClass', () => {
  it('returns the roster with student details', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ name: 'Kindergarten', studentIds: ['1', '2'] })
      .mockResolvedValueOnce({
        sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K',
      })
      .mockResolvedValueOnce({
        sid: '2', fid: '43', firstName: 'Bob', lastName: 'Bravo', level: 'K',
      });
    const roster = await getRosterForClass('K');
    expect(roster?.classId).toBe('K');
    expect(roster?.students).toHaveLength(2);
    expect(roster?.students[0]?.firstName).toBe('Alice');
  });

  it('returns null when class not found', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const roster = await getRosterForClass('X');
    expect(roster).toBeNull();
  });

  it('omits students that cannot be looked up', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ name: 'K', studentIds: ['1', '2'] })
      .mockResolvedValueOnce({
        sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K',
      })
      .mockResolvedValueOnce(null);  // student 2 is missing
    const roster = await getRosterForClass('K');
    expect(roster?.students).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/classlist.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/rtdb/classlist.ts`**

```ts
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Student } from '@cmt/shared-domain/check-in';
import type { ClassRoster } from '@cmt/shared-domain/check-in';

interface RtdbClass {
  name: string;
  studentIds: string[];
}

export async function listClasses(): Promise<
  Array<{ classId: string; name: string; studentCount: number }>
> {
  const all = (await readRtdb<Record<string, RtdbClass>>('/classes')) ?? {};
  return Object.entries(all).map(([classId, c]) => ({
    classId,
    name: c.name,
    studentCount: (c.studentIds ?? []).length,
  }));
}

export async function getRosterForClass(classId: string): Promise<ClassRoster | null> {
  const cls = await readRtdb<RtdbClass>(`/classes/${classId}`);
  if (!cls) return null;
  const students: Student[] = [];
  for (const sid of cls.studentIds ?? []) {
    const student = await readRtdb<Student>(`/students/${sid}`);
    if (student) students.push(student);
  }
  return { classId, name: cls.name, students };
}
```

- [ ] **Step 4: Add the exports to the shared barrel**

```ts
// apps/portal/src/features/check-in/shared/index.ts — append
export * from './rtdb/classlist';
```

- [ ] **Step 5: Run test — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/classlist.test.ts
```

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/shared/rtdb/classlist.ts apps/portal/src/features/check-in/shared/index.ts apps/portal/src/features/check-in/shared/__tests__/classlist.test.ts
git commit -m "feat(portal): add shared classlist helpers (listClasses, getRosterForClass) reading from master RTDB"
```

---

## Task 3: Teacher dashboard page + `ClassListCard` + `TeacherDashboard` components

**Files:**
- Create: `apps/portal/src/features/check-in/teacher/class-list-card.tsx`
- Create: `apps/portal/src/features/check-in/teacher/teacher-dashboard.tsx`
- Create: `apps/portal/src/features/check-in/teacher/index.ts`
- Create: `apps/portal/src/app/check-in/teacher/page.tsx`
- Create: `apps/portal/src/app/check-in/teacher/error.tsx`
- Create: `apps/portal/src/app/check-in/teacher/loading.tsx`
- Test: `apps/portal/src/features/check-in/teacher/__tests__/teacher-dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/teacher/__tests__/teacher-dashboard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherDashboard } from '../teacher-dashboard';

const classes = [
  { classId: 'K', name: 'Kindergarten', studentCount: 12 },
  { classId: 'G1', name: 'Grade 1', studentCount: 10 },
];

describe('TeacherDashboard', () => {
  it('renders a card per class', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByText(/kindergarten/i)).toBeInTheDocument();
    expect(screen.getByText(/grade 1/i)).toBeInTheDocument();
  });

  it('shows student counts', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('links each class to /check-in/teacher/attendance?classId=<id>', () => {
    render(<TeacherDashboard classes={classes} />);
    const kLink = screen.getByRole('link', { name: /kindergarten/i });
    expect(kLink).toHaveAttribute('href', '/check-in/teacher/attendance?classId=K');
  });

  it('has nav links to report and uninformed', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByRole('link', { name: /report/i })).toHaveAttribute(
      'href',
      '/check-in/teacher/report',
    );
    expect(screen.getByRole('link', { name: /uninformed/i })).toHaveAttribute(
      'href',
      '/check-in/teacher/uninformed',
    );
  });

  it('shows empty state when no classes', () => {
    render(<TeacherDashboard classes={[]} />);
    expect(screen.getByText(/no classes/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/teacher/__tests__/teacher-dashboard.test.tsx
```

- [ ] **Step 3: Create `apps/portal/src/features/check-in/teacher/class-list-card.tsx`**

```tsx
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@cmt/ui';

interface Props {
  classId: string;
  name: string;
  studentCount: number;
}

export function ClassListCard({ classId, name, studentCount }: Props) {
  return (
    <Link
      href={`/check-in/teacher/attendance?classId=${classId}`}
      className="block focus:outline-none"
    >
      <Card className="h-full transition hover:shadow-md">
        <CardHeader>
          <CardTitle>{name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[hsl(var(--foreground))]">{studentCount} students</p>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/teacher/teacher-dashboard.tsx`**

```tsx
import Link from 'next/link';
import { ClassListCard } from './class-list-card';

interface Props {
  classes: Array<{ classId: string; name: string; studentCount: number }>;
}

export function TeacherDashboard({ classes }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Teacher</h1>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <nav className="flex gap-4 text-sm">
        <Link href="/check-in/teacher/report" className="underline">
          Attendance report
        </Link>
        <Link href="/check-in/teacher/uninformed" className="underline">
          Uninformed absentees
        </Link>
      </nav>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">Your classes</h2>
        {classes.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground))]">No classes assigned yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <ClassListCard key={c.classId} {...c} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/teacher/index.ts`**

```ts
export { TeacherDashboard } from './teacher-dashboard';
export { ClassListCard } from './class-list-card';
```

- [ ] **Step 6: Create `apps/portal/src/app/check-in/teacher/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { TeacherDashboard } from '@/features/check-in/teacher';
import { listClasses } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Teacher — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function TeacherDashboardPage() {
  if (!flags.checkInTeacher) notFound();
  const classes = await listClasses();
  return <TeacherDashboard classes={classes} />;
}
```

- [ ] **Step 7: Create `error.tsx` and `loading.tsx`**

```tsx
// error.tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function TeacherError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Teacher dashboard error" />;
}
```

```tsx
// loading.tsx
export default function TeacherLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" role="status" aria-label="Loading" />
    </main>
  );
}
```

- [ ] **Step 8: Run tests — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/teacher/__tests__/teacher-dashboard.test.tsx
```

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/features/check-in/teacher/ apps/portal/src/app/check-in/teacher/
git commit -m "feat(portal): /check-in/teacher dashboard with ClassListCard grid + nav to report/uninformed"
```

---

## Task 4: `AttendanceStatusBadge` component

**Files:**
- Create: `apps/portal/src/features/check-in/teacher/attendance-status-badge.tsx`
- Test: `apps/portal/src/features/check-in/teacher/__tests__/attendance-status-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/teacher/__tests__/attendance-status-badge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceStatusBadge } from '../attendance-status-badge';

describe('AttendanceStatusBadge', () => {
  it('renders present', () => {
    render(<AttendanceStatusBadge status="present" />);
    expect(screen.getByText(/present/i)).toBeInTheDocument();
  });
  it('renders absent', () => {
    render(<AttendanceStatusBadge status="absent" />);
    expect(screen.getByText(/absent/i)).toBeInTheDocument();
  });
  it('renders late', () => {
    render(<AttendanceStatusBadge status="late" />);
    expect(screen.getByText(/late/i)).toBeInTheDocument();
  });
  it('renders uninformed', () => {
    render(<AttendanceStatusBadge status="uninformed" />);
    expect(screen.getByText(/uninformed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/teacher/__tests__/attendance-status-badge.test.tsx
```

- [ ] **Step 3: Create `apps/portal/src/features/check-in/teacher/attendance-status-badge.tsx`**

```tsx
import type { AttendanceStatus } from '@cmt/shared-domain/check-in';

const palette: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  absent: 'bg-red-100 text-red-900 border-red-300',
  late: 'bg-amber-100 text-amber-900 border-amber-300',
  uninformed: 'bg-slate-200 text-slate-900 border-slate-400',
};

const labels: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  uninformed: 'Uninformed',
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      {labels[status]}
    </span>
  );
}
```

- [ ] **Step 4: Update teacher barrel**

```ts
// apps/portal/src/features/check-in/teacher/index.ts
export { TeacherDashboard } from './teacher-dashboard';
export { ClassListCard } from './class-list-card';
export { AttendanceStatusBadge } from './attendance-status-badge';
```

- [ ] **Step 5: Run test — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/teacher/attendance-status-badge.tsx apps/portal/src/features/check-in/teacher/index.ts apps/portal/src/features/check-in/teacher/__tests__/attendance-status-badge.test.tsx
git commit -m "feat(portal): add AttendanceStatusBadge with color coding for {present,absent,late,uninformed}"
```

---

## Task 5: `AttendanceMarker` component + `/check-in/teacher/attendance` page

**Files:**
- Create: `apps/portal/src/features/check-in/teacher/attendance-marker.tsx`
- Create: `apps/portal/src/app/check-in/teacher/attendance/page.tsx`
- Create: `apps/portal/src/app/check-in/teacher/attendance/error.tsx`
- Test: `apps/portal/src/features/check-in/teacher/__tests__/attendance-marker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/teacher/__tests__/attendance-marker.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttendanceMarker } from '../attendance-marker';
import type { ClassRoster } from '@cmt/shared-domain/check-in';

const roster: ClassRoster = {
  classId: 'K',
  name: 'Kindergarten',
  students: [
    { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
    { sid: '2', fid: '43', firstName: 'Bob', lastName: 'Bravo', level: 'K' },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('AttendanceMarker', () => {
  it('renders one row per student with four status radio buttons', () => {
    render(<AttendanceMarker roster={roster} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /present/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /absent/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /late/i })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: /uninformed/i })).toHaveLength(2);
  });

  it('defaults all students to present', () => {
    render(<AttendanceMarker roster={roster} />);
    const presentRadios = screen.getAllByRole('radio', { name: /present/i });
    for (const r of presentRadios) expect(r).toBeChecked();
  });

  it('submits status map to /api/check-in/teacher/attendance', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, recorded: 2 }),
    } as Response);

    render(<AttendanceMarker roster={roster} />);
    const absentRadios = screen.getAllByRole('radio', { name: /absent/i });
    await user.click(absentRadios[1]!);  // mark Bob absent
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/teacher/attendance',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.classId).toBe('K');
    expect(body.statuses['1']).toBe('present');
    expect(body.statuses['2']).toBe('absent');
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows error on non-ok response', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<AttendanceMarker roster={roster} />);
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/teacher/__tests__/attendance-marker.test.tsx
```

- [ ] **Step 3: Create `apps/portal/src/features/check-in/teacher/attendance-marker.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type ClassRoster,
} from '@cmt/shared-domain/check-in';

interface Props {
  roster: ClassRoster;
  defaultDate?: string;
}

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AttendanceMarker({ roster, defaultDate }: Props) {
  const [date] = useState(defaultDate ?? todayYMD());
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(
    Object.fromEntries(roster.students.map((s) => [s.sid, 'present' as AttendanceStatus])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setStatus(sid: string, status: AttendanceStatus) {
    setStatuses((prev) => ({ ...prev, [sid]: status }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/check-in/teacher/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classId: roster.classId, date, statuses }),
      });
      if (!res.ok) {
        setError('Submit failed. Try again.');
        return;
      }
      window.location.assign(`/check-in/teacher?submitted=${roster.classId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">{roster.name}</h1>
        <p className="text-sm text-[hsl(var(--foreground))]">Date: {date}</p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Student</th>
            {ATTENDANCE_STATUSES.map((s) => (
              <th key={s} className="p-2 text-center capitalize">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roster.students.map((student) => (
            <tr key={student.sid} className="border-b">
              <td className="p-2">
                {student.firstName} {student.lastName}
              </td>
              {ATTENDANCE_STATUSES.map((s) => (
                <td key={s} className="p-2 text-center">
                  <input
                    type="radio"
                    name={`status-${student.sid}`}
                    aria-label={`${s} ${student.firstName}`}
                    checked={statuses[student.sid] === s}
                    onChange={() => setStatus(student.sid, s)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit attendance'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/check-in/teacher/attendance/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { getRosterForClass } from '@/features/check-in/shared';
import { AttendanceMarker } from '@/features/check-in/teacher/attendance-marker';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Mark attendance — CMT Portal' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ classId?: string }>;
}

export default async function MarkAttendancePage({ searchParams }: Props) {
  if (!flags.checkInTeacher) notFound();
  const params = await searchParams;
  const classId = params.classId;
  if (!classId) redirect('/check-in/teacher');

  const roster = await getRosterForClass(classId);
  if (!roster) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <AttendanceMarker roster={roster} />
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/teacher/attendance/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function AttendanceError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Attendance page error" />;
}
```

- [ ] **Step 6: Update teacher barrel**

```ts
// apps/portal/src/features/check-in/teacher/index.ts
export { TeacherDashboard } from './teacher-dashboard';
export { ClassListCard } from './class-list-card';
export { AttendanceStatusBadge } from './attendance-status-badge';
export { AttendanceMarker } from './attendance-marker';
```

- [ ] **Step 7: Run test — expect pass**

- [ ] **Step 8: Commit**

```sh
git add apps/portal/src/features/check-in/teacher/attendance-marker.tsx apps/portal/src/features/check-in/teacher/index.ts apps/portal/src/app/check-in/teacher/attendance/ apps/portal/src/features/check-in/teacher/__tests__/attendance-marker.test.tsx
git commit -m "feat(portal): AttendanceMarker component + /check-in/teacher/attendance page with radio grid"
```

---

## Task 6: `GET /api/check-in/teacher/classlist` + `GET /api/check-in/teacher/roster/:classId`

**Files:**
- Create: `apps/portal/src/app/api/check-in/teacher/classlist/route.ts`
- Create: `apps/portal/src/app/api/check-in/teacher/roster/[classId]/route.ts`
- Test: `apps/portal/src/app/api/check-in/teacher/__tests__/classlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/teacher/__tests__/classlist.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  listClasses: vi.fn(),
  getRosterForClass: vi.fn(),
}));

import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import * as classlistHandler from '../classlist/route';
import * as rosterHandler from '../roster/[classId]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/teacher/classlist', () => {
  it('returns 200 with classes', async () => {
    (listClasses as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { classId: 'K', name: 'Kindergarten', studentCount: 12 },
    ]);
    await testApiHandler({
      appHandler: classlistHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.classes).toHaveLength(1);
        expect(body.classes[0].classId).toBe('K');
      },
    });
  });
});

describe('GET /api/check-in/teacher/roster/:classId', () => {
  it('returns 200 with roster', async () => {
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'Kindergarten',
      students: [{ sid: '1', fid: '42', firstName: 'A', lastName: 'B', level: 'K' }],
    });
    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'K' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.classId).toBe('K');
        expect(body.students).toHaveLength(1);
      },
    });
  });

  it('returns 404 when not found', async () => {
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler: rosterHandler,
      params: { classId: 'X' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/teacher/__tests__/classlist.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/teacher/classlist/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { listClasses } from '@/features/check-in/shared';
import type { TeacherClassListResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const classes = await listClasses();
  const body: TeacherClassListResponse = { classes };
  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Create `apps/portal/src/app/api/check-in/teacher/roster/[classId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getRosterForClass } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const roster = await getRosterForClass(classId);
  if (!roster) {
    return NextResponse.json({ error: 'class-not-found' }, { status: 404 });
  }
  return NextResponse.json(roster, { status: 200 });
}
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/app/api/check-in/teacher/classlist/ apps/portal/src/app/api/check-in/teacher/roster/ apps/portal/src/app/api/check-in/teacher/__tests__/classlist.test.ts
git commit -m "feat(portal): teacher classlist + roster GET endpoints reading from master RTDB"
```

---

## Task 7: CSV serializer

Pure function. Used by the report endpoint and admin exports in B4.

**Files:**
- Create: `apps/portal/src/features/check-in/teacher/csv.ts`
- Test: `apps/portal/src/features/check-in/teacher/__tests__/csv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/teacher/__tests__/csv.test.ts
import { describe, it, expect } from 'vitest';
import { toCsv, type CsvRow } from '../csv';

describe('toCsv', () => {
  it('serializes headers + rows', () => {
    const rows: CsvRow[] = [
      { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Alice', lastName: 'Acme', status: 'present' },
      { date: '2026-04-13', classId: 'K', sid: '2', firstName: 'Bob', lastName: 'Bravo', status: 'absent' },
    ];
    const csv = toCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,classId,sid,firstName,lastName,status');
    expect(lines[1]).toBe('2026-04-13,K,1,Alice,Acme,present');
    expect(lines[2]).toBe('2026-04-13,K,2,Bob,Bravo,absent');
  });

  it('escapes commas and quotes', () => {
    const rows: CsvRow[] = [
      { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Al, "Ace"', lastName: 'Acme', status: 'present' },
    ];
    const csv = toCsv(rows);
    expect(csv).toContain('"Al, ""Ace"""');
  });

  it('returns just headers for empty rows', () => {
    const csv = toCsv([]);
    expect(csv).toBe('date,classId,sid,firstName,lastName,status');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/teacher/csv.ts`**

```ts
import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';

export type CsvRow = TeacherReportEntry;

const HEADERS: Array<keyof CsvRow> = [
  'date',
  'classId',
  'sid',
  'firstName',
  'lastName',
  'status',
];

function escapeField(v: string): string {
  if (v.includes('"') || v.includes(',') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toCsv(rows: CsvRow[]): string {
  const header = HEADERS.join(',');
  if (rows.length === 0) return header;
  const body = rows
    .map((row) => HEADERS.map((h) => escapeField(String(row[h]))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/teacher/csv.ts apps/portal/src/features/check-in/teacher/__tests__/csv.test.ts
git commit -m "feat(portal): add CSV serializer for teacher attendance exports"
```

---

## Task 8: `POST /api/check-in/teacher/attendance` — write attendance records

**Files:**
- Create: `apps/portal/src/app/api/check-in/teacher/attendance/route.ts`
- Test: `apps/portal/src/app/api/check-in/teacher/__tests__/attendance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/teacher/__tests__/attendance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeDoc = { set: vi.fn() };
const fakeSubCollection = { doc: vi.fn(() => fakeDoc) };
const fakeClassDoc = { collection: vi.fn(() => fakeSubCollection) };
const fakeDateCollection = { doc: vi.fn(() => fakeClassDoc) };
const fakeDateDoc = { collection: vi.fn(() => fakeDateCollection) };
const fakeRoot = { doc: vi.fn(() => fakeDateDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeRoot) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

import * as appHandler from '../../attendance/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/check-in/teacher/attendance', () => {
  it('returns 401 without uid header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ classId: 'K', date: '2026-04-13', statuses: { '1': 'present' } }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ classId: 'K' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('rejects unknown status values', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classId: 'K',
            date: '2026-04-13',
            statuses: { '1': 'chilling' },
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('writes one record per student and returns count', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classId: 'K',
            date: '2026-04-13',
            statuses: { '1': 'present', '2': 'late', '3': 'absent' },
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recorded).toBe(3);
      },
    });
    expect(fakeDoc.set).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/teacher/attendance/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { ATTENDANCE_STATUSES, type TeacherAttendanceResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const statusEnum = z.enum(ATTENDANCE_STATUSES);
const bodySchema = z.object({
  classId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statuses: z.record(z.string(), statusEnum),
});

export async function POST(req: Request) {
  const uid = req.headers.get('x-portal-uid');
  if (!uid) return NextResponse.json({ error: 'no-uid' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { classId, date, statuses } = parsed.data;
  const db = portalFirestore();
  const markedAt = new Date().toISOString();

  let recorded = 0;
  for (const [sid, status] of Object.entries(statuses)) {
    await db
      .collection('attendance')
      .doc(date)
      .collection(classId)
      .doc(sid)
      .set({
        date,
        classId,
        sid,
        status,
        markedAt,
        markedByUid: uid,
      });
    recorded += 1;
  }

  const body: TeacherAttendanceResponse = { success: true, recorded };
  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/teacher/attendance/ apps/portal/src/app/api/check-in/teacher/__tests__/attendance.test.ts
git commit -m "feat(portal): POST /api/check-in/teacher/attendance writes per-student records with zod validation"
```

---

## Task 9: `GET /api/check-in/teacher/report` + `AttendanceReportTable` + page

**Files:**
- Create: `apps/portal/src/app/api/check-in/teacher/report/route.ts`
- Create: `apps/portal/src/features/check-in/teacher/attendance-report-table.tsx`
- Create: `apps/portal/src/app/check-in/teacher/report/page.tsx`
- Create: `apps/portal/src/app/check-in/teacher/report/error.tsx`
- Test: `apps/portal/src/app/api/check-in/teacher/__tests__/report.test.ts`
- Test: `apps/portal/src/features/check-in/teacher/__tests__/attendance-report-table.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/portal/src/app/api/check-in/teacher/__tests__/report.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((d) => ({ data: () => d })),
});

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collectionGroup: vi.fn(() => fakeQuery),
  })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  getRosterForClass: vi.fn(),
}));

import { getRosterForClass } from '@/features/check-in/shared';
import * as appHandler from '../../report/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.get.mockReset();
});

describe('GET /api/check-in/teacher/report', () => {
  it('returns JSON by default', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { date: '2026-04-13', classId: 'K', sid: '1', status: 'present', markedAt: 'x', markedByUid: 'u' },
      ]),
    );
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/report?classId=K&from=2026-04-01&to=2026-04-30',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].firstName).toBe('Alice');
      },
    });
  });

  it('returns CSV when Accept: text/csv', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { date: '2026-04-13', classId: 'K', sid: '1', status: 'present', markedAt: 'x', markedByUid: 'u' },
      ]),
    );
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });

    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/report?classId=K',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { accept: 'text/csv' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        expect(res.headers.get('content-disposition')).toMatch(/attendance.*\.csv/);
        const body = await res.text();
        expect(body).toContain('date,classId,sid,firstName,lastName,status');
        expect(body).toContain('Alice');
      },
    });
  });
});
```

```tsx
// apps/portal/src/features/check-in/teacher/__tests__/attendance-report-table.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceReportTable } from '../attendance-report-table';
import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';

const entries: TeacherReportEntry[] = [
  { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Alice', lastName: 'Acme', status: 'present' },
  { date: '2026-04-13', classId: 'K', sid: '2', firstName: 'Bob', lastName: 'Bravo', status: 'late' },
];

describe('AttendanceReportTable', () => {
  it('renders a row per entry', () => {
    render(<AttendanceReportTable entries={entries} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });
  it('shows empty state when no entries', () => {
    render(<AttendanceReportTable entries={[]} />);
    expect(screen.getByText(/no records/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/teacher/report/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getRosterForClass } from '@/features/check-in/shared';
import { toCsv } from '@/features/check-in/teacher/csv';
import type {
  AttendanceStatus,
  TeacherReportEntry,
  TeacherReportResponse,
} from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const classId = url.searchParams.get('classId');
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  if (!classId) {
    return NextResponse.json({ error: 'classId required' }, { status: 400 });
  }

  let query = portalFirestore()
    .collectionGroup(classId)
    .where('classId', '==', classId);
  if (from) query = query.where('date', '>=', from);
  if (to) query = query.where('date', '<=', to);
  query = query.orderBy('date', 'desc');

  const snap = await query.get();
  const roster = await getRosterForClass(classId);
  const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));

  const entries: TeacherReportEntry[] = snap.docs.map((d) => {
    const data = d.data() as {
      date: string;
      classId: string;
      sid: string;
      status: AttendanceStatus;
    };
    const student = studentMap.get(data.sid);
    return {
      date: data.date,
      classId: data.classId,
      sid: data.sid,
      firstName: student?.firstName ?? 'Unknown',
      lastName: student?.lastName ?? '',
      status: data.status,
    };
  });

  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('text/csv')) {
    const csv = toCsv(entries);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="attendance-${classId}.csv"`,
      },
    });
  }

  const body: TeacherReportResponse = { entries };
  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/teacher/attendance-report-table.tsx`**

```tsx
import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';
import { AttendanceStatusBadge } from './attendance-status-badge';

interface Props {
  entries: TeacherReportEntry[];
}

export function AttendanceReportTable({ entries }: Props) {
  if (entries.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">No records.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">Date</th>
          <th className="p-2">Class</th>
          <th className="p-2">Student</th>
          <th className="p-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.date}-${e.classId}-${e.sid}`} className="border-b">
            <td className="p-2">{e.date}</td>
            <td className="p-2">{e.classId}</td>
            <td className="p-2">{e.firstName} {e.lastName}</td>
            <td className="p-2"><AttendanceStatusBadge status={e.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/teacher/report/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listClasses } from '@/features/check-in/shared';
import { AttendanceReportTable } from '@/features/check-in/teacher/attendance-report-table';
import { toCsv } from '@/features/check-in/teacher/csv';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getRosterForClass } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';
import type { AttendanceStatus, TeacherReportEntry } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Attendance report — CMT Portal' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ classId?: string; from?: string; to?: string }>;
}

export default async function ReportPage({ searchParams }: Props) {
  if (!flags.checkInTeacher) notFound();
  const params = await searchParams;
  const classes = await listClasses();
  const classId = params.classId ?? classes[0]?.classId;

  let entries: TeacherReportEntry[] = [];
  if (classId) {
    let q = portalFirestore().collectionGroup(classId).where('classId', '==', classId);
    if (params.from) q = q.where('date', '>=', params.from);
    if (params.to) q = q.where('date', '<=', params.to);
    q = q.orderBy('date', 'desc');
    const snap = await q.get();
    const roster = await getRosterForClass(classId);
    const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));
    entries = snap.docs.map((d) => {
      const data = d.data() as { date: string; classId: string; sid: string; status: AttendanceStatus };
      const st = studentMap.get(data.sid);
      return {
        date: data.date,
        classId: data.classId,
        sid: data.sid,
        firstName: st?.firstName ?? 'Unknown',
        lastName: st?.lastName ?? '',
        status: data.status,
      };
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Attendance report</h1>
        <Link href="/check-in/teacher" className="text-sm underline">
          ← Back
        </Link>
      </header>

      <form action="/check-in/teacher/report" method="get" className="flex flex-wrap gap-2">
        <select name="classId" defaultValue={classId} className="rounded border px-2 py-1">
          {classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="from" type="date" defaultValue={params.from ?? ''} className="rounded border px-2 py-1" />
        <input name="to" type="date" defaultValue={params.to ?? ''} className="rounded border px-2 py-1" />
        <button type="submit" className="rounded bg-[hsl(var(--primary))] px-3 py-1 text-white">
          Filter
        </button>
      </form>

      {classId && (
        <a
          href={`/api/check-in/teacher/report?classId=${classId}${params.from ? `&from=${params.from}` : ''}${params.to ? `&to=${params.to}` : ''}`}
          className="self-start text-sm underline"
          download
        >
          Download CSV
        </a>
      )}

      <AttendanceReportTable entries={entries} />
    </main>
  );
}
```

- [ ] **Step 6: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function ReportError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Report error" />;
}
```

- [ ] **Step 7: Update teacher barrel**

```ts
export { TeacherDashboard } from './teacher-dashboard';
export { ClassListCard } from './class-list-card';
export { AttendanceStatusBadge } from './attendance-status-badge';
export { AttendanceMarker } from './attendance-marker';
export { AttendanceReportTable } from './attendance-report-table';
```

- [ ] **Step 8: Run tests — expect pass**

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/app/api/check-in/teacher/report/ apps/portal/src/features/check-in/teacher/attendance-report-table.tsx apps/portal/src/app/check-in/teacher/report/ apps/portal/src/features/check-in/teacher/index.ts apps/portal/src/app/api/check-in/teacher/__tests__/report.test.ts apps/portal/src/features/check-in/teacher/__tests__/attendance-report-table.test.tsx
git commit -m "feat(portal): /check-in/teacher/report + GET /api/check-in/teacher/report with CSV export"
```

---

## Task 10: Skipped (the CSV download link is inline in Task 9's page)

No separate component — the report page embeds a `<a href="...">Download CSV</a>` link that triggers the Accept: text/csv branch of Task 9's endpoint. Task count reduces — renumber remaining tasks below.

---

## Task 11: `GET /api/check-in/teacher/uninformed` + `/check-in/teacher/uninformed` page

Lists students whose latest attendance is `uninformed`.

**Files:**
- Create: `apps/portal/src/app/api/check-in/teacher/uninformed/route.ts`
- Create: `apps/portal/src/app/check-in/teacher/uninformed/page.tsx`
- Create: `apps/portal/src/app/check-in/teacher/uninformed/error.tsx`
- Test: `apps/portal/src/app/api/check-in/teacher/__tests__/uninformed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/teacher/__tests__/uninformed.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collectionGroup: vi.fn(() => fakeQuery) })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  getRosterForClass: vi.fn(),
  listClasses: vi.fn(),
}));

import * as appHandler from '../../uninformed/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.get.mockReset();
});

describe('GET /api/check-in/teacher/uninformed', () => {
  it('returns entries filtered to uninformed status', async () => {
    fakeQuery.get.mockResolvedValueOnce({
      docs: [
        { data: () => ({ date: '2026-04-13', classId: 'K', sid: '1', status: 'uninformed' }) },
      ],
    });
    const { listClasses, getRosterForClass } = await import('@/features/check-in/shared');
    (listClasses as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { classId: 'K', name: 'K', studentCount: 1 },
    ]);
    (getRosterForClass as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      classId: 'K',
      name: 'K',
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/teacher/uninformed',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0].status).toBe('uninformed');
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/teacher/uninformed/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import type {
  AttendanceStatus,
  TeacherReportEntry,
  TeacherUninformedResponse,
} from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  const classes = await listClasses();
  const entries: TeacherReportEntry[] = [];

  for (const c of classes) {
    let q = portalFirestore()
      .collectionGroup(c.classId)
      .where('classId', '==', c.classId)
      .where('status', '==', 'uninformed');
    if (from) q = q.where('date', '>=', from);
    if (to) q = q.where('date', '<=', to);
    q = q.orderBy('date', 'desc');

    const snap = await q.get();
    const roster = await getRosterForClass(c.classId);
    const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));

    for (const doc of snap.docs) {
      const data = doc.data() as { date: string; classId: string; sid: string; status: AttendanceStatus };
      const st = studentMap.get(data.sid);
      entries.push({
        date: data.date,
        classId: data.classId,
        sid: data.sid,
        firstName: st?.firstName ?? 'Unknown',
        lastName: st?.lastName ?? '',
        status: data.status,
      });
    }
  }

  const body: TeacherUninformedResponse = { entries };
  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Create `apps/portal/src/app/check-in/teacher/uninformed/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listClasses, getRosterForClass } from '@/features/check-in/shared';
import { AttendanceReportTable } from '@/features/check-in/teacher/attendance-report-table';
import { flags } from '@/lib/flags';
import type { AttendanceStatus, TeacherReportEntry } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Uninformed absentees — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function UninformedPage() {
  if (!flags.checkInTeacher) notFound();

  const classes = await listClasses();
  const entries: TeacherReportEntry[] = [];
  for (const c of classes) {
    const snap = await portalFirestore()
      .collectionGroup(c.classId)
      .where('classId', '==', c.classId)
      .where('status', '==', 'uninformed')
      .orderBy('date', 'desc')
      .get();
    const roster = await getRosterForClass(c.classId);
    const studentMap = new Map((roster?.students ?? []).map((s) => [s.sid, s]));
    for (const doc of snap.docs) {
      const data = doc.data() as { date: string; classId: string; sid: string; status: AttendanceStatus };
      const st = studentMap.get(data.sid);
      entries.push({
        date: data.date,
        classId: data.classId,
        sid: data.sid,
        firstName: st?.firstName ?? 'Unknown',
        lastName: st?.lastName ?? '',
        status: data.status,
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Uninformed absentees</h1>
        <Link href="/check-in/teacher" className="text-sm underline">
          ← Back
        </Link>
      </header>
      <AttendanceReportTable entries={entries} />
    </main>
  );
}
```

- [ ] **Step 5: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function UninformedError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Uninformed page error" />;
}
```

- [ ] **Step 6: Run test — expect pass**

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/app/api/check-in/teacher/uninformed/ apps/portal/src/app/check-in/teacher/uninformed/ apps/portal/src/app/api/check-in/teacher/__tests__/uninformed.test.ts
git commit -m "feat(portal): /check-in/teacher/uninformed page + GET endpoint filtering by status=uninformed"
```

---

## Task 12: Full-suite checkpoint

**Files:** none — verification step.

- [ ] **Step 1: Run all workspaces**

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Expected: green.

---

## Task 13: Playwright `e2e/b3-teacher.spec.ts`

**Files:**
- Create: `apps/portal/e2e/b3-teacher.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
// apps/portal/e2e/b3-teacher.spec.ts
import { test, expect } from './fixtures';

const PASSPHRASE = process.env.E2E_TEACHER_PASSPHRASE ?? process.env.TEACHER_PASSPHRASE ?? '';

test.describe('B3 — teacher portal', () => {
  test('teacher login → dashboard flow', async ({ page }) => {
    test.skip(!PASSPHRASE, 'TEACHER_PASSPHRASE not available');
    await page.goto('/login/teacher');
    await page.getByLabel(/passphrase/i).fill(PASSPHRASE);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/check-in/teacher');
    await expect(page.getByRole('heading', { name: /teacher/i })).toBeVisible();
  });

  test('unauthenticated /check-in/teacher redirects', async ({ page }) => {
    await page.goto('/check-in/teacher');
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 2: Lint**

```sh
pnpm --filter @cmt/portal lint
```

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b3-teacher.spec.ts
git commit -m "test(portal): add b3-teacher.spec.ts covering login + dashboard smoke"
```

---

## Task 14: README/CLAUDE.md update + final pre-push + push

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update README slice-B progress tracker**

```markdown
- **Slice B** — 🚧 In progress —
  - B0 ✅ — Portal auth foundation
  - B2 ✅ — Family portal
  - B3 ✅ — Teacher portal (attendance, report, uninformed)
  - B1 — Kiosk port (next)
  - B4 — Admin dashboard
  - B5 — Notifications & cron
```

- [ ] **Step 2: Update CLAUDE.md "Slice B status"**

```markdown
**Slice B status:** In progress. B0 + B2 + B3 shipped. B1 (kiosk 1:1 port) is next.
```

- [ ] **Step 3: Flip `NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER=true` in `.env.local`**

- [ ] **Step 4: Run the full pre-push suite**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 5: Commit docs**

```sh
git add README.md CLAUDE.md
git commit -m "docs: mark B3 shipped in slice-B progress tracker"
```

- [ ] **Step 6: Push**

```sh
git push origin main
```

B3 is shipped. Next: B1 (kiosk).

---

## B3 acceptance gate summary

| # | Criterion | Verified by |
|---|---|---|
| B3-AC-1 | Wrong passphrase returns 401, no user created | B0 Task 23 |
| B3-AC-2 | Correct passphrase → session cookie → `/check-in/teacher` | B0 + B3 Task 13 |
| B3-AC-3 | `/check-in/teacher` lists classes from RTDB | Task 3 |
| B3-AC-4 | `/check-in/teacher/attendance` writes Firestore records | Task 8 |
| B3-AC-5 | `/check-in/teacher/report?Accept=text/csv` returns CSV with headers | Task 9 |
| B3-AC-6 | `/check-in/teacher/uninformed` lists only uninformed entries | Task 11 |
| B3-AC-7 | Playwright b3-teacher green | Task 13 |
| B3-AC-8 | Bearer mode works on `/api/check-in/teacher/*` | B0 middleware |
| B3-AC-9 | ≥80% coverage under `features/check-in/teacher/` | Soft |
| B3-AC-10 | No `react-datepicker`/`headlessui` added | package.json review |
| B3-AC-11 | `pnpm typecheck && lint && test && build` green | Task 14 |
| B3-AC-12 | `NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER` flag toggles routes | Task 3/5/9/11 `flags.checkInTeacher` gate |

On green: B3 shipped. Next plan: B1 kiosk.

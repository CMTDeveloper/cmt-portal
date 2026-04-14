# Slice B4 — Admin Dashboard + Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the B0 stub `/check-in/admin` with a real admin dashboard: stats cards (today's check-ins, guest count, unpaid-family count, week-over-week), admin user provisioning UI (`/check-in/admin/users` — list, add, delete with self-delete guard), guest list with pagination (`/check-in/admin/guests`), unpaid-family list with "send donation email" button (`/check-in/admin/unpaid`), and CSV attendance/check-in/guest exports (`/check-in/admin/reports`). All admin-gated.

**Architecture:** All routes and APIs live under `features/check-in/admin/*` and `/api/check-in/admin/*`. Admin user CRUD uses `getOrCreateAdminUser`, `listUsers`, `deleteUser`, `setCustomUserClaims` from `@cmt/firebase-shared/admin/claims` + `admin/auth`. Self-delete is guarded at the handler level. The "send donation email" button calls the B5 notifications API, which in B4 is wired to B2's `mockSender` (real AWS in B5). Exports use the Task 7 CSV serializer from B3 — no `xlsx` client bundle, server-only `exceljs` if xlsx is ever added in a later slice.

**Tech Stack:** Builds on B0 auth middleware, B2 `features/check-in/shared/*` + domain types, B3's CSV serializer. Uses `@cmt/ui` shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` §13 (B4 detail)

**Predecessor plans:** B0, B2, B3, B1.

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisites:** B0 + B2 + B3 + B1 shipped. Verify:

```sh
test -f apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts && \
test -f apps/portal/src/features/check-in/teacher/csv.ts && \
test -f packages/firebase-shared/src/admin/claims.ts && \
echo "OK" || echo "MISSING prerequisite"
```

**Feature flag during execution:** `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN=true` in `.env.local` (already true from B0 dev setup — verify).

**Seeded admin required:** Every e2e and manual verification needs the bootstrapped admin from `pnpm seed:admin`. Re-run if needed.

---

## File structure overview

```
apps/portal/src/features/check-in/admin/
  admin-dashboard.tsx                                       [Task 2]
  stat-card.tsx                                             [Task 2]
  admin-user-list.tsx                                       [Task 5]
  add-admin-form.tsx                                        [Task 5]
  delete-admin-button.tsx                                   [Task 5]
  guest-list.tsx                                            [Task 7]
  guest-filters.tsx                                         [Task 7]
  cursor-pagination.tsx                                     [Task 7]
  unpaid-family-list.tsx                                    [Task 9]
  send-donation-email-button.tsx                            [Task 9]
  report-export-button.tsx                                  [Task 11]
  index.ts                                                  [Task 2, MODIFIED]
  __tests__/
    admin-dashboard.test.tsx                                [Task 2]
    admin-user-list.test.tsx                                [Task 5]
    guest-list.test.tsx                                     [Task 7]
    unpaid-family-list.test.tsx                             [Task 9]

apps/portal/src/app/check-in/admin/
  page.tsx                                                  [Task 2, REPLACES B0 stub]
  users/
    page.tsx                                                [Task 5]
    error.tsx                                               [Task 5]
  guests/
    page.tsx                                                [Task 7]
    error.tsx                                               [Task 7]
  unpaid/
    page.tsx                                                [Task 9]
    error.tsx                                               [Task 9]
  reports/
    page.tsx                                                [Task 11]
    error.tsx                                               [Task 11]

apps/portal/src/app/api/check-in/admin/
  stats/route.ts                                            [Task 1]
  users/
    route.ts                                                [Task 3]
    [uid]/route.ts                                          [Task 4]
    __tests__/
      users.test.ts                                         [Task 3]
      users-uid.test.ts                                     [Task 4]
  guests/route.ts                                           [Task 6]
  unpaid/route.ts                                           [Task 8]
  reports/[kind]/route.ts                                   [Task 10]
  __tests__/
    stats.test.ts                                           [Task 1]
    guests.test.ts                                          [Task 6]
    unpaid.test.ts                                          [Task 8]
    reports.test.ts                                         [Task 10]

apps/portal/e2e/b4-admin.spec.ts                            [Task 12]
README.md                                                    [Task 13]
CLAUDE.md                                                    [Task 13]
```

**Task count:** 13. **Final task pushes.**

---

## Task 1: `GET /api/check-in/admin/stats` — dashboard stats

Aggregates today's check-in count, guest count, unpaid-family count, and week-over-week check-in delta.

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/stats/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/__tests__/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/__tests__/stats.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (count: number) => ({ size: count, docs: Array.from({ length: count }) });

const fakeCheckIns = {
  where: vi.fn().mockReturnThis(),
  count: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) })),
  get: vi.fn(),
};
const fakeGuests = { get: vi.fn() };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'check_in_events') return fakeCheckIns;
      if (name === 'guest_check_ins') return fakeGuests;
      return fakeCheckIns;
    }),
  })),
}));

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import * as appHandler from '../../stats/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCheckIns.where.mockReturnThis();
  fakeCheckIns.get.mockReset();
  fakeGuests.get.mockReset();
});

describe('GET /api/check-in/admin/stats', () => {
  it('returns counts', async () => {
    fakeCheckIns.get.mockResolvedValueOnce(makeSnap(12)).mockResolvedValueOnce(makeSnap(40));
    fakeGuests.get.mockResolvedValueOnce(makeSnap(3));
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', paymentStatus: 'unpaid', name: 'A', students: [], contacts: [] },
      '2': { fid: '2', paymentStatus: 'paid', name: 'B', students: [], contacts: [] },
      '3': { fid: '3', paymentStatus: 'unpaid', name: 'C', students: [], contacts: [] },
    });

    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-role', 'admin'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkInsToday).toBe(12);
        expect(body.checkInsThisWeek).toBe(40);
        expect(body.guestsToday).toBe(3);
        expect(body.unpaidFamilies).toBe(2);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/stats/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Family } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET() {
  const db = portalFirestore();
  const todayIso = startOfTodayIso();
  const weekIso = startOfWeekIso();

  const [todaySnap, weekSnap, guestsSnap, allFamilies] = await Promise.all([
    db.collection('check_in_events').where('checkedInAt', '>=', todayIso).get(),
    db.collection('check_in_events').where('checkedInAt', '>=', weekIso).get(),
    db.collection('guest_check_ins').where('checkedInAt', '>=', todayIso).get(),
    readRtdb<Record<string, Family>>('/families'),
  ]);

  const unpaidFamilies = Object.values(allFamilies ?? {}).filter(
    (f) => f.paymentStatus !== 'paid',
  ).length;

  return NextResponse.json(
    {
      checkInsToday: todaySnap.size,
      checkInsThisWeek: weekSnap.size,
      guestsToday: guestsSnap.size,
      unpaidFamilies,
    },
    { status: 200 },
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/stats/ apps/portal/src/app/api/check-in/admin/__tests__/stats.test.ts
git commit -m "feat(portal): GET /api/check-in/admin/stats with today/week check-ins, guests, unpaid counts"
```

---

## Task 2: Admin dashboard page + `StatCard` + `AdminDashboard` components

Replaces the B0 stub with a real dashboard.

**Files:**
- Create: `apps/portal/src/features/check-in/admin/stat-card.tsx`
- Create: `apps/portal/src/features/check-in/admin/admin-dashboard.tsx`
- Create: `apps/portal/src/features/check-in/admin/index.ts`
- Modify: `apps/portal/src/app/check-in/admin/page.tsx`
- Test: `apps/portal/src/features/check-in/admin/__tests__/admin-dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/admin/__tests__/admin-dashboard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminDashboard } from '../admin-dashboard';

describe('AdminDashboard', () => {
  it('renders four stat cards', () => {
    render(
      <AdminDashboard
        stats={{ checkInsToday: 12, checkInsThisWeek: 40, guestsToday: 3, unpaidFamilies: 5 }}
      />,
    );
    expect(screen.getByText(/check-ins today/i)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.getByText(/guests today/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/unpaid/i)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('renders nav links to users, guests, unpaid, reports', () => {
    render(
      <AdminDashboard
        stats={{ checkInsToday: 0, checkInsThisWeek: 0, guestsToday: 0, unpaidFamilies: 0 }}
      />,
    );
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/check-in/admin/users');
    expect(screen.getByRole('link', { name: /guests/i })).toHaveAttribute('href', '/check-in/admin/guests');
    expect(screen.getByRole('link', { name: /unpaid/i })).toHaveAttribute('href', '/check-in/admin/unpaid');
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/check-in/admin/reports');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/admin/stat-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@cmt/ui';

interface Props {
  title: string;
  value: number | string;
  hint?: string;
}

export function StatCard({ title, value, hint }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-[hsl(var(--heading))]">{value}</div>
        {hint && <p className="text-xs text-[hsl(var(--foreground))]">{hint}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/admin/admin-dashboard.tsx`**

```tsx
import Link from 'next/link';
import { StatCard } from './stat-card';

interface Stats {
  checkInsToday: number;
  checkInsThisWeek: number;
  guestsToday: number;
  unpaidFamilies: number;
}

interface Props {
  stats: Stats;
}

export function AdminDashboard({ stats }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">Admin</h1>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/check-in/admin/users" className="underline">
          Users
        </Link>
        <Link href="/check-in/admin/guests" className="underline">
          Guests
        </Link>
        <Link href="/check-in/admin/unpaid" className="underline">
          Unpaid families
        </Link>
        <Link href="/check-in/admin/reports" className="underline">
          Reports
        </Link>
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Check-ins today" value={stats.checkInsToday} />
        <StatCard title="Check-ins this week" value={stats.checkInsThisWeek} hint="Last 7 days" />
        <StatCard title="Guests today" value={stats.guestsToday} />
        <StatCard title="Unpaid families" value={stats.unpaidFamilies} />
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/admin/index.ts`**

```ts
export { AdminDashboard } from './admin-dashboard';
export { StatCard } from './stat-card';
```

- [ ] **Step 6: Replace `apps/portal/src/app/check-in/admin/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { AdminDashboard } from '@/features/check-in/admin';
import { flags } from '@/lib/flags';
import type { Family } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Admin — CMT Portal' };
export const dynamic = 'force-dynamic';

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function AdminDashboardPage() {
  if (!flags.checkInAdmin) notFound();

  const db = portalFirestore();
  const todayIso = startOfTodayIso();
  const weekIso = startOfWeekIso();

  const [todaySnap, weekSnap, guestsSnap, allFamilies] = await Promise.all([
    db.collection('check_in_events').where('checkedInAt', '>=', todayIso).get(),
    db.collection('check_in_events').where('checkedInAt', '>=', weekIso).get(),
    db.collection('guest_check_ins').where('checkedInAt', '>=', todayIso).get(),
    readRtdb<Record<string, Family>>('/families'),
  ]);

  const stats = {
    checkInsToday: todaySnap.size,
    checkInsThisWeek: weekSnap.size,
    guestsToday: guestsSnap.size,
    unpaidFamilies: Object.values(allFamilies ?? {}).filter((f) => f.paymentStatus !== 'paid').length,
  };

  return <AdminDashboard stats={stats} />;
}
```

- [ ] **Step 7: Run test — expect pass**

- [ ] **Step 8: Commit**

```sh
git add apps/portal/src/features/check-in/admin/ apps/portal/src/app/check-in/admin/page.tsx apps/portal/src/features/check-in/admin/__tests__/admin-dashboard.test.tsx
git commit -m "feat(portal): replace /check-in/admin stub with real dashboard (StatCards + nav)"
```

---

## Task 3: `GET`/`POST /api/check-in/admin/users` — list + create admin

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/users/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/users/__tests__/users.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/users/__tests__/users.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mockAuth = {
  listUsers: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateAdminUser: vi.fn(),
}));

import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/admin/users', () => {
  it('returns users filtered to role=admin', async () => {
    mockAuth.listUsers.mockResolvedValueOnce({
      users: [
        { uid: 'u1', email: 'a@a.com', customClaims: { role: 'admin' } },
        { uid: 'u2', email: 'b@b.com', customClaims: { role: 'teacher' } },
        { uid: 'u3', email: 'c@c.com', customClaims: { role: 'admin' } },
      ],
      pageToken: undefined,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.users).toHaveLength(2);
        expect(body.users.map((u: { uid: string }) => u.uid)).toEqual(['u1', 'u3']);
      },
    });
  });
});

describe('POST /api/check-in/admin/users', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'not-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('creates an admin and returns uid+email', async () => {
    (getOrCreateAdminUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'new-uid',
      email: 'new@cmt.org',
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'new@cmt.org', password: 'TempPass123!' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.uid).toBe('new-uid');
        expect(body.email).toBe('new@cmt.org');
      },
    });
    expect(getOrCreateAdminUser).toHaveBeenCalledWith('new@cmt.org', 'TempPass123!');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/users/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await portalAuth().listUsers(1000);
  const users = result.users
    .filter((u) => (u.customClaims as { role?: string } | undefined)?.role === 'admin')
    .map((u) => ({ uid: u.uid, email: u.email ?? '' }));
  return NextResponse.json({ users }, { status: 200 });
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const user = await getOrCreateAdminUser(parsed.data.email, parsed.data.password);
  return NextResponse.json(
    { uid: user.uid, email: user.email ?? parsed.data.email },
    { status: 201 },
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/users/
git commit -m "feat(portal): GET + POST /api/check-in/admin/users for admin list and creation"
```

---

## Task 4: `DELETE /api/check-in/admin/users/:uid` with self-delete guard

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/users/[uid]/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/users/__tests__/users-uid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/users/__tests__/users-uid.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mockAuth = {
  setCustomUserClaims: vi.fn(),
  updateUser: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

import * as appHandler from '../[uid]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/check-in/admin/users/:uid', () => {
  it('returns 401 without caller uid header', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'target' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on self-delete attempt', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'caller' },
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'caller'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('cannot-self-delete');
      },
    });
  });

  it('clears claims and disables the user on happy path', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'target' },
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'caller'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(200);
      },
    });
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('target', null);
    expect(mockAuth.updateUser).toHaveBeenCalledWith('target', { disabled: true });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/users/[uid]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const callerUid = req.headers.get('x-portal-uid');
  if (!callerUid) {
    return NextResponse.json({ error: 'no-uid' }, { status: 401 });
  }
  const { uid } = await params;
  if (uid === callerUid) {
    return NextResponse.json({ error: 'cannot-self-delete' }, { status: 400 });
  }
  await portalAuth().setCustomUserClaims(uid, null);
  await portalAuth().updateUser(uid, { disabled: true });
  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/users/[uid]/ apps/portal/src/app/api/check-in/admin/users/__tests__/users-uid.test.ts
git commit -m "feat(portal): DELETE /api/check-in/admin/users/:uid with self-delete guard"
```

---

## Task 5: Admin users UI — list + add form + delete button + page

**Files:**
- Create: `apps/portal/src/features/check-in/admin/admin-user-list.tsx`
- Create: `apps/portal/src/features/check-in/admin/add-admin-form.tsx`
- Create: `apps/portal/src/features/check-in/admin/delete-admin-button.tsx`
- Create: `apps/portal/src/app/check-in/admin/users/page.tsx`
- Create: `apps/portal/src/app/check-in/admin/users/error.tsx`
- Test: `apps/portal/src/features/check-in/admin/__tests__/admin-user-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/admin/__tests__/admin-user-list.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminUserList } from '../admin-user-list';

const initial = [
  { uid: 'u1', email: 'admin1@cmt.org' },
  { uid: 'u2', email: 'admin2@cmt.org' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('AdminUserList', () => {
  it('renders every admin', () => {
    render(<AdminUserList users={initial} currentUid="u1" />);
    expect(screen.getByText(/admin1@cmt.org/)).toBeInTheDocument();
    expect(screen.getByText(/admin2@cmt.org/)).toBeInTheDocument();
  });

  it('disables delete on the current caller', () => {
    render(<AdminUserList users={initial} currentUid="u1" />);
    const buttons = screen.getAllByRole('button', { name: /delete/i });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });

  it('submits DELETE on non-self click', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<AdminUserList users={initial} currentUid="u1" />);
    const buttons = screen.getAllByRole('button', { name: /delete/i });
    await user.click(buttons[1]!);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/admin/users/u2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/admin/delete-admin-button.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  uid: string;
  disabled?: boolean;
  onDone?: () => void;
}

export function DeleteAdminButton({ uid, disabled, onDone }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        disabled={disabled || pending}
        onClick={() => {
          if (!confirm('Delete this admin?')) return;
          startTransition(async () => {
            setError(null);
            const res = await fetch(`/api/check-in/admin/users/${uid}`, { method: 'DELETE' });
            if (!res.ok) {
              setError('Delete failed');
              return;
            }
            onDone?.();
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && <span role="alert" className="ml-2 text-xs text-red-600">{error}</span>}
    </>
  );
}
```

Note: if `@cmt/ui` Button doesn't accept `variant="destructive"`, drop that prop and use className styling.

- [ ] **Step 4: Create `apps/portal/src/features/check-in/admin/admin-user-list.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { DeleteAdminButton } from './delete-admin-button';

interface AdminUser {
  uid: string;
  email: string;
}

interface Props {
  users: AdminUser[];
  currentUid: string;
}

export function AdminUserList({ users, currentUid }: Props) {
  const [list, setList] = useState(users);

  return (
    <ul className="flex flex-col gap-2">
      {list.map((u) => (
        <li
          key={u.uid}
          className="flex items-center justify-between rounded border border-[hsl(var(--border))] p-3"
        >
          <div>
            <div className="font-medium">{u.email}</div>
            <div className="text-xs text-[hsl(var(--foreground))]"><code>{u.uid}</code></div>
          </div>
          <DeleteAdminButton
            uid={u.uid}
            disabled={u.uid === currentUid}
            onDone={() => setList((prev) => prev.filter((x) => x.uid !== u.uid))}
          />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/admin/add-admin-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function AddAdminForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
    };
    startTransition(async () => {
      const res = await fetch('/api/check-in/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError('Failed to create admin');
        return;
      }
      setSuccess(`Admin ${payload.email} created. Refresh to see them in the list.`);
      form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-email">Email</Label>
        <Input id="add-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="add-password">Temporary password</Label>
        <Input id="add-password" name="password" type="password" minLength={8} required />
      </div>
      {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
      {success && <div role="status" className="text-sm text-emerald-700">{success}</div>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Add admin'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Create `apps/portal/src/app/check-in/admin/users/page.tsx`**

```tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { AdminUserList } from '@/features/check-in/admin/admin-user-list';
import { AddAdminForm } from '@/features/check-in/admin/add-admin-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Admin users — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  if (!flags.checkInAdmin) notFound();

  const h = await headers();
  const currentUid = h.get('x-portal-uid') ?? '';

  const result = await portalAuth().listUsers(1000);
  const users = result.users
    .filter((u) => (u.customClaims as { role?: string } | undefined)?.role === 'admin')
    .map((u) => ({ uid: u.uid, email: u.email ?? '' }));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Admin users</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Add admin</h2>
        <AddAdminForm />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Current admins</h2>
        <AdminUserList users={users} currentUid={currentUid} />
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function AdminUsersError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Admin users error" />;
}
```

- [ ] **Step 8: Update admin barrel**

```ts
export { AdminDashboard } from './admin-dashboard';
export { StatCard } from './stat-card';
export { AdminUserList } from './admin-user-list';
export { AddAdminForm } from './add-admin-form';
export { DeleteAdminButton } from './delete-admin-button';
```

- [ ] **Step 9: Run test — expect pass**

- [ ] **Step 10: Commit**

```sh
git add apps/portal/src/features/check-in/admin/admin-user-list.tsx apps/portal/src/features/check-in/admin/add-admin-form.tsx apps/portal/src/features/check-in/admin/delete-admin-button.tsx apps/portal/src/features/check-in/admin/index.ts apps/portal/src/app/check-in/admin/users/ apps/portal/src/features/check-in/admin/__tests__/admin-user-list.test.tsx
git commit -m "feat(portal): /check-in/admin/users page with list, add form, delete (self-delete disabled)"
```

---

## Task 6: `GET /api/check-in/admin/guests` — paginated guest list

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/guests/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/__tests__/guests.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/__tests__/guests.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeQuery = {
  orderBy: vi.fn().mockReturnThis(),
  startAfter: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
const fakeDoc = { get: vi.fn() };
const fakeCollection = {
  ...fakeQuery,
  doc: vi.fn(() => fakeDoc),
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import * as appHandler from '../../guests/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.get.mockReset();
  fakeDoc.get.mockReset();
});

describe('GET /api/check-in/admin/guests', () => {
  it('returns paginated guests', async () => {
    fakeQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'g1',
          data: () => ({
            firstName: 'Carol',
            lastName: 'Visitor',
            checkedInAt: '2026-04-13T14:00:00Z',
            numberOfAdults: 2,
            numberOfChildren: 1,
          }),
        },
      ],
    });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/admin/guests?limit=20',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.guests).toHaveLength(1);
        expect(body.guests[0].firstName).toBe('Carol');
      },
    });
  });

  it('honors cursor param', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: true });
    fakeQuery.get.mockResolvedValueOnce({ docs: [] });
    await testApiHandler({
      appHandler,
      url: '/api/check-in/admin/guests?cursor=g0&limit=20',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
      },
    });
    expect(fakeCollection.doc).toHaveBeenCalledWith('g0');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/guests/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;

  const coll = portalFirestore().collection('guest_check_ins');
  let query = coll.orderBy('checkedInAt', 'desc');

  if (cursor) {
    const cursorSnap = await coll.doc(cursor).get();
    if (cursorSnap.exists) {
      query = query.startAfter(cursorSnap);
    }
  }
  query = query.limit(limit);

  const snap = await query.get();
  const guests = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1]?.id : null;
  return NextResponse.json({ guests, nextCursor }, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/guests/ apps/portal/src/app/api/check-in/admin/__tests__/guests.test.ts
git commit -m "feat(portal): GET /api/check-in/admin/guests with cursor pagination"
```

---

## Task 7: Guest list page + component

**Files:**
- Create: `apps/portal/src/features/check-in/admin/guest-list.tsx`
- Create: `apps/portal/src/features/check-in/admin/cursor-pagination.tsx`
- Create: `apps/portal/src/app/check-in/admin/guests/page.tsx`
- Create: `apps/portal/src/app/check-in/admin/guests/error.tsx`
- Test: `apps/portal/src/features/check-in/admin/__tests__/guest-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/admin/__tests__/guest-list.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestList } from '../guest-list';

const guests = [
  {
    id: 'g1',
    firstName: 'Carol',
    lastName: 'Visitor',
    email: 'c@v.com',
    phone: '+16475550100',
    numberOfAdults: 2,
    numberOfChildren: 1,
    checkedInAt: '2026-04-13T14:00:00Z',
  },
];

describe('GuestList', () => {
  it('renders guests in a table', () => {
    render(<GuestList guests={guests} />);
    expect(screen.getByText(/carol/i)).toBeInTheDocument();
    expect(screen.getByText(/c@v.com/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });
  it('shows empty state', () => {
    render(<GuestList guests={[]} />);
    expect(screen.getByText(/no guests/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/admin/guest-list.tsx`**

```tsx
interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numberOfAdults: number;
  numberOfChildren: number;
  checkedInAt: string;
}

interface Props {
  guests: Guest[];
}

export function GuestList({ guests }: Props) {
  if (guests.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">No guests found.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">Name</th>
          <th className="p-2">Contact</th>
          <th className="p-2">Party</th>
          <th className="p-2">Checked in</th>
        </tr>
      </thead>
      <tbody>
        {guests.map((g) => (
          <tr key={g.id} className="border-b">
            <td className="p-2">
              {g.firstName} {g.lastName}
            </td>
            <td className="p-2">
              <div>{g.email ?? ''}</div>
              <div className="text-xs">{g.phone ?? ''}</div>
            </td>
            <td className="p-2">
              {g.numberOfAdults} adults, {g.numberOfChildren} children
            </td>
            <td className="p-2">{new Date(g.checkedInAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/admin/cursor-pagination.tsx`**

```tsx
import Link from 'next/link';

interface Props {
  basePath: string;
  currentCursor?: string;
  nextCursor: string | null;
}

export function CursorPagination({ basePath, nextCursor }: Props) {
  if (!nextCursor) return null;
  return (
    <div className="flex justify-end">
      <Link href={`${basePath}?cursor=${nextCursor}`} className="text-sm underline">
        Next page →
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/admin/guests/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { GuestList } from '@/features/check-in/admin/guest-list';
import { CursorPagination } from '@/features/check-in/admin/cursor-pagination';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Guests — CMT Portal' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function AdminGuestsPage({ searchParams }: Props) {
  if (!flags.checkInAdmin) notFound();
  const { cursor } = await searchParams;
  const limit = 20;

  const coll = portalFirestore().collection('guest_check_ins');
  let query = coll.orderBy('checkedInAt', 'desc');
  if (cursor) {
    const cursorSnap = await coll.doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  query = query.limit(limit);

  const snap = await query.get();
  const guests = snap.docs.map((d) => {
    const data = d.data() as {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      numberOfAdults: number;
      numberOfChildren: number;
      checkedInAt: string;
    };
    return { id: d.id, ...data };
  });
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1]?.id ?? null : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Guests</h1>
      <GuestList guests={guests} />
      <CursorPagination basePath="/check-in/admin/guests" nextCursor={nextCursor} />
    </main>
  );
}
```

- [ ] **Step 6: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function GuestsError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Admin guests error" />;
}
```

- [ ] **Step 7: Update admin barrel**

```ts
export { AdminDashboard } from './admin-dashboard';
export { StatCard } from './stat-card';
export { AdminUserList } from './admin-user-list';
export { AddAdminForm } from './add-admin-form';
export { DeleteAdminButton } from './delete-admin-button';
export { GuestList } from './guest-list';
export { CursorPagination } from './cursor-pagination';
```

- [ ] **Step 8: Run test — expect pass**

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/features/check-in/admin/guest-list.tsx apps/portal/src/features/check-in/admin/cursor-pagination.tsx apps/portal/src/features/check-in/admin/index.ts apps/portal/src/app/check-in/admin/guests/ apps/portal/src/features/check-in/admin/__tests__/guest-list.test.tsx
git commit -m "feat(portal): /check-in/admin/guests list + cursor pagination"
```

---

## Task 8: `GET /api/check-in/admin/unpaid` — unpaid family list

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/unpaid/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/__tests__/unpaid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/__tests__/unpaid.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import * as appHandler from '../../unpaid/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/admin/unpaid', () => {
  it('returns only families whose paymentStatus is not paid', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', name: 'A', paymentStatus: 'paid', contacts: [], students: [] },
      '2': { fid: '2', name: 'B', paymentStatus: 'unpaid', contacts: [], students: [] },
      '3': { fid: '3', name: 'C', paymentStatus: 'partial', contacts: [], students: [] },
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.families).toHaveLength(2);
        const fids = body.families.map((f: { fid: string }) => f.fid).sort();
        expect(fids).toEqual(['2', '3']);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/unpaid/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Family } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  const families = Object.values(all).filter((f) => f.paymentStatus !== 'paid');
  return NextResponse.json({ families }, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/unpaid/ apps/portal/src/app/api/check-in/admin/__tests__/unpaid.test.ts
git commit -m "feat(portal): GET /api/check-in/admin/unpaid — families with paymentStatus != paid"
```

---

## Task 9: Unpaid page + `UnpaidFamilyList` + `SendDonationEmailButton`

**Files:**
- Create: `apps/portal/src/features/check-in/admin/unpaid-family-list.tsx`
- Create: `apps/portal/src/features/check-in/admin/send-donation-email-button.tsx`
- Create: `apps/portal/src/app/check-in/admin/unpaid/page.tsx`
- Create: `apps/portal/src/app/check-in/admin/unpaid/error.tsx`
- Test: `apps/portal/src/features/check-in/admin/__tests__/unpaid-family-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/admin/__tests__/unpaid-family-list.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnpaidFamilyList } from '../unpaid-family-list';
import type { Family } from '@cmt/shared-domain/check-in';

const families: Family[] = [
  {
    fid: '1',
    name: 'Acme',
    paymentStatus: 'unpaid',
    contacts: [{ type: 'email', value: 'a@b.com' }],
    students: [],
  },
  {
    fid: '2',
    name: 'Bravo',
    paymentStatus: 'partial',
    contacts: [{ type: 'email', value: 'b@c.com' }],
    students: [],
  },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('UnpaidFamilyList', () => {
  it('renders one row per family', () => {
    render(<UnpaidFamilyList families={families} />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByText(/bravo/i)).toBeInTheDocument();
  });

  it('clicking Send donation email calls notifications API', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(<UnpaidFamilyList families={families} />);
    const buttons = screen.getAllByRole('button', { name: /send.*donation/i });
    await user.click(buttons[0]!);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/notifications/send-email',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.to).toBe('a@b.com');
    expect(body.template).toBe('donation-thank-you');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/admin/send-donation-email-button.tsx`**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  email: string;
  familyName: string;
}

export function SendDonationEmailButton({ email, familyName }: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  return (
    <>
      <Button
        type="button"
        disabled={pending || status === 'sent'}
        onClick={() =>
          startTransition(async () => {
            const res = await fetch('/api/check-in/notifications/send-email', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                to: email,
                template: 'donation-thank-you',
                props: { familyName },
              }),
            });
            setStatus(res.ok ? 'sent' : 'error');
          })
        }
      >
        {pending ? 'Sending…' : status === 'sent' ? 'Sent ✓' : 'Send donation email'}
      </Button>
      {status === 'error' && <span role="alert" className="ml-2 text-xs text-red-600">Failed</span>}
    </>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/admin/unpaid-family-list.tsx`**

```tsx
import type { Family } from '@cmt/shared-domain/check-in';
import { SendDonationEmailButton } from './send-donation-email-button';

interface Props {
  families: Family[];
}

export function UnpaidFamilyList({ families }: Props) {
  if (families.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">All families are paid up.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {families.map((f) => {
        const email = f.contacts.find((c) => c.type === 'email')?.value;
        return (
          <li
            key={f.fid}
            className="flex items-center justify-between rounded border border-[hsl(var(--border))] p-3"
          >
            <div>
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-[hsl(var(--foreground))]">
                Family ID <code>{f.fid}</code> · Status: {f.paymentStatus}
              </div>
            </div>
            {email && <SendDonationEmailButton email={email} familyName={f.name} />}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/admin/unpaid/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { UnpaidFamilyList } from '@/features/check-in/admin/unpaid-family-list';
import { flags } from '@/lib/flags';
import type { Family } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Unpaid families — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function AdminUnpaidPage() {
  if (!flags.checkInAdmin) notFound();
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  const families = Object.values(all).filter((f) => f.paymentStatus !== 'paid');

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Unpaid families</h1>
      <UnpaidFamilyList families={families} />
    </main>
  );
}
```

- [ ] **Step 6: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function UnpaidError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Unpaid families error" />;
}
```

- [ ] **Step 7: Update admin barrel**

```ts
export { AdminDashboard } from './admin-dashboard';
export { StatCard } from './stat-card';
export { AdminUserList } from './admin-user-list';
export { AddAdminForm } from './add-admin-form';
export { DeleteAdminButton } from './delete-admin-button';
export { GuestList } from './guest-list';
export { CursorPagination } from './cursor-pagination';
export { UnpaidFamilyList } from './unpaid-family-list';
export { SendDonationEmailButton } from './send-donation-email-button';
```

- [ ] **Step 8: Run test — expect pass**

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/features/check-in/admin/unpaid-family-list.tsx apps/portal/src/features/check-in/admin/send-donation-email-button.tsx apps/portal/src/features/check-in/admin/index.ts apps/portal/src/app/check-in/admin/unpaid/ apps/portal/src/features/check-in/admin/__tests__/unpaid-family-list.test.tsx
git commit -m "feat(portal): /check-in/admin/unpaid page with UnpaidFamilyList + donation-email button"
```

---

## Task 10: `POST /api/check-in/admin/reports/[kind]` — CSV streaming

**Files:**
- Create: `apps/portal/src/app/api/check-in/admin/reports/[kind]/route.ts`
- Test: `apps/portal/src/app/api/check-in/admin/__tests__/reports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/admin/__tests__/reports.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const makeSnap = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((d, i) => ({ id: `id-${i}`, data: () => d })),
});

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeQuery) })),
}));

import * as appHandler from '../../reports/[kind]/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeQuery.get.mockReset();
});

describe('POST /api/check-in/admin/reports/check-ins', () => {
  it('streams CSV with correct headers', async () => {
    fakeQuery.get.mockResolvedValueOnce(
      makeSnap([
        { fid: '1', sid: '2', status: 'present', checkedInBy: 'sevak', checkedInAt: '2026-04-13T14:00:00Z' },
      ]),
    );
    await testApiHandler({
      appHandler,
      params: { kind: 'check-ins' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/csv/);
        expect(res.headers.get('content-disposition')).toMatch(/check-ins.*\.csv/);
        const body = await res.text();
        expect(body).toContain('fid,sid,status,checkedInBy,checkedInAt');
      },
    });
  });

  it('returns 400 on unknown kind', async () => {
    await testApiHandler({
      appHandler,
      params: { kind: 'unknown' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(400);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/admin/reports/[kind]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'check-ins' | 'guests';

const SCHEMAS: Record<Kind, { collection: string; headers: string[]; orderBy: string }> = {
  'check-ins': {
    collection: 'check_in_events',
    headers: ['fid', 'sid', 'status', 'checkedInBy', 'checkedInAt'],
    orderBy: 'checkedInAt',
  },
  guests: {
    collection: 'guest_check_ins',
    headers: [
      'firstName',
      'lastName',
      'email',
      'phone',
      'numberOfAdults',
      'numberOfChildren',
      'checkedInAt',
    ],
    orderBy: 'checkedInAt',
  },
};

function escapeField(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const schema = SCHEMAS[kind as Kind];
  if (!schema) {
    return NextResponse.json({ error: 'unknown-kind' }, { status: 400 });
  }

  const snap = await portalFirestore()
    .collection(schema.collection)
    .orderBy(schema.orderBy, 'desc')
    .limit(10000)
    .get();

  const rows = snap.docs.map((d) => d.data() as Record<string, unknown>);
  const header = schema.headers.join(',');
  const body = rows
    .map((row) => schema.headers.map((h) => escapeField(row[h])).join(','))
    .join('\n');
  const csv = rows.length > 0 ? `${header}\n${body}` : header;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${kind}.csv"`,
    },
  });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/admin/reports/ apps/portal/src/app/api/check-in/admin/__tests__/reports.test.ts
git commit -m "feat(portal): POST /api/check-in/admin/reports/[kind] streams CSV for check-ins or guests"
```

---

## Task 11: Reports page + export button

**Files:**
- Create: `apps/portal/src/features/check-in/admin/report-export-button.tsx`
- Create: `apps/portal/src/app/check-in/admin/reports/page.tsx`
- Create: `apps/portal/src/app/check-in/admin/reports/error.tsx`

- [ ] **Step 1: Create `apps/portal/src/features/check-in/admin/report-export-button.tsx`**

```tsx
'use client';
import { useTransition } from 'react';
import { Button } from '@cmt/ui';

interface Props {
  kind: 'check-ins' | 'guests';
  label: string;
}

export function ReportExportButton({ kind, label }: Props) {
  const [pending, startTransition] = useTransition();

  async function onClick() {
    startTransition(async () => {
      const res = await fetch(`/api/check-in/admin/reports/${kind}`, { method: 'POST' });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button type="button" onClick={onClick} disabled={pending}>
      {pending ? 'Exporting…' : label}
    </Button>
  );
}
```

- [ ] **Step 2: Create `apps/portal/src/app/check-in/admin/reports/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { ReportExportButton } from '@/features/check-in/admin/report-export-button';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Reports — CMT Portal' };

export default function AdminReportsPage() {
  if (!flags.checkInAdmin) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Reports</h1>
      <div className="flex flex-wrap gap-3">
        <ReportExportButton kind="check-ins" label="Export check-ins CSV" />
        <ReportExportButton kind="guests" label="Export guests CSV" />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create `error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function ReportsError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Reports error" />;
}
```

- [ ] **Step 4: Update barrel**

```ts
// Append to apps/portal/src/features/check-in/admin/index.ts
export { ReportExportButton } from './report-export-button';
```

- [ ] **Step 5: Typecheck**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/admin/report-export-button.tsx apps/portal/src/features/check-in/admin/index.ts apps/portal/src/app/check-in/admin/reports/
git commit -m "feat(portal): /check-in/admin/reports page with CSV export buttons"
```

---

## Task 12: Playwright `e2e/b4-admin.spec.ts`

**Files:**
- Create: `apps/portal/e2e/b4-admin.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/portal/e2e/b4-admin.spec.ts
import { test, expect } from './fixtures';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signInAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login/admin');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/check-in/admin');
}

test.describe('B4 — admin dashboard', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set',
  );

  test('admin dashboard shows stat cards', async ({ page }) => {
    await signInAsAdmin(page);
    await expect(page.getByText(/check-ins today/i)).toBeVisible();
    await expect(page.getByText(/this week/i)).toBeVisible();
    await expect(page.getByText(/guests today/i)).toBeVisible();
    await expect(page.getByText(/unpaid/i)).toBeVisible();
  });

  test('admin users page renders list and form', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /users/i }).click();
    await expect(page).toHaveURL('/check-in/admin/users');
    await expect(page.getByRole('heading', { name: /admin users/i })).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
  });

  test('guests page renders', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /guests/i }).click();
    await expect(page).toHaveURL('/check-in/admin/guests');
  });

  test('reports page renders with export buttons', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('link', { name: /reports/i }).click();
    await expect(page).toHaveURL('/check-in/admin/reports');
    await expect(page.getByRole('button', { name: /check-ins csv/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Lint**

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b4-admin.spec.ts
git commit -m "test(portal): add b4-admin.spec.ts covering dashboard, users, guests, reports pages"
```

---

## Task 13: Docs + final pre-push + push

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update README slice-B progress tracker**

```markdown
- **Slice B** — 🚧 In progress —
  - B0 ✅ — Portal auth foundation
  - B2 ✅ — Family portal
  - B3 ✅ — Teacher portal
  - B1 ✅ — Kiosk 1:1 port
  - B4 ✅ — Admin dashboard + user provisioning
  - B5 — Notifications & cron (last)
```

- [ ] **Step 2: Update CLAUDE.md "Slice B status"**

```markdown
**Slice B status:** In progress. B0 + B2 + B3 + B1 + B4 shipped. B5 (notifications & cron) is the final sub-slice.
```

- [ ] **Step 3: Full pre-push**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 4: Commit docs**

```sh
git add README.md CLAUDE.md
git commit -m "docs: mark B4 admin dashboard shipped in slice-B tracker"
```

- [ ] **Step 5: Push**

```sh
git push origin main
```

B4 is shipped. Next: B5 notifications & cron.

---

## B4 acceptance gate summary

| # | Criterion | Verified by |
|---|---|---|
| B4-AC-1 | GET admin/users returns only role=admin | Task 3 test |
| B4-AC-2 | POST admin/users creates user with admin claim | Task 3 test |
| B4-AC-3 | DELETE on own uid returns 400 | Task 4 test |
| B4-AC-4 | DELETE on another admin clears claims + disables | Task 4 test |
| B4-AC-5 | `/check-in/admin` shows today's count from Firestore | Task 2 |
| B4-AC-6 | `/check-in/admin/guests` paginates via cursor | Task 6/7 |
| B4-AC-7 | `reports/check-ins.csv` returns CSV with correct headers | Task 10 test |
| B4-AC-8 | Playwright b4-admin green | Task 12 |
| B4-AC-9 | Self-delete unit test | Task 4 |
| B4-AC-10 | ≥80% coverage under `features/check-in/admin/` | Soft |
| B4-AC-11 | No `xlsx` in client bundle | Bundle audit (B1 Task 11 pattern) |
| B4-AC-12 | `NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN` flag gate on all routes | Tasks 2/5/7/9/11 |
| B4-AC-13 | Typecheck + lint + test + build green | Task 13 |

On green: B4 shipped. Next plan: B5 notifications & cron.

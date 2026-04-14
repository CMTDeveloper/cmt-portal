# Slice B1 — Kiosk 1:1 Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the physical ashram kiosk flows from the standalone `chinmaya-family-check-in` app into the portal as **public** routes under `/check-in/*`: `/check-in` (family ID lookup + student roster + check-in), `/check-in/guest` (new visitor guest check-in), `/check-in/lookup` (phone/email → family ID lookup). All three routes are feature-flagged OFF in production (`NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false`) because the standalone app continues to serve the physical terminal — the portal kiosk is dark-launched until an explicit cutover decision.

**Architecture:** Kiosk routes are fully public (no auth). They live under `features/check-in/kiosk/*` and reuse the shared `family-lookup` helper from B2. Check-in writes go to Firestore with `checkedInBy: 'sevak'` (the kiosk operator's role, not to be confused with admin). Guest check-ins create anonymous guest records. No `react-datepicker`, no `react-hot-toast`, no `react-phone-number-input`, no `xlsx`, no `redis`, no `headlessui`, and no webpack fallbacks for Node modules — this slice audits and eliminates all of them from any code it ports.

**Tech Stack:** Builds on B0 middleware (which allows the kiosk routes through the public-route whitelist), B2's `@cmt/shared-domain/check-in/*` types, and B2's `features/check-in/shared/*` modules. Uses `@cmt/ui` shadcn primitives for forms and toasts. The notification layer calls B2's `mockSender` for "check-in successful" side effects — real SES/SNS arrives in B5.

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` §12 (B1 detail)

**Predecessor plans:** B0, B2, B3.

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisites:** B0 + B2 + B3 shipped. Verify:

```sh
test -f apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts && \
test -f apps/portal/src/features/check-in/shared/notifications/mock-sender.ts && \
grep -q "/check-in" packages/shared-domain/src/auth/public-routes.ts && \
echo "OK" || echo "MISSING prerequisite"
```

**Feature flag:** Keep `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false` in `.env.local` during development until the final task (where it flips to `true` locally). **In the Vercel production environment, it stays `false`** — the kiosk is dark-launched in prod until a cutover decision.

**Standalone app source:** `/Users/dineshmatta/projects/chinmaya-family-check-in` — reference only. Do not modify.

---

## File structure overview

```
apps/portal/src/features/check-in/kiosk/
  kiosk-home.tsx                                            [Task 3]
  family-id-lookup-form.tsx                                 [Task 3]
  kiosk-check-in-panel.tsx                                  [Task 5]
  guest-check-in-form.tsx                                   [Task 7]
  family-lookup-form.tsx                                    [Task 9]
  index.ts                                                  [Task 3, MODIFIED]
  __tests__/
    family-id-lookup-form.test.tsx                          [Task 3]
    kiosk-check-in-panel.test.tsx                           [Task 5]
    guest-check-in-form.test.tsx                            [Task 7]
    family-lookup-form.test.tsx                             [Task 9]

apps/portal/src/features/check-in/shared/firestore/
  guest-check-ins.ts                                        [Task 6]
  __tests__/guest-check-ins.test.ts                         [Task 6]

apps/portal/src/app/
  check-in/
    page.tsx                                                [Task 4, REPLACES B0 stub]
    guest/
      page.tsx                                              [Task 8]
      error.tsx                                             [Task 8]
    lookup/
      page.tsx                                              [Task 10]
      error.tsx                                             [Task 10]
  api/check-in/
    families/[familyId]/
      route.ts                                              [Task 1]
      check-in/route.ts                                     [Task 4]
      __tests__/
        families.test.ts                                    [Task 1]
        families-check-in.test.ts                           [Task 4]
    lookup/route.ts                                         [Task 9]
    guests/route.ts                                         [Task 6]

apps/portal/e2e/b1-kiosk.spec.ts                            [Task 12]
README.md                                                    [Task 13]
CLAUDE.md                                                    [Task 13]
```

**Task count:** 13. **Final task pushes.**

---

## Task 1: `GET /api/check-in/families/:familyId` — public family read

**Files:**
- Create: `apps/portal/src/app/api/check-in/families/[familyId]/route.ts`
- Test: `apps/portal/src/app/api/check-in/families/[familyId]/__tests__/families.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/families/[familyId]/__tests__/families.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/families/:familyId', () => {
  it('returns 200 with family on hit', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [],
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.fid).toBe('42');
        expect(body.students).toHaveLength(1);
      },
    });
  });

  it('returns 404 when not found', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      params: { familyId: '999' },
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
pnpm --filter @cmt/portal test -- src/app/api/check-in/families/\[familyId\]/__tests__/families.test.ts
```

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/families/[familyId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { findFamilyById } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const { familyId } = await params;
  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }
  return NextResponse.json(family, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/families/
git commit -m "feat(portal): public GET /api/check-in/families/:familyId for kiosk lookup"
```

---

## Task 2: `POST /api/check-in/families/:familyId/check-in` — kiosk check-in write

**Files:**
- Create: `apps/portal/src/app/api/check-in/families/[familyId]/check-in/route.ts`
- Test: `apps/portal/src/app/api/check-in/families/[familyId]/__tests__/families-check-in.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/families/[familyId]/__tests__/families-check-in.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeCollection = { add: vi.fn() };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
  mockSender: { sendEmail: vi.fn(), sendSMS: vi.fn() },
}));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../check-in/route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue({ id: 'ci-new' });
});

describe('POST /api/check-in/families/:familyId/check-in', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 404 when family does not exist', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      params: { familyId: '999' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('writes one event per student with checkedInBy=sevak', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'paid',
      students: [],
      contacts: [],
      name: 'Acme',
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true, '2': false, '3': true } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.checkInIds).toHaveLength(3);
      },
    });
    expect(fakeCollection.add).toHaveBeenCalledTimes(3);
    const firstCall = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.checkedInBy).toBe('sevak');
  });

  it('does not send payment reminder for paid families', async () => {
    const { mockSender } = await import('@/features/check-in/shared');
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'paid',
      name: 'Acme',
      students: [],
      contacts: [{ type: 'email', value: 'a@b.com' }],
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('sends payment reminder for unpaid families with email contact', async () => {
    const { mockSender } = await import('@/features/check-in/shared');
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'unpaid',
      name: 'Acme',
      students: [],
      contacts: [{ type: 'email', value: 'a@b.com' }],
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    expect(mockSender.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com' }),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/families/[familyId]/check-in/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById, mockSender } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  students: z.record(z.string(), z.boolean()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const { familyId } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const coll = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();
  const checkInIds: string[] = [];

  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const ref = await coll.add({
      fid: familyId,
      sid,
      status: isPresent ? 'present' : 'absent',
      checkedInBy: 'sevak' as const,
      checkedInAt,
    });
    checkInIds.push(ref.id);
  }

  // Unpaid families receive a reminder (mock in B1, real AWS in B5)
  if (family.paymentStatus !== 'paid') {
    const email = family.contacts.find((c) => c.type === 'email')?.value;
    if (email) {
      await mockSender.sendEmail({
        to: email,
        subject: 'Payment reminder — Chinmaya Mission Toronto',
        text: `Hari OM ${family.name}, your family check-in was recorded. Please see a sevak to settle your outstanding payment.`,
      });
    }
  }

  return NextResponse.json({ success: true, checkInIds }, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/families/
git commit -m "feat(portal): public POST kiosk check-in route with unpaid-family reminder mock"
```

---

## Task 3: `KioskHome` + `FamilyIdLookupForm` components

The landing flow: enter family ID → fetch family → display student roster.

**Files:**
- Create: `apps/portal/src/features/check-in/kiosk/kiosk-home.tsx`
- Create: `apps/portal/src/features/check-in/kiosk/family-id-lookup-form.tsx`
- Create: `apps/portal/src/features/check-in/kiosk/index.ts`
- Test: `apps/portal/src/features/check-in/kiosk/__tests__/family-id-lookup-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/kiosk/__tests__/family-id-lookup-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyIdLookupForm } from '../family-id-lookup-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('FamilyIdLookupForm', () => {
  it('renders a family-id input and submit button', () => {
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    expect(screen.getByLabelText(/family id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /find/i })).toBeInTheDocument();
  });

  it('calls GET /api/check-in/families/:familyId on submit', async () => {
    const user = userEvent.setup();
    const onFamily = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fid: '42', name: 'Acme', paymentStatus: 'paid', contacts: [], students: [] }),
    } as Response);

    render(<FamilyIdLookupForm onFamily={onFamily} />);
    await user.type(screen.getByLabelText(/family id/i), '42');
    await user.click(screen.getByRole('button', { name: /find/i }));

    expect(global.fetch).toHaveBeenCalledWith('/api/check-in/families/42');
    expect(onFamily).toHaveBeenCalledWith(expect.objectContaining({ fid: '42' }));
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'family-not-found' }),
    } as Response);
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    await user.type(screen.getByLabelText(/family id/i), '999');
    await user.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });

  it('rejects non-numeric input', async () => {
    const user = userEvent.setup();
    render(<FamilyIdLookupForm onFamily={() => {}} />);
    await user.type(screen.getByLabelText(/family id/i), 'abc');
    await user.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid number/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/kiosk/family-id-lookup-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  onFamily: (family: Family) => void;
}

export function FamilyIdLookupForm({ onFamily }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^\d+$/.test(value)) {
      setError('Please enter a valid number.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/check-in/families/${value}`);
      if (res.status === 404) {
        setError('No family found for this ID.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong. Try again.');
        return;
      }
      const family = (await res.json()) as Family;
      onFamily(family);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="family-id">Family ID</Label>
        <Input
          id="family-id"
          type="text"
          inputMode="numeric"
          pattern="\d*"
          autoFocus
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Finding…' : 'Find family'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/kiosk/kiosk-home.tsx`**

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Family } from '@cmt/shared-domain/check-in';
import { FamilyIdLookupForm } from './family-id-lookup-form';
import { KioskCheckInPanel } from './kiosk-check-in-panel';

export function KioskHome() {
  const [family, setFamily] = useState<Family | null>(null);

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section className="flex flex-col items-center justify-center gap-6 bg-[hsl(var(--primary))] p-8 text-white">
        <h1 className="text-4xl font-bold">Family check-in</h1>
        <div className="w-full max-w-sm rounded-lg bg-white p-6 text-[hsl(var(--foreground))]">
          <FamilyIdLookupForm onFamily={setFamily} />
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/check-in/guest" className="underline">
            New visitor? Guest check-in
          </Link>
          <Link href="/check-in/lookup" className="underline">
            Forgot your family ID?
          </Link>
        </nav>
      </section>
      <section className="flex flex-col items-center justify-center bg-white p-8">
        {family ? (
          <KioskCheckInPanel family={family} onDone={() => setFamily(null)} />
        ) : (
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-semibold text-[hsl(var(--heading))]">
              Welcome to Chinmaya Mission Toronto
            </h2>
            <p className="mt-4 text-[hsl(var(--foreground))]">
              Enter your family ID on the left to check in.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/kiosk/index.ts`**

```ts
export { KioskHome } from './kiosk-home';
export { FamilyIdLookupForm } from './family-id-lookup-form';
export { KioskCheckInPanel } from './kiosk-check-in-panel';
```

Note: `KioskCheckInPanel` is created in Task 5.

- [ ] **Step 6: Run test — expect pass** (for `family-id-lookup-form.test.tsx` specifically; `kiosk-home.tsx` won't compile yet because it imports a module that doesn't exist — see next task)

Skip running the full test now; Task 4 wires the page, Task 5 creates `KioskCheckInPanel`. Commit this task and move on.

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/check-in/kiosk/family-id-lookup-form.tsx apps/portal/src/features/check-in/kiosk/__tests__/family-id-lookup-form.test.tsx
git commit -m "feat(portal): FamilyIdLookupForm component with GET /api/check-in/families/:familyId"
```

---

## Task 4: `/check-in` page (replaces the slice A ComingSoon stub)

**Files:**
- Modify: `apps/portal/src/app/check-in/page.tsx`
- Test: existing (from slice A) may need adjustment

- [ ] **Step 1: Replace `apps/portal/src/app/check-in/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { KioskHome } from '@/features/check-in/kiosk';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Check in — CMT Portal' };
export const dynamic = 'force-dynamic';

export default function CheckInKioskPage() {
  if (!flags.checkInKiosk) notFound();
  return <KioskHome />;
}
```

- [ ] **Step 2: Update the existing `apps/portal/src/app/check-in/__tests__/page.test.ts` (if it tested the ComingSoon stub)**

Replace with a flag-off smoke test:

```ts
// apps/portal/src/app/check-in/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
});

describe('/check-in page flag gate', () => {
  it('calls notFound when flag is off', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'true';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK = 'false';
    const notFound = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    vi.doMock('next/navigation', () => ({ notFound }));
    const { default: Page } = await import('../page');
    expect(() => render(<Page />)).toThrow(/NEXT_NOT_FOUND/);
    expect(notFound).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/app/check-in/__tests__/page.test.tsx
```

- [ ] **Step 4: Commit**

```sh
git add apps/portal/src/app/check-in/page.tsx apps/portal/src/app/check-in/__tests__/
git commit -m "feat(portal): replace /check-in ComingSoon stub with flag-gated KioskHome"
```

---

## Task 5: `KioskCheckInPanel` — student roster + submit

**Files:**
- Create: `apps/portal/src/features/check-in/kiosk/kiosk-check-in-panel.tsx`
- Test: `apps/portal/src/features/check-in/kiosk/__tests__/kiosk-check-in-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/kiosk/__tests__/kiosk-check-in-panel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KioskCheckInPanel } from '../kiosk-check-in-panel';
import type { Family } from '@cmt/shared-domain/check-in';

const family: Family = {
  fid: '42',
  name: 'Acme',
  paymentStatus: 'paid',
  contacts: [],
  students: [
    { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
    { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('KioskCheckInPanel', () => {
  it('renders the family name and student rows', () => {
    render(<KioskCheckInPanel family={family} onDone={() => {}} />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  it('defaults all students to checked', () => {
    render(<KioskCheckInPanel family={family} onDone={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).toBeChecked();
  });

  it('submits students map to POST endpoint', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, checkInIds: ['a', 'b'] }),
    } as Response);

    render(<KioskCheckInPanel family={family} onDone={onDone} />);
    await user.click(screen.getAllByRole('checkbox')[1]!);  // Uncheck Bob
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/families/42/check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ students: { '1': true, '2': false } }),
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('shows an error on server failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<KioskCheckInPanel family={family} onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/kiosk/kiosk-check-in-panel.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Family } from '@cmt/shared-domain/check-in';

interface Props {
  family: Family;
  onDone: () => void;
}

export function KioskCheckInPanel({ family, onDone }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(family.students.map((s) => [s.sid, true])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(sid: string) {
    setSelected((prev) => ({ ...prev, [sid]: !prev[sid] }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/check-in/families/${family.fid}/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ students: selected }),
      });
      if (!res.ok) {
        setError('Check-in failed. Please try again.');
        return;
      }
      onDone();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-[hsl(var(--border))] p-6"
    >
      <header>
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">{family.name}</h2>
        <p className="text-sm text-[hsl(var(--foreground))]">
          Family ID: <code>{family.fid}</code>
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {family.students.map((s) => (
          <li
            key={s.sid}
            className="flex items-center gap-3 rounded border border-[hsl(var(--border))] p-3"
          >
            <input
              id={`k-${s.sid}`}
              type="checkbox"
              checked={selected[s.sid] ?? false}
              onChange={() => toggle(s.sid)}
              className="h-5 w-5"
            />
            <label htmlFor={`k-${s.sid}`} className="flex-1">
              <div className="font-medium">
                {s.firstName} {s.lastName}
              </div>
              <div className="text-sm text-[hsl(var(--foreground))]">{s.level}</div>
            </label>
          </li>
        ))}
      </ul>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking in…' : 'Check in family'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/kiosk/__tests__/
```

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/kiosk/kiosk-check-in-panel.tsx apps/portal/src/features/check-in/kiosk/kiosk-home.tsx apps/portal/src/features/check-in/kiosk/index.ts apps/portal/src/features/check-in/kiosk/__tests__/kiosk-check-in-panel.test.tsx
git commit -m "feat(portal): KioskCheckInPanel + KioskHome composing family lookup and check-in flow"
```

---

## Task 6: Guest check-ins Firestore helper + `POST /api/check-in/guests`

**Files:**
- Create: `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts`
- Create: `apps/portal/src/app/api/check-in/guests/route.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/guest-check-ins.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/guest-check-ins.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeCollection = { add: vi.fn() };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import { recordGuestCheckIn } from '../firestore/guest-check-ins';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue({ id: 'g-1' });
});

describe('recordGuestCheckIn', () => {
  it('writes to guest_check_ins with provided fields and timestamp', async () => {
    const id = await recordGuestCheckIn({
      firstName: 'Carol',
      lastName: 'Visitor',
      email: 'c@v.com',
      phone: '+16475550100',
      numberOfAdults: 2,
      numberOfChildren: 1,
    });
    expect(id).toBe('g-1');
    const written = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(written.firstName).toBe('Carol');
    expect(written.numberOfAdults).toBe(2);
    expect(written.checkedInAt).toMatch(/T/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts`**

```ts
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export interface GuestCheckInInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numberOfAdults: number;
  numberOfChildren: number;
  notes?: string;
}

export async function recordGuestCheckIn(input: GuestCheckInInput): Promise<string> {
  const ref = await portalFirestore().collection('guest_check_ins').add({
    ...input,
    checkedInAt: new Date().toISOString(),
  });
  return ref.id;
}
```

- [ ] **Step 4: Add to shared barrel**

```ts
// apps/portal/src/features/check-in/shared/index.ts — append
export * from './firestore/guest-check-ins';
```

- [ ] **Step 5: Create `apps/portal/src/app/api/check-in/guests/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordGuestCheckIn } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  numberOfAdults: z.coerce.number().int().min(0),
  numberOfChildren: z.coerce.number().int().min(0),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const id = await recordGuestCheckIn(parsed.data);
  return NextResponse.json({ success: true, id }, { status: 200 });
}
```

- [ ] **Step 6: Run test — expect pass**

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/check-in/shared/firestore/guest-check-ins.ts apps/portal/src/features/check-in/shared/index.ts apps/portal/src/app/api/check-in/guests/route.ts apps/portal/src/features/check-in/shared/__tests__/guest-check-ins.test.ts
git commit -m "feat(portal): guest check-in Firestore helper + public POST /api/check-in/guests"
```

---

## Task 7: `GuestCheckInForm` component

**Files:**
- Create: `apps/portal/src/features/check-in/kiosk/guest-check-in-form.tsx`
- Test: `apps/portal/src/features/check-in/kiosk/__tests__/guest-check-in-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/kiosk/__tests__/guest-check-in-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestCheckInForm } from '../guest-check-in-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('GuestCheckInForm', () => {
  it('renders required fields', () => {
    render(<GuestCheckInForm />);
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/adults/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/children/i)).toBeInTheDocument();
  });

  it('submits to POST /api/check-in/guests', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-1' }),
    } as Response);

    render(<GuestCheckInForm />);
    await user.type(screen.getByLabelText(/first name/i), 'Carol');
    await user.type(screen.getByLabelText(/last name/i), 'Visitor');
    await user.type(screen.getByLabelText(/email/i), 'c@v.com');
    await user.clear(screen.getByLabelText(/adults/i));
    await user.type(screen.getByLabelText(/adults/i), '2');
    await user.clear(screen.getByLabelText(/children/i));
    await user.type(screen.getByLabelText(/children/i), '1');
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/guests',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.firstName).toBe('Carol');
    expect(body.numberOfAdults).toBe(2);
  });

  it('shows success message after submit', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, id: 'g-1' }),
    } as Response);
    render(<GuestCheckInForm />);
    await user.type(screen.getByLabelText(/first name/i), 'Carol');
    await user.type(screen.getByLabelText(/last name/i), 'Visitor');
    await user.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByText(/thank you/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/kiosk/guest-check-in-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

export function GuestCheckInForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      firstName: String(data.get('firstName') ?? '').trim(),
      lastName: String(data.get('lastName') ?? '').trim(),
      email: String(data.get('email') ?? '').trim() || undefined,
      phone: String(data.get('phone') ?? '').trim() || undefined,
      numberOfAdults: Number(data.get('adults') ?? 1),
      numberOfChildren: Number(data.get('children') ?? 0),
      notes: String(data.get('notes') ?? '').trim() || undefined,
    };
    startTransition(async () => {
      const res = await fetch('/api/check-in/guests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError('Check-in failed. Try again.');
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Thank you!</h2>
        <p className="mt-2 text-[hsl(var(--foreground))]">Your guest check-in has been recorded.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Guest check-in</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="adults">Adults</Label>
          <Input id="adults" name="adults" type="number" min="0" defaultValue="1" required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="children">Children</Label>
          <Input id="children" name="children" type="number" min="0" defaultValue="0" required />
        </div>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking in…' : 'Check in as guest'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run test — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/kiosk/guest-check-in-form.tsx apps/portal/src/features/check-in/kiosk/__tests__/guest-check-in-form.test.tsx
git commit -m "feat(portal): GuestCheckInForm with first/last/email/phone/counts and success state"
```

---

## Task 8: `/check-in/guest` page

**Files:**
- Create: `apps/portal/src/app/check-in/guest/page.tsx`
- Create: `apps/portal/src/app/check-in/guest/error.tsx`

- [ ] **Step 1: Create `apps/portal/src/app/check-in/guest/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { GuestCheckInForm } from '@/features/check-in/kiosk/guest-check-in-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Guest check-in — CMT Portal' };

export default function GuestCheckInPage() {
  if (!flags.checkInKiosk) notFound();
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))] p-6">
      <div className="mx-auto max-w-md">
        <GuestCheckInForm />
        <div className="mt-6 text-center">
          <Link href="/check-in" className="text-sm underline">
            ← Back to family check-in
          </Link>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create `apps/portal/src/app/check-in/guest/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function GuestError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Guest check-in error" />;
}
```

- [ ] **Step 3: Typecheck**

```sh
pnpm --filter @cmt/portal typecheck
```

- [ ] **Step 4: Commit**

```sh
git add apps/portal/src/app/check-in/guest/
git commit -m "feat(portal): /check-in/guest page flag-gated behind checkInKiosk"
```

---

## Task 9: `FamilyLookupForm` + `POST /api/check-in/lookup`

**Files:**
- Create: `apps/portal/src/features/check-in/kiosk/family-lookup-form.tsx`
- Create: `apps/portal/src/app/api/check-in/lookup/route.ts`
- Test: `apps/portal/src/features/check-in/kiosk/__tests__/family-lookup-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/kiosk/__tests__/family-lookup-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyLookupForm } from '../family-lookup-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

describe('FamilyLookupForm', () => {
  it('renders email/phone tabs and contact input', () => {
    render(<FamilyLookupForm />);
    expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /phone/i })).toBeInTheDocument();
  });

  it('submits email → /api/check-in/lookup and shows family ID on success', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ familyId: '42' }),
    } as Response);

    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/lookup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
      }),
    );
    expect(await screen.findByText(/42/)).toBeInTheDocument();
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not-found' }),
    } as Response);
    render(<FamilyLookupForm />);
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /look up/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/kiosk/family-lookup-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';

type ContactType = 'email' | 'phone';

export function FamilyLookupForm() {
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFamilyId(null);
    startTransition(async () => {
      const res = await fetch('/api/check-in/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
      if (res.status === 404) {
        setError('No family found for this contact.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong. Try again.');
        return;
      }
      const body = (await res.json()) as { familyId: string };
      setFamilyId(body.familyId);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-2xl font-bold text-[hsl(var(--heading))]">Find your family ID</h2>

      <div role="tablist" className="flex gap-2 border-b pb-2">
        <button
          role="tab"
          type="button"
          aria-selected={type === 'email'}
          onClick={() => setType('email')}
          className={`rounded px-3 py-1 text-sm ${type === 'email' ? 'bg-[hsl(var(--primary))] text-white' : ''}`}
        >
          Email
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={type === 'phone'}
          onClick={() => setType('phone')}
          className={`rounded px-3 py-1 text-sm ${type === 'phone' ? 'bg-[hsl(var(--primary))] text-white' : ''}`}
        >
          Phone
        </button>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact">{type === 'email' ? 'Email' : 'Phone'}</Label>
          <Input
            id="contact"
            aria-label={type === 'email' ? 'Email' : 'Phone'}
            type={type === 'email' ? 'email' : 'tel'}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {error && (
          <div role="alert" className="text-sm text-red-600">
            {error}
          </div>
        )}
        {familyId && (
          <div className="rounded border-l-4 border-emerald-500 bg-emerald-50 p-3 text-emerald-900">
            Your family ID is <strong>{familyId}</strong>
          </div>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Looking up…' : 'Look up'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/api/check-in/lookup/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findFamilyByContact } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json({ familyId: family.fid }, { status: 200 });
}
```

- [ ] **Step 5: Run test — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/kiosk/family-lookup-form.tsx apps/portal/src/app/api/check-in/lookup/route.ts apps/portal/src/features/check-in/kiosk/__tests__/family-lookup-form.test.tsx
git commit -m "feat(portal): FamilyLookupForm + POST /api/check-in/lookup (public, RTDB scan)"
```

---

## Task 10: `/check-in/lookup` page

**Files:**
- Create: `apps/portal/src/app/check-in/lookup/page.tsx`
- Create: `apps/portal/src/app/check-in/lookup/error.tsx`

- [ ] **Step 1: Create the page + error boundary**

```tsx
// page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FamilyLookupForm } from '@/features/check-in/kiosk/family-lookup-form';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Find your family ID — CMT Portal' };

export default function LookupPage() {
  if (!flags.checkInKiosk) notFound();
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))] p-6">
      <div className="mx-auto max-w-md">
        <FamilyLookupForm />
        <div className="mt-6 text-center">
          <Link href="/check-in" className="text-sm underline">
            ← Back to family check-in
          </Link>
        </div>
      </div>
    </main>
  );
}
```

```tsx
// error.tsx
'use client';
import { ErrorFallback } from '@cmt/ui';
export default function LookupError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Lookup error" />;
}
```

- [ ] **Step 2: Update kiosk barrel**

```ts
// apps/portal/src/features/check-in/kiosk/index.ts
export { KioskHome } from './kiosk-home';
export { FamilyIdLookupForm } from './family-id-lookup-form';
export { KioskCheckInPanel } from './kiosk-check-in-panel';
export { GuestCheckInForm } from './guest-check-in-form';
export { FamilyLookupForm } from './family-lookup-form';
```

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```sh
git add apps/portal/src/app/check-in/lookup/ apps/portal/src/features/check-in/kiosk/index.ts
git commit -m "feat(portal): /check-in/lookup page flag-gated behind checkInKiosk"
```

---

## Task 11: Audit client bundle for forbidden deps

**Files:** none — verification step.

- [ ] **Step 1: Grep for forbidden imports**

```sh
for pkg in xlsx react-datepicker react-phone-number-input headlessui redis react-hot-toast; do
  echo "=== $pkg ==="
  grep -rn "from '$pkg" apps/portal/src/ || echo "  (none)"
done
```

Expected: no matches under `apps/portal/src/`. If any found in new code, remove or move to server-only.

- [ ] **Step 2: Grep for webpack fallback patterns**

```sh
grep -n 'webpack\|asyncWebAssembly\|fallback' apps/portal/next.config.ts 2>/dev/null || echo "next.config clean"
```

Expected: no webpack customization in next.config.

- [ ] **Step 3: Verify the kiosk bundle size**

```sh
pnpm --filter @cmt/portal build
```

Expected: build succeeds, output summary shows `/check-in` route build without warnings about large chunks.

- [ ] **Step 4: If anything fails, fix before moving to e2e (no commit for this audit)**

---

## Task 12: Playwright `e2e/b1-kiosk.spec.ts`

**Files:**
- Create: `apps/portal/e2e/b1-kiosk.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/portal/e2e/b1-kiosk.spec.ts
import { test, expect } from './fixtures';

test.describe('B1 — kiosk', () => {
  test('/check-in is 404 when feature flag is off', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK === 'true',
      'Kiosk flag is on; flag-off test skipped',
    );
    const res = await page.goto('/check-in');
    expect(res?.status()).toBe(404);
  });

  test('/check-in renders kiosk home when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; flag-on test skipped',
    );
    await page.goto('/check-in');
    await expect(page.getByLabel(/family id/i)).toBeVisible();
  });

  test('/check-in/guest renders guest form when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; skipped',
    );
    await page.goto('/check-in/guest');
    await expect(page.getByLabel(/first name/i)).toBeVisible();
  });

  test('/check-in/lookup renders lookup form when flag is on', async ({ page }) => {
    test.skip(
      process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK !== 'true',
      'Kiosk flag off; skipped',
    );
    await page.goto('/check-in/lookup');
    await expect(page.getByRole('tab', { name: /email/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Lint**

```sh
pnpm --filter @cmt/portal lint
```

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b1-kiosk.spec.ts
git commit -m "test(portal): add b1-kiosk.spec.ts with flag on/off variants"
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
  - B1 ✅ — Kiosk 1:1 port (dark-launched in prod)
  - B4 — Admin dashboard (next)
  - B5 — Notifications & cron
```

- [ ] **Step 2: Update CLAUDE.md "Slice B status"**

```markdown
**Slice B status:** In progress. B0 + B2 + B3 + B1 shipped. B4 (admin dashboard) is next.
Kiosk is dark-launched in production — standalone app still serves the physical kiosk.
```

- [ ] **Step 3: Flip `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true` in local `.env.local` ONLY (not in Vercel prod)**

- [ ] **Step 4: Full pre-push**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 5: Commit docs**

```sh
git add README.md CLAUDE.md
git commit -m "docs: mark B1 kiosk shipped (dark-launched in production)"
```

- [ ] **Step 6: Push**

```sh
git push origin main
```

B1 is shipped. Next: B4 admin dashboard.

---

## B1 acceptance gate summary

| # | Criterion | Verified by |
|---|---|---|
| B1-AC-1 | `/check-in` with valid family ID shows student roster | Task 3/5 tests + manual |
| B1-AC-2 | Invalid family ID shows clear error | Task 3 test |
| B1-AC-3 | Submit writes Firestore with `checkedInBy: 'sevak'` | Task 2 test |
| B1-AC-4 | `/check-in/guest` writes guest record | Task 6 + 7 tests |
| B1-AC-5 | `/check-in/lookup` returns family ID | Task 9 tests |
| B1-AC-6 | Playwright b1-kiosk green | Task 12 |
| B1-AC-7 | `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=false` returns 404 on all three pages | Task 12 + test |
| B1-AC-8 | Bundle clean of xlsx, headlessui, react-datepicker, react-phone-number-input, redis, react-hot-toast | Task 11 |
| B1-AC-9 | `next.config.ts` has no webpack fallback | Task 11 |
| B1-AC-10 | ≥80% coverage under `features/check-in/kiosk/` + `shared/` | Soft |
| B1-AC-11 | Typecheck + lint + test + build green | Task 13 |

On green: B1 shipped. Next plan: B4 admin dashboard.

# Slice B2 — Family Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the family self-service portal: passwordless OTP login (email or phone) via a mock sender (real AWS arrives in B5), a family dashboard that reads kids from master RTDB and check-in history from portal Firestore, and a family self-check-in page that writes check-in events with `checkedInBy: 'family'`. All endpoints support dual-mode auth (web cookie + mobile Bearer).

**Architecture:** The family login replaces B0's `FamilyLoginForm` scaffold with a two-step form: contact entry → OTP code entry. The server stores hashed verification codes in Firestore with a 10-minute TTL and rate-limits sends per-contact. Successful verification creates a Firebase user keyed on `sha256(normalizedContact)` so the same contact via email and phone converges to one user. The family dashboard renders server-side using headers-attached claims from the B0 middleware. Notifications call an in-process mock sender in B2 — B5 swaps the wiring to real AWS SES/SNS.

**Tech Stack:** Builds on B0's `@cmt/firebase-shared/admin/*` and `@cmt/shared-domain/auth/*`. Adds `@cmt/shared-domain/check-in/{family,check-in,api}` domain types. Shadcn primitives from `@cmt/ui`. No `headlessui`, no `react-phone-number-input` — native phone input + country-code dropdown.

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` §10 (B2 detail)

**Predecessor plan:** `docs/superpowers/plans/2026-04-13-slice-b0-portal-auth-foundation.md`

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisite:** B0 must be shipped on `main`. Verify:

```sh
test -f apps/portal/src/middleware.ts && \
test -f packages/firebase-shared/src/admin/session.ts && \
test -f packages/shared-domain/src/auth/can-access-route.ts && \
echo "B0 present" || echo "B0 MISSING — ship B0 first"
```

Expected: `B0 present`.

**Branch model:** solo-dev main-only (same as B0). Commit directly to `main`; final task pushes.

**Feature flag during execution:** Keep `NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY=false` in `.env.local` until Task 15. The flag flips on in the last task.

---

## File structure overview

```
chinmaya-mission-portal/
├── packages/shared-domain/src/
│   ├── check-in/
│   │   ├── family.ts                                       [Task 1]
│   │   ├── check-in.ts                                     [Task 1]
│   │   ├── api.ts                                          [Task 1]
│   │   └── index.ts                                        [Task 1]
│   ├── index.ts                                            [Task 1, MODIFIED]
│   └── __tests__/
│       ├── family-types.test.ts                            [Task 1]
│       └── check-in-api.test.ts                            [Task 1]
│
├── apps/portal/src/features/check-in/shared/
│   ├── rtdb/
│   │   └── family-lookup.ts                                [Task 2]
│   ├── firestore/
│   │   └── verification-codes.ts                           [Task 3]
│   ├── notifications/
│   │   └── mock-sender.ts                                  [Task 4]
│   ├── rate-limit/
│   │   └── otp-rate-limit.ts                               [Task 5]
│   ├── contact/
│   │   ├── normalize.ts                                    [Task 6]
│   │   └── hash.ts                                         [Task 6]
│   ├── index.ts                                            [Task 6]
│   └── __tests__/
│       ├── family-lookup.test.ts                           [Task 2]
│       ├── verification-codes.test.ts                      [Task 3]
│       ├── mock-sender.test.ts                             [Task 4]
│       ├── otp-rate-limit.test.ts                          [Task 5]
│       └── normalize.test.ts                               [Task 6]
│
├── apps/portal/src/features/check-in/family/
│   ├── family-login-form.tsx                               [Task 9, REPLACES B0 stub]
│   ├── otp-code-input.tsx                                  [Task 9]
│   ├── family-dashboard.tsx                                [Task 11]
│   ├── student-check-in-list.tsx                           [Task 13]
│   ├── payment-status-banner.tsx                           [Task 11]
│   ├── index.ts                                            [Task 9, MODIFIED each task]
│   └── __tests__/
│       ├── family-login-form.test.tsx                      [Task 9]
│       ├── family-dashboard.test.tsx                       [Task 11]
│       └── student-check-in-list.test.tsx                  [Task 13]
│
├── apps/portal/src/app/
│   ├── api/auth/family/
│   │   ├── send-code/route.ts                              [Task 7]
│   │   ├── verify-code/route.ts                            [Task 8]
│   │   └── __tests__/
│   │       ├── send-code.test.ts                           [Task 7]
│   │       └── verify-code.test.ts                         [Task 8]
│   ├── api/check-in/family/
│   │   ├── dashboard/route.ts                              [Task 12]
│   │   ├── self-check-in/route.ts                          [Task 14]
│   │   └── __tests__/
│   │       ├── dashboard.test.ts                           [Task 12]
│   │       └── self-check-in.test.ts                       [Task 14]
│   └── check-in/family/
│       ├── page.tsx                                        [Task 11]
│       ├── error.tsx                                       [Task 11]
│       ├── loading.tsx                                     [Task 11]
│       └── check-in/
│           ├── page.tsx                                    [Task 13]
│           └── error.tsx                                   [Task 13]
│
├── apps/portal/e2e/b2-family.spec.ts                       [Task 16]
├── README.md                                               [Task 17, MODIFIED]
├── CLAUDE.md                                               [Task 17, MODIFIED]
```

**Task count:** 17. **Final task pushes.**

---

## Task 1: Add `@cmt/shared-domain/check-in/*` domain types

Pure TypeScript types consumed by handlers and components. Zero runtime dependencies.

**Files:**
- Create: `packages/shared-domain/src/check-in/family.ts`
- Create: `packages/shared-domain/src/check-in/check-in.ts`
- Create: `packages/shared-domain/src/check-in/api.ts`
- Create: `packages/shared-domain/src/check-in/index.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Test: `packages/shared-domain/src/__tests__/family-types.test.ts`
- Test: `packages/shared-domain/src/__tests__/check-in-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-domain/src/__tests__/family-types.test.ts
import { describe, it, expect } from 'vitest';
import type { Family, Student, ContactInfo, PaymentStatus } from '../check-in/family';

describe('Family type', () => {
  it('accepts a valid family', () => {
    const family: Family = {
      fid: '42',
      name: 'Acme',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      paymentStatus: 'paid',
      students: [
        { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'Kindergarten' },
      ],
    };
    expect(family.fid).toBe('42');
    expect(family.students[0]?.sid).toBe('1');
  });

  it('PaymentStatus union covers paid, unpaid, partial', () => {
    const statuses: PaymentStatus[] = ['paid', 'unpaid', 'partial'];
    expect(statuses).toHaveLength(3);
  });

  it('ContactInfo discriminated union', () => {
    const email: ContactInfo = { type: 'email', value: 'a@b.com' };
    const phone: ContactInfo = { type: 'phone', value: '+16475550100' };
    expect(email.type).toBe('email');
    expect(phone.type).toBe('phone');
  });
});
```

```ts
// packages/shared-domain/src/__tests__/check-in-api.test.ts
import { describe, it, expect } from 'vitest';
import type {
  SendCodeRequest,
  SendCodeResponse,
  VerifyCodeRequest,
  VerifyCodeResponseWeb,
  VerifyCodeResponseMobile,
  FamilyDashboardResponse,
  FamilySelfCheckInRequest,
  FamilySelfCheckInResponse,
} from '../check-in/api';

describe('API types', () => {
  it('SendCodeRequest shape', () => {
    const req: SendCodeRequest = { type: 'email', value: 'a@b.com' };
    expect(req.type).toBe('email');
  });

  it('VerifyCodeResponseWeb includes redirectTo', () => {
    const res: VerifyCodeResponseWeb = { redirectTo: '/check-in/family' };
    expect(res.redirectTo).toBe('/check-in/family');
  });

  it('VerifyCodeResponseMobile includes customToken', () => {
    const res: VerifyCodeResponseMobile = { customToken: 'ct' };
    expect(res.customToken).toBe('ct');
  });

  it('FamilySelfCheckInRequest has students map', () => {
    const req: FamilySelfCheckInRequest = { students: { '1': true, '2': false } };
    expect(Object.keys(req.students)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/family-types.test.ts src/__tests__/check-in-api.test.ts
```

Expected: cannot resolve `../check-in/family` or `../check-in/api`.

- [ ] **Step 3: Create `packages/shared-domain/src/check-in/family.ts`**

```ts
export type PaymentStatus = 'paid' | 'unpaid' | 'partial';

export type ContactInfo =
  | { type: 'email'; value: string }
  | { type: 'phone'; value: string };

export interface Student {
  sid: string;
  fid: string;
  firstName: string;
  lastName: string;
  level: string;
  className?: string;
  dateOfBirth?: string;
}

export interface Family {
  fid: string;
  name: string;
  contacts: ContactInfo[];
  paymentStatus: PaymentStatus;
  students: Student[];
  notes?: string;
}
```

- [ ] **Step 4: Create `packages/shared-domain/src/check-in/check-in.ts`**

```ts
export type CheckedInBy = 'sevak' | 'family' | 'teacher' | 'guest';
export type CheckInStatus = 'present' | 'absent';

export interface CheckInEvent {
  checkInId: string;
  fid: string;
  sid: string;
  status: CheckInStatus;
  checkedInBy: CheckedInBy;
  checkedInAt: string;  // ISO timestamp
  recordedByUid?: string;
}

export interface CheckInHistoryEntry {
  checkInId: string;
  sid: string;
  firstName: string;
  lastName: string;
  status: CheckInStatus;
  checkedInAt: string;
  checkedInBy: CheckedInBy;
}
```

- [ ] **Step 5: Create `packages/shared-domain/src/check-in/api.ts`**

```ts
import type { Family, Student, PaymentStatus } from './family';
import type { CheckInHistoryEntry } from './check-in';

// Auth — family OTP
export interface SendCodeRequest {
  type: 'email' | 'phone';
  value: string;
}
export interface SendCodeResponse {
  success: true;
  throttleResetAt?: string;
}
export interface VerifyCodeRequest {
  type: 'email' | 'phone';
  value: string;
  code: string;
}
export interface VerifyCodeResponseWeb {
  redirectTo: string;
}
export interface VerifyCodeResponseMobile {
  customToken: string;
}

// Family dashboard
export interface FamilyDashboardResponse {
  family: Family;
  recentCheckIns: CheckInHistoryEntry[];
  paymentStatus: PaymentStatus;
}

// Family self check-in
export interface FamilySelfCheckInRequest {
  students: Record<string, boolean>;  // sid -> isPresent
}
export interface FamilySelfCheckInResponse {
  success: true;
  checkInIds: string[];
}

// Error envelope used by every /api/check-in/*
export interface ErrorResponse {
  error: string;
  details?: unknown;
  resetAt?: string;
}

// Re-exports for convenience
export type { Family, Student, PaymentStatus } from './family';
export type { CheckInEvent, CheckInHistoryEntry, CheckedInBy } from './check-in';
```

- [ ] **Step 6: Create `packages/shared-domain/src/check-in/index.ts`**

```ts
export * from './family';
export * from './check-in';
export * from './api';
```

- [ ] **Step 7: Modify `packages/shared-domain/src/index.ts` to re-export the new barrel**

Add `export * from './check-in';` (keep existing `export * from './auth';` from B0).

- [ ] **Step 8: Run tests to verify they pass**

```sh
pnpm --filter @cmt/shared-domain test -- src/__tests__/family-types.test.ts src/__tests__/check-in-api.test.ts
```

Expected: all assertions pass.

- [ ] **Step 9: Commit**

```sh
git add packages/shared-domain/src/check-in/ packages/shared-domain/src/index.ts packages/shared-domain/src/__tests__/family-types.test.ts packages/shared-domain/src/__tests__/check-in-api.test.ts
git commit -m "feat(shared-domain): add check-in domain types (family, check-in event, API contracts)"
```

---

## Task 2: `features/check-in/shared/rtdb/family-lookup.ts` — RTDB family reader

Wraps `readRtdb<Family>('/families/{fid}')` and provides a contact-lookup helper. Lives under `shared/` because B1 kiosk, B2 family portal, and B3 teacher portal all need it.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/family-lookup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/family-lookup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import {
  findFamilyById,
  findFamilyByContact,
  normalizeContact,
} from '../rtdb/family-lookup';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findFamilyById', () => {
  it('reads /families/{fid} and returns the family', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    const family = await findFamilyById('42');
    expect(readRtdb).toHaveBeenCalledWith('/families/42');
    expect(family?.fid).toBe('42');
  });

  it('returns null when not found', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const family = await findFamilyById('999');
    expect(family).toBeNull();
  });
});

describe('findFamilyByContact — email', () => {
  it('scans /families index and matches lowercased email', async () => {
    const all = {
      '42': {
        fid: '42',
        name: 'Acme',
        paymentStatus: 'paid',
        contacts: [{ type: 'email', value: 'Alice@Example.com' }],
        students: [],
      },
      '43': {
        fid: '43',
        name: 'Bravo',
        paymentStatus: 'unpaid',
        contacts: [{ type: 'email', value: 'bob@example.com' }],
        students: [],
      },
    };
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(all);
    const family = await findFamilyByContact('email', 'alice@example.com');
    expect(family?.fid).toBe('42');
  });

  it('returns null when no family matches', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    const family = await findFamilyByContact('email', 'nobody@example.com');
    expect(family).toBeNull();
  });
});

describe('findFamilyByContact — phone', () => {
  it('matches by digits-only phone comparison', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '42': {
        fid: '42',
        name: 'Acme',
        paymentStatus: 'paid',
        contacts: [{ type: 'phone', value: '+1 (647) 555-0100' }],
        students: [],
      },
    });
    const family = await findFamilyByContact('phone', '6475550100');
    expect(family?.fid).toBe('42');
  });
});

describe('normalizeContact', () => {
  it('lowercases email', () => {
    expect(normalizeContact('email', 'Foo@BAR.com')).toBe('foo@bar.com');
  });

  it('strips phone to digits only', () => {
    expect(normalizeContact('phone', '+1 (647) 555-0100')).toBe('16475550100');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/family-lookup.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts`**

```ts
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Family } from '@cmt/shared-domain/check-in/family';

export function normalizeContact(type: 'email' | 'phone', value: string): string {
  if (type === 'email') return value.trim().toLowerCase();
  return value.replace(/\D/g, '');
}

export async function findFamilyById(fid: string): Promise<Family | null> {
  return readRtdb<Family>(`/families/${fid}`);
}

export async function findFamilyByContact(
  type: 'email' | 'phone',
  value: string,
): Promise<Family | null> {
  const target = normalizeContact(type, value);
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  for (const family of Object.values(all)) {
    for (const c of family.contacts ?? []) {
      if (c.type !== type) continue;
      if (normalizeContact(type, c.value) === target) {
        return family;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/family-lookup.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/shared/rtdb/family-lookup.ts apps/portal/src/features/check-in/shared/__tests__/family-lookup.test.ts
git commit -m "feat(portal): add shared family-lookup helper (findFamilyById, findFamilyByContact, normalizeContact)"
```

---

## Task 3: `features/check-in/shared/firestore/verification-codes.ts` — OTP storage

Stores and verifies 6-digit codes in Firestore with a TTL. Uses `portalFirestore()` from B0.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/firestore/verification-codes.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/verification-codes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/verification-codes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

import {
  storeVerificationCode,
  verifyCode,
  hashContact,
  CODE_TTL_MS,
} from '../firestore/verification-codes';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.set.mockReset();
  fakeDoc.get.mockReset();
  fakeDoc.delete.mockReset();
});

describe('hashContact', () => {
  it('produces a stable hex digest for the same contact', () => {
    const a = hashContact('a@b.com');
    const b = hashContact('a@b.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('differs for different contacts', () => {
    expect(hashContact('a@b.com')).not.toBe(hashContact('c@d.com'));
  });
});

describe('storeVerificationCode', () => {
  it('writes to verification_codes/{hash}', async () => {
    await storeVerificationCode('a@b.com', '123456', 'email');
    expect(fakeFirestore.collection).toHaveBeenCalledWith('verification_codes');
    expect(fakeCollection.doc).toHaveBeenCalledWith(hashContact('a@b.com'));
    const write = (fakeDoc.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(write.code).toBe('123456');
    expect(write.type).toBe('email');
    expect(typeof write.expiresAt).toBe('number');
    expect(write.expiresAt - Date.now()).toBeGreaterThan(CODE_TTL_MS - 1000);
  });
});

describe('verifyCode', () => {
  it('returns true on a matching non-expired code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() + 60_000 }),
    });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(true);
    expect(fakeDoc.delete).toHaveBeenCalled();
  });

  it('returns false on a wrong code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() + 60_000 }),
    });
    const ok = await verifyCode('a@b.com', '000000', 'email');
    expect(ok).toBe(false);
    expect(fakeDoc.delete).not.toHaveBeenCalled();
  });

  it('returns false on an expired code', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ code: '123456', type: 'email', expiresAt: Date.now() - 1 }),
    });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(false);
  });

  it('returns false when no code exists', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const ok = await verifyCode('a@b.com', '123456', 'email');
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/verification-codes.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/firestore/verification-codes.ts`**

```ts
import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const CODE_TTL_MS = 10 * 60 * 1000;

export function hashContact(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

export async function storeVerificationCode(
  contact: string,
  code: string,
  type: 'email' | 'phone',
): Promise<void> {
  const hash = hashContact(contact);
  await portalFirestore()
    .collection('verification_codes')
    .doc(hash)
    .set({
      code,
      type,
      expiresAt: Date.now() + CODE_TTL_MS,
      createdAt: Date.now(),
    });
}

export async function verifyCode(
  contact: string,
  code: string,
  type: 'email' | 'phone',
): Promise<boolean> {
  const hash = hashContact(contact);
  const ref = portalFirestore().collection('verification_codes').doc(hash);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() as { code: string; type: string; expiresAt: number } | undefined;
  if (!data) return false;
  if (data.type !== type) return false;
  if (data.expiresAt < Date.now()) return false;
  if (data.code !== code) return false;
  await ref.delete();  // one-shot consume
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/verification-codes.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/shared/firestore/verification-codes.ts apps/portal/src/features/check-in/shared/__tests__/verification-codes.test.ts
git commit -m "feat(portal): add verification-codes Firestore helper (store, verify, hashContact, 10-min TTL)"
```

---

## Task 4: `features/check-in/shared/notifications/mock-sender.ts` — noop notification sender

The notification sender interface used by B2/B1/B4. In B2 it's a mock that logs the code. B5 replaces this wiring with real AWS SES/SNS.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/mock-sender.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/mock-sender.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSender, type NotificationSender } from '../notifications/mock-sender';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('mockSender', () => {
  it('conforms to the NotificationSender interface', () => {
    const sender: NotificationSender = mockSender;
    expect(typeof sender.sendEmail).toBe('function');
    expect(typeof sender.sendSMS).toBe('function');
  });

  it('sendEmail logs the recipient, subject, and body', async () => {
    await mockSender.sendEmail({
      to: 'a@b.com',
      subject: 'Your code',
      text: 'Code: 123456',
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-email]'),
      expect.objectContaining({ to: 'a@b.com', subject: 'Your code' }),
    );
  });

  it('sendSMS logs phone and message', async () => {
    await mockSender.sendSMS({ phone: '+16475550100', message: 'Code: 123456' });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[mock-sms]'),
      expect.objectContaining({ phone: '+16475550100' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/mock-sender.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts`**

```ts
export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendSMSArgs {
  phone: string;
  message: string;
}

export interface NotificationSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
}

export const mockSender: NotificationSender = {
  async sendEmail(args) {
    console.log('[mock-email]', { to: args.to, subject: args.subject, preview: args.text.slice(0, 80) });
  },
  async sendSMS(args) {
    console.log('[mock-sms]', { phone: args.phone, preview: args.message.slice(0, 80) });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/mock-sender.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/shared/notifications/mock-sender.ts apps/portal/src/features/check-in/shared/__tests__/mock-sender.test.ts
git commit -m "feat(portal): add mock NotificationSender (B5 replaces with real AWS SES/SNS)"
```

---

## Task 5: `features/check-in/shared/rate-limit/otp-rate-limit.ts` — OTP send rate limiter

Max 5 send-code calls per contact per 15-minute window, persisted in Firestore `otp_rate_limit/{hash}`.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/rate-limit/otp-rate-limit.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/otp-rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/otp-rate-limit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { get: vi.fn(), set: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

import {
  checkAndRecordOtpRateLimit,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from '../rate-limit/otp-rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.get.mockReset();
  fakeDoc.set.mockReset();
});

describe('checkAndRecordOtpRateLimit', () => {
  it('allows the first send', async () => {
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
    expect(fakeDoc.set).toHaveBeenCalled();
  });

  it('allows the Nth send where N <= RATE_LIMIT_MAX', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX - 1, windowStart: Date.now() - 1000 }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
  });

  it('denies when RATE_LIMIT_MAX is exceeded within the window', async () => {
    const windowStart = Date.now() - 1000;
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX, windowStart }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(false);
    expect(result.resetAt).toBeDefined();
  });

  it('resets when the window has elapsed', async () => {
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ count: RATE_LIMIT_MAX, windowStart: Date.now() - RATE_LIMIT_WINDOW_MS - 1000 }),
    });
    const result = await checkAndRecordOtpRateLimit('a@b.com');
    expect(result.allowed).toBe(true);
    const write = (fakeDoc.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(write.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/otp-rate-limit.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/rate-limit/otp-rate-limit.ts`**

```ts
import { createHash } from 'node:crypto';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  resetAt?: string;
}

export async function checkAndRecordOtpRateLimit(contact: string): Promise<RateLimitResult> {
  const hash = createHash('sha256').update(contact).digest('hex');
  const ref = portalFirestore().collection('otp_rate_limit').doc(hash);
  const snap = await ref.get();
  const now = Date.now();

  if (!snap.exists) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  const data = snap.data() as { count: number; windowStart: number } | undefined;
  if (!data) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  const windowElapsed = now - data.windowStart >= RATE_LIMIT_WINDOW_MS;
  if (windowElapsed) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true };
  }

  if (data.count >= RATE_LIMIT_MAX) {
    const resetAt = new Date(data.windowStart + RATE_LIMIT_WINDOW_MS).toISOString();
    return { allowed: false, resetAt };
  }

  await ref.set({ count: data.count + 1, windowStart: data.windowStart });
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/otp-rate-limit.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/features/check-in/shared/rate-limit/otp-rate-limit.ts apps/portal/src/features/check-in/shared/__tests__/otp-rate-limit.test.ts
git commit -m "feat(portal): add OTP rate limiter (5 per contact per 15-min window, Firestore-backed)"
```

---

## Task 6: Shared contact helpers + shared barrel

`normalizeContact` already exists in the family-lookup module — move/re-export it here so it's the canonical location. Create the shared barrel index.

**Files:**
- Create: `apps/portal/src/features/check-in/shared/contact/normalize.ts`
- Create: `apps/portal/src/features/check-in/shared/contact/hash.ts`
- Create: `apps/portal/src/features/check-in/shared/index.ts`
- Test: `apps/portal/src/features/check-in/shared/__tests__/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/features/check-in/shared/__tests__/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeContact } from '../contact/normalize';
import { sha256Hex } from '../contact/hash';

describe('normalizeContact', () => {
  it('lowercases and trims email', () => {
    expect(normalizeContact('email', '  ALICE@Example.com  ')).toBe('alice@example.com');
  });
  it('strips phone to digits only', () => {
    expect(normalizeContact('phone', '+1 (647) 555-0100')).toBe('16475550100');
  });
});

describe('sha256Hex', () => {
  it('produces a 64-char hex string', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/normalize.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/shared/contact/normalize.ts`**

```ts
export function normalizeContact(type: 'email' | 'phone', value: string): string {
  if (type === 'email') return value.trim().toLowerCase();
  return value.replace(/\D/g, '');
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/shared/contact/hash.ts`**

```ts
import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/shared/index.ts`**

```ts
export * from './contact/normalize';
export * from './contact/hash';
export * from './rtdb/family-lookup';
export * from './firestore/verification-codes';
export * from './notifications/mock-sender';
export * from './rate-limit/otp-rate-limit';
```

- [ ] **Step 6: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/shared/__tests__/normalize.test.ts
```

Expected: passes.

- [ ] **Step 7: Commit**

```sh
git add apps/portal/src/features/check-in/shared/contact/ apps/portal/src/features/check-in/shared/index.ts apps/portal/src/features/check-in/shared/__tests__/normalize.test.ts
git commit -m "feat(portal): add shared contact normalizers + barrel export for check-in/shared"
```

---

## Task 7: `POST /api/auth/family/send-code` — send OTP

Validates family exists in RTDB, generates 6-digit code, stores it, calls mock sender, respects rate limit.

**Files:**
- Create: `apps/portal/src/app/api/auth/family/send-code/route.ts`
- Test: `apps/portal/src/app/api/auth/family/send-code/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/auth/family/send-code/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  findFamilyByContact: vi.fn(),
  storeVerificationCode: vi.fn(),
  checkAndRecordOtpRateLimit: vi.fn(),
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.toLowerCase() : v.replace(/\D/g, ''),
  mockSender: { sendEmail: vi.fn(), sendSMS: vi.fn() },
}));

import {
  findFamilyByContact,
  storeVerificationCode,
  checkAndRecordOtpRateLimit,
  mockSender,
} from '@/features/check-in/shared';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/family/send-code', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'carrier-pigeon', value: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 404 when family not found', async () => {
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'nobody@example.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('returns 429 when rate-limited', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      resetAt: new Date(Date.now() + 60000).toISOString(),
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.resetAt).toBeDefined();
      },
    });
  });

  it('stores a code and calls sendEmail on happy path', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
    });
    (storeVerificationCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(storeVerificationCode).toHaveBeenCalled();
    const code = (storeVerificationCode as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(code).toMatch(/^\d{6}$/);
    expect(mockSender.sendEmail).toHaveBeenCalled();
  });

  it('calls sendSMS for phone type', async () => {
    (checkAndRecordOtpRateLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: true,
    });
    (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'phone', value: '+16475550100' }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(mockSender.sendSMS).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/family/send-code/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/auth/family/send-code/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import {
  findFamilyByContact,
  normalizeContact,
  storeVerificationCode,
  checkAndRecordOtpRateLimit,
  mockSender,
} from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
});

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const normalized = normalizeContact(parsed.data.type, parsed.data.value);
  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, parsed.data.type);

  if (parsed.data.type === 'email') {
    await mockSender.sendEmail({
      to: parsed.data.value,
      subject: 'Your CMT portal verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
  } else {
    await mockSender.sendSMS({
      phone: parsed.data.value,
      message: `CMT portal code: ${code} (10 min)`,
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/family/send-code/__tests__/route.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/auth/family/send-code/
git commit -m "feat(portal): POST /api/auth/family/send-code with rate limit, family validation, mock sender"
```

---

## Task 8: `POST /api/auth/family/verify-code` — verify + create session

Verifies code, creates/reuses Firebase user keyed on hashed contact, sets claims, creates session cookie (web) or returns custom token (mobile).

**Files:**
- Create: `apps/portal/src/app/api/auth/family/verify-code/route.ts`
- Test: `apps/portal/src/app/api/auth/family/verify-code/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/auth/family/verify-code/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  verifyCode: vi.fn(),
  findFamilyByContact: vi.fn(),
  normalizeContact: (t: string, v: string) =>
    t === 'email' ? v.toLowerCase() : v.replace(/\D/g, ''),
  sha256Hex: (s: string) => `hash-${s}`,
}));

vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => ({
    getUser: vi.fn(),
    createUser: vi.fn(),
  })),
}));

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  setPortalUserClaims: vi.fn(),
  createPortalCustomToken: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/session', () => ({
  exchangeCustomTokenForIdToken: vi.fn(),
  createPortalSessionCookie: vi.fn(),
}));

import { verifyCode, findFamilyByContact } from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  setPortalUserClaims,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_COOKIE_EXPIRES_DAYS = '5';
});

function happyPathMocks() {
  (verifyCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
  (findFamilyByContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    fid: '42',
    name: 'Acme',
  });
  const authMock = { getUser: vi.fn().mockRejectedValue({ code: 'auth/user-not-found' }), createUser: vi.fn().mockResolvedValue({ uid: 'hash-a@b.com' }) };
  (portalAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(authMock);
  (createPortalCustomToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('ctok');
  (exchangeCustomTokenForIdToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('idtok');
  (createPortalSessionCookie as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('sess');
}

describe('POST /api/auth/family/verify-code', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 401 on wrong code', async () => {
    (verifyCode as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '000000' }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 200 + session cookie on happy path (web mode default)', async () => {
    happyPathMocks();
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.redirectTo).toBe('/check-in/family');
        expect(res.headers.get('set-cookie')).toMatch(/__session=sess/);
      },
    });
    expect(setPortalUserClaims).toHaveBeenCalledWith('hash-a@b.com', {
      role: 'family',
      familyId: '42',
      email: 'a@b.com',
    });
  });

  it('returns customToken on mobile mode', async () => {
    happyPathMocks();
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456', mode: 'mobile' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.customToken).toBe('ctok');
        expect(res.headers.get('set-cookie')).toBeNull();
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/family/verify-code/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/auth/family/verify-code/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  verifyCode,
  findFamilyByContact,
  normalizeContact,
  sha256Hex,
} from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  setPortalUserClaims,
  createPortalCustomToken,
} from '@cmt/firebase-shared/admin/claims';
import {
  exchangeCustomTokenForIdToken,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
  mode: z.enum(['web', 'mobile']).default('web'),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const normalized = normalizeContact(parsed.data.type, parsed.data.value);
  const ok = await verifyCode(normalized, parsed.data.code, parsed.data.type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-code' }, { status: 401 });
  }

  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const uid = sha256Hex(normalized);
  const auth = portalAuth();
  try {
    await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, disabled: false });
    } else {
      throw err;
    }
  }
  await setPortalUserClaims(uid, {
    role: 'family',
    familyId: family.fid,
    ...(parsed.data.type === 'email' ? { email: parsed.data.value } : { phone: parsed.data.value }),
  });

  const customToken = await createPortalCustomToken(uid, {
    role: 'family',
    familyId: family.fid,
  });

  if (parsed.data.mode === 'mobile') {
    return NextResponse.json({ customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ redirectTo: '/check-in/family' }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/auth/family/verify-code/__tests__/route.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/auth/family/verify-code/
git commit -m "feat(portal): POST /api/auth/family/verify-code with dual-mode (web cookie + mobile customToken)"
```

---

## Task 9: Replace `FamilyLoginForm` with real OTP flow

Two-step form: contact entry → code entry. Uses shadcn primitives.

**Files:**
- Modify: `apps/portal/src/features/check-in/family/family-login-form.tsx` (move from `auth/` in B0; B0 had a stub in `auth/family-login-form.tsx`)
- Create: `apps/portal/src/features/check-in/family/otp-code-input.tsx`
- Create: `apps/portal/src/features/check-in/family/index.ts`
- Test: `apps/portal/src/features/check-in/family/__tests__/family-login-form.test.tsx`
- Modify: `apps/portal/src/app/login/family/page.tsx` (import path change)
- Delete: `apps/portal/src/features/check-in/auth/family-login-form.tsx` (move to family/)
- Modify: `apps/portal/src/features/check-in/auth/index.ts` (drop FamilyLoginForm export)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/family/__tests__/family-login-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FamilyLoginForm } from '../family-login-form';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('FamilyLoginForm — contact step', () => {
  it('renders email and phone tabs', () => {
    render(<FamilyLoginForm />);
    expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /phone/i })).toBeInTheDocument();
  });

  it('submits email → fetches /api/auth/family/send-code', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/family/send-code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
      }),
    );
  });

  it('moves to OTP step after successful send', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it('shows error on 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'family-not-found' }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
  });

  it('shows throttle message on 429', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate-limited', resetAt: '2026-04-13T20:00:00Z' }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });
});

describe('FamilyLoginForm — OTP step', () => {
  async function reachOtpStep() {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    render(<FamilyLoginForm />);
    await user.type(screen.getByLabelText(/email/i), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/verification code/i);
    return user;
  }

  it('submits code → /api/auth/family/verify-code', async () => {
    const user = await reachOtpStep();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectTo: '/check-in/family' }),
    } as Response);
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/family/verify-code',
      expect.objectContaining({
        body: JSON.stringify({ type: 'email', value: 'a@b.com', code: '123456' }),
      }),
    );
  });

  it('shows error on invalid code', async () => {
    const user = await reachOtpStep();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid-code' }),
    } as Response);
    await user.type(screen.getByLabelText(/verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/family-login-form.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/family/otp-code-input.tsx`**

```tsx
'use client';
import { Input, Label } from '@cmt/ui';

interface Props {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}

export function OtpCodeInput({ value, onChange, id = 'otp-code' }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Verification code</Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/family/family-login-form.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { OtpCodeInput } from './otp-code-input';

type ContactType = 'email' | 'phone';
type Step = 'contact' | 'otp';

export function FamilyLoginForm() {
  const [step, setStep] = useState<Step>('contact');
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/family/send-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
      if (!res.ok) {
        if (res.status === 404) setError(`Account not found for this ${type}`);
        else if (res.status === 429) setError('Too many requests. Try again later.');
        else setError('Something went wrong. Try again.');
        return;
      }
      setStep('otp');
    });
  }

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/family/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value, code }),
      });
      if (!res.ok) {
        setError('Invalid or expired code');
        return;
      }
      const body = (await res.json()) as { redirectTo: string };
      window.location.assign(body.redirectTo);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Family sign in</h1>

      {step === 'contact' && (
        <>
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

          <form onSubmit={onSendCode} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        </>
      )}

      {step === 'otp' && (
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          <p className="text-sm text-[hsl(var(--foreground))]">
            We sent a 6-digit code to <strong>{value}</strong>. Enter it below.
          </p>
          <OtpCodeInput value={code} onChange={setCode} />
          {error && (
            <div role="alert" className="text-sm text-red-600">
              {error}
            </div>
          )}
          <Button type="submit" disabled={pending || code.length !== 6}>
            {pending ? 'Verifying…' : 'Verify'}
          </Button>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setStep('contact');
              setCode('');
              setError(null);
            }}
          >
            Use a different {type}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/features/check-in/family/index.ts`**

```ts
export { FamilyLoginForm } from './family-login-form';
export { OtpCodeInput } from './otp-code-input';
```

- [ ] **Step 6: Update `apps/portal/src/app/login/family/page.tsx`**

```tsx
import { FamilyLoginForm } from '@/features/check-in/family';

export const metadata = { title: 'Family sign in — CMT Portal' };

export default function FamilyLoginPage() {
  return (
    <main className="min-h-screen bg-[hsl(var(--muted))]">
      <FamilyLoginForm />
    </main>
  );
}
```

- [ ] **Step 7: Remove the B0 scaffold from `features/check-in/auth/`**

```sh
rm apps/portal/src/features/check-in/auth/family-login-form.tsx
```

Update `apps/portal/src/features/check-in/auth/index.ts`:

```ts
export { LoginRolePicker } from './login-role-picker';
export { AdminLoginForm } from './admin-login-form';
export { TeacherLoginForm } from './teacher-login-form';
```

- [ ] **Step 8: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/family-login-form.test.tsx
```

Expected: all 7 tests pass.

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/features/check-in/family/ apps/portal/src/features/check-in/auth/index.ts apps/portal/src/app/login/family/page.tsx
git rm apps/portal/src/features/check-in/auth/family-login-form.tsx
git commit -m "feat(portal): real FamilyLoginForm with email/phone tabs + OTP step"
```

---

## Task 10: `GET /api/check-in/family/dashboard` — family dashboard data

Reads family from RTDB, recent check-ins from Firestore, returns combined payload. Auth-gated (`family` role).

**Files:**
- Create: `apps/portal/src/app/api/check-in/family/dashboard/route.ts`
- Test: `apps/portal/src/app/api/check-in/family/dashboard/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/family/dashboard/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

const fakeQuery = {
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn(),
};
const fakeCollection = { ...fakeQuery };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.get.mockReset();
});

describe('GET /api/check-in/family/dashboard', () => {
  it('returns 401 when family header missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns family + recent check-ins on happy path', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [],
      students: [{ sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' }],
    });
    fakeCollection.get.mockResolvedValueOnce({
      docs: [
        {
          id: 'ci-1',
          data: () => ({
            sid: '1',
            status: 'present',
            checkedInAt: '2026-04-10T14:00:00Z',
            checkedInBy: 'sevak',
          }),
        },
      ],
    });
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-family-id', '42'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.family.fid).toBe('42');
        expect(body.recentCheckIns).toHaveLength(1);
        expect(body.recentCheckIns[0].firstName).toBe('Alice');
        expect(body.paymentStatus).toBe('paid');
      },
    });
  });

  it('returns 404 if family not found', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    fakeCollection.get.mockResolvedValueOnce({ docs: [] });
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-family-id', '999'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(404);
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/family/dashboard/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/family/dashboard/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { findFamilyById } from '@/features/check-in/shared';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { FamilyDashboardResponse, CheckInHistoryEntry } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const familyId = req.headers.get('x-portal-family-id');
  if (!familyId) {
    return NextResponse.json({ error: 'no-family-id' }, { status: 401 });
  }

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const snap = await portalFirestore()
    .collection('check_in_events')
    .where('fid', '==', familyId)
    .orderBy('checkedInAt', 'desc')
    .limit(10)
    .get();

  const studentMap = new Map(family.students.map((s) => [s.sid, s]));
  const recentCheckIns: CheckInHistoryEntry[] = snap.docs.map((d) => {
    const data = d.data() as { sid: string; status: 'present' | 'absent'; checkedInAt: string; checkedInBy: 'sevak' | 'family' | 'teacher' | 'guest' };
    const student = studentMap.get(data.sid);
    return {
      checkInId: d.id,
      sid: data.sid,
      firstName: student?.firstName ?? 'Unknown',
      lastName: student?.lastName ?? '',
      status: data.status,
      checkedInAt: data.checkedInAt,
      checkedInBy: data.checkedInBy,
    };
  });

  const body: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/family/dashboard/__tests__/route.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/family/dashboard/
git commit -m "feat(portal): GET /api/check-in/family/dashboard (family + recent check-ins + payment status)"
```

---

## Task 11: Family dashboard page + components

Server component reads `x-portal-family-id` header and fetches family data directly via the shared helper (avoiding an internal fetch round-trip).

**Files:**
- Create: `apps/portal/src/features/check-in/family/family-dashboard.tsx`
- Create: `apps/portal/src/features/check-in/family/payment-status-banner.tsx`
- Create: `apps/portal/src/app/check-in/family/page.tsx`
- Create: `apps/portal/src/app/check-in/family/error.tsx`
- Create: `apps/portal/src/app/check-in/family/loading.tsx`
- Test: `apps/portal/src/features/check-in/family/__tests__/family-dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/family/__tests__/family-dashboard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamilyDashboard } from '../family-dashboard';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';

const data: FamilyDashboardResponse = {
  family: {
    fid: '42',
    name: 'Acme',
    paymentStatus: 'unpaid',
    contacts: [],
    students: [
      { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
      { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
    ],
  },
  recentCheckIns: [
    {
      checkInId: 'ci-1',
      sid: '1',
      firstName: 'Alice',
      lastName: 'Acme',
      status: 'present',
      checkedInAt: '2026-04-10T14:00:00Z',
      checkedInBy: 'sevak',
    },
  ],
  paymentStatus: 'unpaid',
};

describe('FamilyDashboard', () => {
  it('renders family name', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
  });
  it('lists every student', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });
  it('shows unpaid banner when payment status is unpaid', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/payment.*pending|unpaid/i)).toBeInTheDocument();
  });
  it('lists recent check-ins', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/family-dashboard.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/family/payment-status-banner.tsx`**

```tsx
import type { PaymentStatus } from '@cmt/shared-domain/check-in';

export function PaymentStatusBanner({ status }: { status: PaymentStatus }) {
  if (status === 'paid') return null;
  const message = status === 'unpaid' ? 'Payment pending.' : 'Partial payment on file.';
  return (
    <div className="rounded border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-amber-900">
      {message} Please see a sevak to settle your account.
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/features/check-in/family/family-dashboard.tsx`**

```tsx
import Link from 'next/link';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';
import { PaymentStatusBanner } from './payment-status-banner';

interface Props {
  data: FamilyDashboardResponse;
}

export function FamilyDashboard({ data }: Props) {
  const { family, recentCheckIns, paymentStatus } = data;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[hsl(var(--heading))]">{family.name}</h1>
          <p className="text-sm text-[hsl(var(--foreground))]">
            Family ID: <code>{family.fid}</code>
          </p>
        </div>
        <form action="/api/auth/signout" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>

      <PaymentStatusBanner status={paymentStatus} />

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">Your kids</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {family.students.map((s) => (
            <li
              key={s.sid}
              className="rounded border border-[hsl(var(--border))] p-3"
            >
              <div className="font-medium">{s.firstName} {s.lastName}</div>
              <div className="text-sm text-[hsl(var(--foreground))]">Level: {s.level}</div>
            </li>
          ))}
        </ul>
        <Link
          href="/check-in/family/check-in"
          className="mt-4 inline-block rounded bg-[hsl(var(--primary))] px-4 py-2 text-white hover:opacity-90"
        >
          Check in my kids
        </Link>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-[hsl(var(--heading))]">Recent check-ins</h2>
        {recentCheckIns.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground))]">No check-ins yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {recentCheckIns.map((c) => (
              <li key={c.checkInId} className="flex justify-between">
                <span>
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-[hsl(var(--foreground))]">
                  {new Date(c.checkedInAt).toLocaleString()} · by {c.checkedInBy}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Update `apps/portal/src/features/check-in/family/index.ts`**

```ts
export { FamilyLoginForm } from './family-login-form';
export { OtpCodeInput } from './otp-code-input';
export { FamilyDashboard } from './family-dashboard';
export { PaymentStatusBanner } from './payment-status-banner';
```

- [ ] **Step 6: Create `apps/portal/src/app/check-in/family/page.tsx`**

```tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { findFamilyById } from '@/features/check-in/shared';
import { FamilyDashboard } from '@/features/check-in/family';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import type { FamilyDashboardResponse, CheckInHistoryEntry } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'My family — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function FamilyDashboardPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  const snap = await portalFirestore()
    .collection('check_in_events')
    .where('fid', '==', familyId)
    .orderBy('checkedInAt', 'desc')
    .limit(10)
    .get();

  const studentMap = new Map(family.students.map((s) => [s.sid, s]));
  const recentCheckIns: CheckInHistoryEntry[] = snap.docs.map((d) => {
    const data = d.data() as { sid: string; status: 'present' | 'absent'; checkedInAt: string; checkedInBy: 'sevak' | 'family' | 'teacher' | 'guest' };
    const student = studentMap.get(data.sid);
    return {
      checkInId: d.id,
      sid: data.sid,
      firstName: student?.firstName ?? 'Unknown',
      lastName: student?.lastName ?? '',
      status: data.status,
      checkedInAt: data.checkedInAt,
      checkedInBy: data.checkedInBy,
    };
  });

  const response: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return <FamilyDashboard data={response} />;
}
```

- [ ] **Step 7: Create `apps/portal/src/app/check-in/family/error.tsx` and `loading.tsx`**

```tsx
// error.tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function FamilyError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Family dashboard error" />;
}
```

```tsx
// loading.tsx
export default function FamilyLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
```

- [ ] **Step 8: Run tests**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/family-dashboard.test.tsx
```

Expected: all 4 tests pass.

- [ ] **Step 9: Commit**

```sh
git add apps/portal/src/features/check-in/family/ apps/portal/src/app/check-in/family/page.tsx apps/portal/src/app/check-in/family/error.tsx apps/portal/src/app/check-in/family/loading.tsx
git commit -m "feat(portal): /check-in/family dashboard page with family data, students, payment banner"
```

---

## Task 12: Placeholder kept at Task 10 — skipped

(Task 10 is the dashboard API route; Task 11 wired the SSR page. Tasks renumbered only — no work here.)

Actually we're not skipping. Let me re-map. Task 12 in this plan was originally "GET /api/check-in/family/dashboard" but that's covered by Task 10. Re-purposing Task 12 to the **self check-in API route**.

## Task 12: `POST /api/check-in/family/self-check-in` — family self-service write

**Files:**
- Create: `apps/portal/src/app/api/check-in/family/self-check-in/route.ts`
- Test: `apps/portal/src/app/api/check-in/family/self-check-in/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/check-in/family/self-check-in/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const fakeAddResults = { id: 'ci-new' };
const fakeCollection = {
  add: vi.fn().mockResolvedValue(fakeAddResults),
};
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  fakeCollection.add.mockResolvedValue(fakeAddResults);
});

describe('POST /api/check-in/family/self-check-in', () => {
  it('returns 401 without family header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
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

  it('writes check-in events for each student and returns ids', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true, '2': true, '3': false } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.checkInIds).toHaveLength(3);
      },
    });
    expect(fakeCollection.add).toHaveBeenCalledTimes(3);
  });

  it('sets checkedInBy to family', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => {
        req.headers.set('x-portal-family-id', '42');
        req.headers.set('x-portal-uid', 'u1');
      },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    const writes = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(writes[0][0].checkedInBy).toBe('family');
    expect(writes[0][0].recordedByUid).toBe('u1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/family/self-check-in/__tests__/route.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/app/api/check-in/family/self-check-in/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { FamilySelfCheckInResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  students: z.record(z.string(), z.boolean()),
});

export async function POST(req: Request) {
  const familyId = req.headers.get('x-portal-family-id');
  const uid = req.headers.get('x-portal-uid');
  if (!familyId || !uid) {
    return NextResponse.json({ error: 'no-family-id' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const checkInIds: string[] = [];
  const coll = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();

  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const docRef = await coll.add({
      fid: familyId,
      sid,
      status: isPresent ? 'present' : 'absent',
      checkedInBy: 'family' as const,
      checkedInAt,
      recordedByUid: uid,
    });
    checkInIds.push(docRef.id);
  }

  const body: FamilySelfCheckInResponse = { success: true, checkInIds };
  return NextResponse.json(body, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/family/self-check-in/__tests__/route.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/check-in/family/self-check-in/
git commit -m "feat(portal): POST /api/check-in/family/self-check-in writes per-student events with checkedInBy=family"
```

---

## Task 13: Self check-in page + component

**Files:**
- Create: `apps/portal/src/features/check-in/family/student-check-in-list.tsx`
- Create: `apps/portal/src/app/check-in/family/check-in/page.tsx`
- Create: `apps/portal/src/app/check-in/family/check-in/error.tsx`
- Test: `apps/portal/src/features/check-in/family/__tests__/student-check-in-list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/features/check-in/family/__tests__/student-check-in-list.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudentCheckInList } from '../student-check-in-list';
import type { Student } from '@cmt/shared-domain/check-in';

const students: Student[] = [
  { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
  { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
];

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  vi.stubGlobal('location', { assign: vi.fn(), href: '' });
});

describe('StudentCheckInList', () => {
  it('renders a checkbox for each student, defaulted on', () => {
    render(<StudentCheckInList students={students} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('submits POST /api/check-in/family/self-check-in with toggled state', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, checkInIds: ['ci-1', 'ci-2'] }),
    } as Response);

    render(<StudentCheckInList students={students} />);
    await user.click(screen.getAllByRole('checkbox')[1]!);  // uncheck Bob
    await user.click(screen.getByRole('button', { name: /check in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/check-in/family/self-check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ students: { '1': true, '2': false } }),
      }),
    );
  });

  it('shows error on non-ok response', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as Response);
    render(<StudentCheckInList students={students} />);
    await user.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/student-check-in-list.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Create `apps/portal/src/features/check-in/family/student-check-in-list.tsx`**

```tsx
'use client';
import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@cmt/ui';
import type { Student } from '@cmt/shared-domain/check-in';

interface Props {
  students: Student[];
}

export function StudentCheckInList({ students }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(students.map((s) => [s.sid, true])),
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
      const res = await fetch('/api/check-in/family/self-check-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ students: selected }),
      });
      if (!res.ok) {
        setError('Check-in failed. Please try again.');
        return;
      }
      window.location.assign('/check-in/family');
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {students.map((s) => (
          <li
            key={s.sid}
            className="flex items-center gap-3 rounded border border-[hsl(var(--border))] p-3"
          >
            <input
              id={`student-${s.sid}`}
              type="checkbox"
              checked={selected[s.sid] ?? false}
              onChange={() => toggle(s.sid)}
              className="h-5 w-5"
            />
            <label htmlFor={`student-${s.sid}`} className="flex-1">
              <div className="font-medium">
                {s.firstName} {s.lastName}
              </div>
              <div className="text-sm text-[hsl(var(--foreground))]">Level: {s.level}</div>
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
        {pending ? 'Checking in…' : 'Check in'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/portal/src/app/check-in/family/check-in/page.tsx`**

```tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { findFamilyById } from '@/features/check-in/shared';
import { StudentCheckInList } from '@/features/check-in/family/student-check-in-list';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Check in my kids — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function FamilySelfCheckInPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Check in your kids</h1>
      <p className="text-sm text-[hsl(var(--foreground))]">
        Uncheck any child who is not attending today.
      </p>
      <StudentCheckInList students={family.students} />
    </main>
  );
}
```

- [ ] **Step 5: Create `apps/portal/src/app/check-in/family/check-in/error.tsx`**

```tsx
'use client';
import { ErrorFallback } from '@cmt/ui';

export default function FamilyCheckInError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorFallback error={error} reset={reset} title="Family check-in error" />;
}
```

- [ ] **Step 6: Update the family barrel**

```ts
// apps/portal/src/features/check-in/family/index.ts
export { FamilyLoginForm } from './family-login-form';
export { OtpCodeInput } from './otp-code-input';
export { FamilyDashboard } from './family-dashboard';
export { PaymentStatusBanner } from './payment-status-banner';
export { StudentCheckInList } from './student-check-in-list';
```

- [ ] **Step 7: Run test to verify it passes**

```sh
pnpm --filter @cmt/portal test -- src/features/check-in/family/__tests__/student-check-in-list.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 8: Commit**

```sh
git add apps/portal/src/features/check-in/family/student-check-in-list.tsx apps/portal/src/features/check-in/family/index.ts apps/portal/src/app/check-in/family/check-in/
git commit -m "feat(portal): /check-in/family/check-in page with student list + submission flow"
```

---

## Task 14: Full-suite test run (checkpoint before e2e)

**Files:** none — verification step.

- [ ] **Step 1: Run all workspace tests**

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Expected: green across `@cmt/shared-domain`, `@cmt/firebase-shared`, `@cmt/ui`, `@cmt/portal`. If anything fails, fix the root cause before moving to Playwright.

- [ ] **Step 2: If green, no commit needed (this is a checkpoint)**

---

## Task 15: Flip `NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY` to `true` in `.env.local`

**Files:** local env only.

- [ ] **Step 1: Edit `apps/portal/.env.local`**

```
NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY=true
```

- [ ] **Step 2: Start dev server manually to smoke-test**

```sh
pnpm --filter @cmt/portal dev
```

Open `http://localhost:3000/login/family`. Confirm the two-step form renders. Type a known UAT family email, hit Send code. Check the terminal for the `[mock-email]` log line with the 6-digit code. Enter it in the next step. Confirm redirect to `/check-in/family` dashboard. Stop the server (`Ctrl+C`).

(This is a manual verification — no commit.)

---

## Task 16: Playwright e2e `b2-family.spec.ts`

**Files:**
- Create: `apps/portal/e2e/b2-family.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/portal/e2e/b2-family.spec.ts
import { test, expect } from './fixtures';

const E2E_FAMILY_EMAIL = process.env.E2E_FAMILY_EMAIL;
const E2E_FAMILY_FID = process.env.E2E_FAMILY_FID;

test.describe('B2 — family portal', () => {
  test('family login page renders contact form with tabs', async ({ page }) => {
    await page.goto('/login/family');
    await expect(page.getByRole('heading', { name: /family sign in/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /phone/i })).toBeVisible();
  });

  test('send-code → otp → dashboard happy path (requires seeded family)', async ({ page }) => {
    test.skip(
      !E2E_FAMILY_EMAIL || !E2E_FAMILY_FID,
      'E2E_FAMILY_EMAIL / E2E_FAMILY_FID env vars required',
    );

    await page.goto('/login/family');
    await page.getByLabel(/email/i).fill(E2E_FAMILY_EMAIL!);
    await page.getByRole('button', { name: /send code/i }).click();
    await expect(page.getByLabelText(/verification code/i)).toBeVisible();

    // The mock sender logs the code to the server console. In the e2e env we
    // intercept by reading from a special test endpoint, OR we use a fixed
    // test code when NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false.
    // For now, this test is skip-guarded; full e2e arrives once B5 wires a
    // test sender that exposes codes to Playwright.
  });

  test('unauthenticated visit to /check-in/family redirects to /login', async ({ page }) => {
    await page.goto('/check-in/family');
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 2: Verify the spec lints**

```sh
pnpm --filter @cmt/portal lint
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b2-family.spec.ts
git commit -m "test(portal): add b2-family.spec.ts — login form + unauthenticated redirect (full OTP e2e skip-guarded)"
```

---

## Task 17: README update + final pre-push + push

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README `## Slice-based development` list**

Add a B2 progress marker:

```markdown
- **Slice B** — 🚧 In progress —
  - B0 ✅ — Portal auth foundation
  - B2 ✅ — Family portal (OTP login, dashboard, self-check-in)
  - B3 — Teacher portal (next)
  - B1 — Kiosk port
  - B4 — Admin dashboard
  - B5 — Notifications & cron
```

- [ ] **Step 2: Update CLAUDE.md to reflect B2 shipped**

Find the "Slice B status" line from B0 and update:

```markdown
**Slice B status:** In progress. B0 + B2 shipped. B3 (teacher portal) is next.
```

- [ ] **Step 3: Run the full pre-push suite**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four green.

- [ ] **Step 4: Commit docs**

```sh
git add README.md CLAUDE.md
git commit -m "docs: mark B2 shipped in slice-B progress tracker"
```

- [ ] **Step 5: Push**

```sh
git push origin main
```

Pre-push hook re-runs. On green, main is updated.

B2 is shipped. Next up: B3 (teacher portal).

---

## B2 acceptance gate summary

| # | Criterion | Verified by |
|---|---|---|
| B2-AC-1 | Sending OTP to unknown email returns 404 | Task 7 test |
| B2-AC-2 | Sending OTP to known email stores code + mock-sends | Task 7 test |
| B2-AC-3 | 6th send within 15 min returns 429 | Task 7 test |
| B2-AC-4 | Wrong code returns 401 | Task 8 test |
| B2-AC-5 | Correct code creates user, sets claims, returns session | Task 8 test |
| B2-AC-6 | `/check-in/family` renders kids + history | Task 11 test + manual |
| B2-AC-7 | `/check-in/family/check-in` writes `CheckInEvent` with `checkedInBy: 'family'` | Task 12 test |
| B2-AC-8 | Playwright b2-family green | Task 16 |
| B2-AC-9 | Bearer mode works for `/api/check-in/family/*` | Task 8 mobile mode test |
| B2-AC-10 | All new pages have `error.tsx` | Tasks 11, 13 |
| B2-AC-11 | No `react-phone-number-input`/`headlessui` added | package.json review |
| B2-AC-12 | `≥ 80%` line coverage under `features/check-in/family/` | Soft |
| B2-AC-13 | Typecheck + lint + test + build green | Task 17 step 3 |
| B2-AC-14 | Feature flag toggles routes on/off | Task 11/13 `flags.checkInFamily` gate |

On green: B2 shipped. Next: B3 teacher portal plan.

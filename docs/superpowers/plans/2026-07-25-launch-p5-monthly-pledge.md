# P5 - Monthly Pledge (Pre-Authorized Debit) - Implementation Plan

> # ⛔ SUPERSEDED 2026-07-25 - DO NOT IMPLEMENT THIS FILE
>
> Replaced by **`2026-07-25-launch-p5-monthly-pledge-v2.md`**.
> Reviewed as REQUEST CHANGES: 2 critical, 10 major, 14 minor
> (`docs/superpowers/reviews/2026-07-25-review-p5.md`). This plan handles real bank
> account details, so the bar is higher than elsewhere in the batch.
>
> - **CRITICAL-1 (Sentry egress) is already FIXED in code** as of `7902c63` - though the
>   review's stated mechanism was wrong; see the correction box at the top of that report.
> - **CRITICAL-2 stands: there is no `firestore.rules` file in this repo at all.**
>   `firebase.json` declares only indexes, and `getClientFirestore()` is exported and live.
>   The design's headline control ("no read path exists") is true of the HTTP surface and
>   unmanaged at the database surface - where open rules would let a family flip their own
>   pledge to `active`.
> - Ten majors, including: handlers with no role check of their own, **three missing
>   composite indexes** (both read paths 500), a designed-but-unwired kill switch and no
>   feature flag, no duplicate-submission guard (one family, N live secrets), **two of the
>   three headline security tests assert nothing**, no admin list (so staff must browse the
>   Firestore console next to `pledge_secrets`), an undefined accounting hand-off, and no
>   record that the family ever authorized the debit.
>
> Work from v2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a family pledge a recurring monthly gift by pre-authorized debit, storing their bank details encrypted and unreachable from any UI, and purge those details in the same action that confirms the pledge.

**Architecture:** two separate top-level collections - a non-sensitive `pledges` record the family can read, and a `pledge_secrets` record holding an AES-256-GCM ciphertext that **no route returns**. A manual staff confirm flips the status and deletes the secret in one transaction. The pledge is entirely optional and gates nothing.

**Tech Stack:** Next.js 16, TypeScript, Zod, Firebase Admin Firestore, Node `crypto` (no new dependency), Vitest, Playwright.

**Depends on:** P1 (`audit_log`), P3 (`sendTemplatedEmail` / `sendManagedEmail`).

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. Specific to this plan - **these are not style preferences**:

- **No file upload.** No cheque image, no direct-deposit form. Accounting works from the four typed fields.
- **Bank details are never returned by any route**, for any role, in any shape. The access control is the absence of a read path, not a role check that can be misconfigured.
- **Bank details are never logged**, never in an error message, never sent to Sentry.
- **Pledge routes live OUTSIDE `/api/setu/*`.** That catch-all (`can-access-route.ts:311-313`) grants welcome-team by default - precisely the staff who must not see this.
- A `pending` pledge **counts as payment nowhere** - not the payment chip, not the roster, not enrollment confirmation, not any report.

---

## File Structure

- `apps/portal/src/features/setu/pledges/crypto.ts` - encrypt/decrypt only; never re-exports the key
- `apps/portal/src/features/setu/pledges/schemas.ts` - Zod shapes, bank-field validation
- `apps/portal/src/features/setu/pledges/write-pledge.ts` - submit / confirm / cancel transactions
- `apps/portal/src/features/setu/pledges/read-pledge.ts` - **non-sensitive reads only**
- `apps/portal/src/app/api/pledges/route.ts` - family submit
- `apps/portal/src/app/api/admin/pledges/[pid]/confirm/route.ts` - staff confirm
- `apps/portal/src/app/api/admin/pledges/[pid]/cancel/route.ts` - staff cancel
- `apps/portal/src/features/family/components/pledge-card.tsx` - state-driven card
- `apps/portal/scripts/export-pledge-details.ts` - the only decrypt path
- `apps/portal/scripts/purge-stale-pledge-secrets.ts` - the backstop sweep

---

### Task 1: Encryption

**Files:**
- Create: `apps/portal/src/features/setu/pledges/crypto.ts`
- Test: `apps/portal/src/features/setu/pledges/__tests__/crypto.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface BankDetails {
    bankNumber: string; transitNumber: string;
    institutionNumber: string; accountNumber: string;
  }
  export interface EncryptedPayload {
    encryptedPayload: string; iv: string; authTag: string; keyVersion: number;
  }
  export function encryptBankDetails(details: BankDetails): EncryptedPayload
  export function decryptBankDetails(payload: EncryptedPayload): BankDetails
  ```

- [ ] **Step 1: Write the failing test**

```ts
const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const DETAILS = {
  bankNumber: '001', transitNumber: '12345',
  institutionNumber: '003', accountNumber: '1234567',
};

describe('bank detail encryption', () => {
  beforeEach(() => { process.env.PLEDGE_ENCRYPTION_KEY = KEY_A; });

  it('round-trips exactly', () => {
    expect(decryptBankDetails(encryptBankDetails(DETAILS))).toEqual(DETAILS);
  });

  it('produces different ciphertext each time (unique iv)', () => {
    const a = encryptBankDetails(DETAILS);
    const b = encryptBankDetails(DETAILS);
    expect(a.encryptedPayload).not.toBe(b.encryptedPayload);
    expect(a.iv).not.toBe(b.iv);
  });

  it('never leaks plaintext into the stored payload', () => {
    const enc = encryptBankDetails(DETAILS);
    const blob = JSON.stringify(enc);
    expect(blob).not.toContain('1234567');
    expect(blob).not.toContain('12345');
  });

  it('FAILS CLOSED under the wrong key - never returns garbage', () => {
    const enc = encryptBankDetails(DETAILS);
    process.env.PLEDGE_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptBankDetails(enc)).toThrow();
  });

  it('FAILS CLOSED on a tampered ciphertext', () => {
    const enc = encryptBankDetails(DETAILS);
    const tampered = { ...enc, encryptedPayload: Buffer.from('nonsense').toString('base64') };
    expect(() => decryptBankDetails(tampered)).toThrow();
  });

  it('throws a clear error when the key is absent', () => {
    delete process.env.PLEDGE_ENCRYPTION_KEY;
    expect(() => encryptBankDetails(DETAILS)).toThrow(/PLEDGE_ENCRYPTION_KEY/);
  });
});
```

Tests 4 and 5 are why GCM is chosen over CBC: it authenticates, so a wrong key or a tampered payload **throws** instead of returning plausible-looking rubbish that could be forwarded to accounting.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- pledges/crypto`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

```ts
import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface BankDetails {
  bankNumber: string;
  transitNumber: string;
  institutionNumber: string;
  accountNumber: string;
}

export interface EncryptedPayload {
  encryptedPayload: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;

/**
 * Application-level encryption for bank details.
 *
 * Firestore encrypts at rest, but that protects against a stolen disk - not
 * against an Admin-SDK read, a console browse, an over-broad service account,
 * or a future query that accidentally returns the field. Encrypting here means
 * a database leak yields ciphertext.
 *
 * GCM (not CBC) so decryption is authenticated: a wrong key or a tampered
 * payload throws rather than returning plausible rubbish that might then be
 * forwarded to accounting as if it were a real account number.
 *
 * The key is read per call and never re-exported. If PLEDGE_ENCRYPTION_KEY is
 * ever lost, every stored pledge becomes permanently unreadable - it must be
 * backed up before the first real submission.
 */
function key(): Buffer {
  const raw = process.env.PLEDGE_ENCRYPTION_KEY;
  if (!raw) throw new Error('[pledges] PLEDGE_ENCRYPTION_KEY is required');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('[pledges] PLEDGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return buf;
}

export function encryptBankDetails(details: BankDetails): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  return {
    encryptedPayload: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function decryptBankDetails(payload: EncryptedPayload): BankDetails {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedPayload, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8')) as BankDetails;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- pledges/crypto`
Expected: PASS, all six.

- [ ] **Step 5: Provision the key**

Generate `openssl rand -base64 32`, set `PLEDGE_ENCRYPTION_KEY` on Vercel Production with `--value` (stdin is ignored for agents and silently stores empty - verify with `vercel env pull`), add it to `turbo.json`'s env array, and **back it up somewhere CMT Developer controls before any real submission.**

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/setu/pledges/crypto.ts \
        apps/portal/src/features/setu/pledges/__tests__/crypto.test.ts turbo.json
git commit -m "feat(pledges): AES-256-GCM encryption for bank details

Firestore's at-rest encryption does not protect against an Admin-SDK read or
a console browse, so bank details are encrypted in the application before the
write. GCM rather than CBC so decryption is authenticated: a wrong key or a
tampered payload throws instead of returning plausible rubbish that might be
forwarded to accounting as a real account number.

No new dependency - node:crypto. The key is read per call and never
re-exported."
```

---

### Task 2: Schemas and the data model

**Files:**
- Create: `apps/portal/src/features/setu/pledges/schemas.ts`
- Test: `apps/portal/src/features/setu/pledges/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `BankDetails` (Task 1)
- Produces:
  ```ts
  export const PLEDGE_STATUSES = ['pending', 'active', 'cancelled'] as const;
  export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];
  export const SubmitPledgeSchema: z.ZodType<{ monthlyAmount: number } & BankDetails>;
  export const PledgeDocSchema: z.ZodType<PledgeDoc>;
  export interface PledgeDoc {
    pid: string; fid: string; monthlyAmount: number; status: PledgeStatus;
    submittedAt: Date; confirmedAt: Date | null; cancelledAt: Date | null;
    submittedByMid: string;
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
it('rejects an amount below the configured minimum', () => {
  expect(SubmitPledgeSchema.safeParse({ ...VALID, monthlyAmount: 25 }).success).toBe(false);
});

it('accepts the minimum exactly', () => {
  expect(SubmitPledgeSchema.safeParse({ ...VALID, monthlyAmount: 50 }).success).toBe(true);
});

it.each([
  ['institutionNumber', '3'],      // must be 3 digits
  ['transitNumber', '123'],        // must be 5 digits
  ['accountNumber', 'abcdefg'],    // digits only
])('rejects a malformed %s', (field, bad) => {
  expect(SubmitPledgeSchema.safeParse({ ...VALID, [field]: bad }).success).toBe(false);
});

it('PledgeDoc carries NO bank fields at all', () => {
  // The family-readable record must be structurally incapable of holding a
  // bank detail, so no future field addition can leak one into a UI read.
  const keys = Object.keys(PledgeDocSchema.shape);
  for (const banned of ['bankNumber', 'transitNumber', 'institutionNumber', 'accountNumber', 'encryptedPayload']) {
    expect(keys).not.toContain(banned);
  }
});
```

The last test enforces the separation structurally rather than by convention.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- pledges/schemas`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Define both schemas. Bank-field shapes per Canadian convention - 3-digit institution, 5-digit transit, digits-only account (confirm against O7 in the spec before finalising). Read the minimum from `app_config/pledge`, defaulting to `50`.

> Per repo rule, **never** add `.min(1)`-style constraints to a doc schema for a *new required field* - doc schemas validate on **read**, and a tightened rule breaks every pre-existing document. `SubmitPledgeSchema` (a write schema) is where strictness belongs; `PledgeDocSchema` stays permissive.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- pledges/schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/pledges/schemas.ts \
        apps/portal/src/features/setu/pledges/__tests__/schemas.test.ts
git commit -m "feat(pledges): schemas with bank fields confined to the write shape

PledgeDoc - the family-readable record - is structurally incapable of holding
a bank detail, enforced by a test rather than by convention. Strictness lives
in the write schema; the doc schema stays permissive because doc schemas
validate on read."
```

---

### Task 3: Submit, confirm and cancel

**Files:**
- Create: `apps/portal/src/features/setu/pledges/write-pledge.ts`
- Test: `apps/portal/src/features/setu/pledges/__tests__/write-pledge.test.ts`

**Interfaces:**
- Consumes: `encryptBankDetails` (Task 1), schemas (Task 2), `writeAuditLog` (P1 Task 5)
- Produces:
  ```ts
  export async function submitPledge(args: { fid: string; mid: string; input: SubmitPledgeInput }): Promise<{ pid: string }>
  export async function confirmPledge(args: { pid: string; actor: AuditActor }): Promise<{ fid: string; monthlyAmount: number; email: string | null }>
  export async function cancelPledge(args: { pid: string; actor: AuditActor }): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('submitPledge', () => {
  it('writes the pledge and the secret in ONE transaction', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    expect((await readPledgeDoc(pid)).status).toBe('pending');
    expect(await readSecretDoc(pid)).not.toBeNull();
  });

  it('stores no plaintext bank detail anywhere', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    const blob = JSON.stringify({ ...(await readPledgeDoc(pid)), ...(await readSecretDoc(pid)) });
    expect(blob).not.toContain(VALID.accountNumber);
  });
});

describe('confirmPledge', () => {
  it('flips to active AND deletes the secret in one transaction', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    await confirmPledge({ pid, actor: ADMIN_ACTOR });
    expect((await readPledgeDoc(pid)).status).toBe('active');
    expect(await readSecretDoc(pid)).toBeNull();   // purge is the same action
  });

  it('writes an audit row', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    await confirmPledge({ pid, actor: ADMIN_ACTOR });
    expect(await auditRowsFor(pid)).toHaveLength(1);
  });

  it('never leaves a status flip without a purge', async () => {
    // A failed transaction must leave BOTH untouched - never an active pledge
    // whose bank details survive, and never a purge without a confirmation.
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    failNextTransaction();
    await expect(confirmPledge({ pid, actor: ADMIN_ACTOR })).rejects.toThrow();
    expect((await readPledgeDoc(pid)).status).toBe('pending');
    expect(await readSecretDoc(pid)).not.toBeNull();
  });

  it('is idempotent - confirming twice does not throw or duplicate audit rows', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    await confirmPledge({ pid, actor: ADMIN_ACTOR });
    await confirmPledge({ pid, actor: ADMIN_ACTOR });
    expect(await auditRowsFor(pid)).toHaveLength(1);
  });
});

describe('cancelPledge', () => {
  it('purges the secret too', async () => {
    const { pid } = await submitPledge({ fid: 'CMT-A', mid: 'CMT-A-01', input: VALID });
    await cancelPledge({ pid, actor: ADMIN_ACTOR });
    expect((await readPledgeDoc(pid)).status).toBe('cancelled');
    expect(await readSecretDoc(pid)).toBeNull();
  });
});
```

The atomicity test is the important one: an active pledge whose bank details survived would be exactly the retention failure this design exists to prevent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- write-pledge`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Each of the three runs in a single `runTransaction`. `confirmPledge` sets `status: 'active'` + `confirmedAt`, **deletes** `pledge_secrets/{pid}`, and calls `writeAuditLog` with the same transaction. It returns the family email so the caller can send the activation mail **after** the transaction commits.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- write-pledge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/features/setu/pledges/write-pledge.ts \
        apps/portal/src/features/setu/pledges/__tests__/write-pledge.test.ts
git commit -m "feat(pledges): submit, confirm and cancel with purge-on-confirm

Confirmation flips the status and deletes the bank details in the SAME
transaction, so the data cannot outlive its purpose by accident - the only
thing that ends its usefulness is the same call that removes it. Cancel does
the same. A test pins that a failed transaction leaves both records
untouched: never an active pledge whose bank details survived."
```

---

### Task 4: The routes

**Files:**
- Create: `apps/portal/src/app/api/pledges/route.ts`
- Create: `apps/portal/src/app/api/admin/pledges/[pid]/confirm/route.ts`
- Create: `apps/portal/src/app/api/admin/pledges/[pid]/cancel/route.ts`
- Modify: `packages/shared-domain/src/auth/can-access-route.ts`
- Test: each route + `can-access-route`

**Interfaces:**
- Consumes: Task 3's functions, `sendManagedEmail` (P3 Task 2)
- Produces: three endpoints

- [ ] **Step 1: Write the failing test**

The security assertions come first - they matter more than the happy path:

```ts
describe('pledge route security', () => {
  it.each([
    ['welcome-team'], ['coordinator'], ['teacher'], ['family-member'], ['admin'],
  ])('no route returns bank details to %s', async (role) => {
    const { pid } = await seedPendingPledge('CMT-A');
    const res = await GET_ANY_PLEDGE_ROUTE(pid, role);
    const body = JSON.stringify(await res.json().catch(() => ({})));
    for (const banned of ['bankNumber', 'transitNumber', 'institutionNumber', 'accountNumber', 'encryptedPayload']) {
      expect(body).not.toContain(banned);
    }
  });

  it('confirm is admin-only - welcome-team and coordinator are refused', async () => {
    expect((await POST_CONFIRM(pid, WELCOME)).status).toBe(403);
    expect((await POST_CONFIRM(pid, COORDINATOR)).status).toBe(403);
    expect((await POST_CONFIRM(pid, ADMIN)).status).toBe(200);
  });

  it('a family cannot submit a pledge for another family', async () => {
    const res = await POST_SUBMIT({ ...VALID }, { ...MANAGER, 'x-portal-fid': 'CMT-OTHER' });
    const written = await lastPledge();
    expect(written.fid).toBe('CMT-OTHER');   // always the SESSION fid, never a body field
  });
});

describe('activation email', () => {
  it('a failed email does NOT roll back the confirmation', async () => {
    sendManagedEmail.mockRejectedValue(new Error('SES down'));
    const res = await POST_CONFIRM(pid, ADMIN);
    expect(res.status).toBe(200);
    expect((await readPledgeDoc(pid)).status).toBe('active');
  });
});
```

The last test matters because by the time the email is attempted, the pledge is active and the bank details are already gone - there is nothing to roll back to.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- api/pledges api/admin/pledges`
Expected: FAIL - routes missing.

- [ ] **Step 3: Implement the submit route**

`POST /api/pledges`, manager-only. `fid` comes from the **session**, never the body. Validate with `SubmitPledgeSchema`, call `submitPledge`, return `{ ok: true, pid }`. Return **no** bank data. Wrap the handler so a validation error message can never echo a submitted bank value back to the client.

- [ ] **Step 4: Implement confirm and cancel**

Admin-only (spec O2, the conservative default for a financial action). `confirmPledge`, then `sendManagedEmail({ name: 'pledge-activated', ... })` **outside** the transaction, inside its own try/catch that logs and swallows. Cancel is the same shape without the email.

- [ ] **Step 5: Add the canAccessRoute rules**

```ts
  // Pledges (2026-07-25). Deliberately OUTSIDE /api/setu/*, whose catch-all
  // grants welcome-team - exactly the staff who must never reach bank details.
  // Submission is manager-only; confirm/cancel are admin-only and are matched
  // by the existing /api/admin/ rule, so they need no clause here.
  if (pathname === '/api/pledges' || pathname.startsWith('/api/pledges/')) {
    return isSetuManager(claims);
  }
```

Add denial tests for welcome-team, coordinator and teacher on `/api/pledges`, and for welcome-team and coordinator on `/api/admin/pledges/*`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- pledges && pnpm --filter @cmt/shared-domain test -- can-access-route`
Expected: PASS.

- [ ] **Step 7: Mobile API changelog + runbook**

Add a dated changelog entry for `POST /api/pledges`. Add `pledges` and `pledge_secrets` to runbook §3, `PLEDGE_ENCRYPTION_KEY` to §9, and a dated §14 entry.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/app/api/pledges/ apps/portal/src/app/api/admin/pledges/ \
        packages/shared-domain/src/auth/can-access-route.ts \
        apps/portal/docs/MOBILE_API_CHANGELOG.md docs/runbooks/production-cutover-checklist.md
git commit -m "feat(pledges): submit, confirm and cancel endpoints

Routes live OUTSIDE /api/setu/* because that catch-all grants welcome-team -
precisely the staff who must never see bank details. Submission is
manager-only with fid taken from the session; confirm and cancel are
admin-only.

A parameterised test asserts that NO route returns a bank field to ANY role,
including admin. A failed activation email cannot roll back the confirmation:
by then the pledge is active and the details are already purged."
```

---

### Task 5: The state-driven card

**Files:**
- Create: `apps/portal/src/features/family/components/pledge-card.tsx`
- Modify: `apps/portal/src/app/family/donate/success/page.tsx`
- Modify: the family dashboard / `/family/donations`
- Test: `apps/portal/src/features/family/components/__tests__/pledge-card.test.tsx`

**Interfaces:**
- Consumes: `PledgeDoc` (Task 2)
- Produces: `<PledgeCard pledge={PledgeDoc | null} />`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the ask when there is no pledge', () => {
  render(<PledgeCard pledge={null} />);
  expect(screen.getByText(/support the mission monthly/i)).toBeInTheDocument();
});

it('shows a processing state while pending - not the ask', () => {
  render(<PledgeCard pledge={{ ...BASE, status: 'pending' }} />);
  expect(screen.getByText(/setting up/i)).toBeInTheDocument();
  expect(screen.queryByText(/support the mission monthly/i)).not.toBeInTheDocument();
});

it('shows the active amount and date', () => {
  render(<PledgeCard pledge={{ ...BASE, status: 'active', monthlyAmount: 50 }} />);
  expect(screen.getByText(/\$50/)).toBeInTheDocument();
});

it('returns to the ask after cancellation', () => {
  render(<PledgeCard pledge={{ ...BASE, status: 'cancelled' }} />);
  expect(screen.getByText(/support the mission monthly/i)).toBeInTheDocument();
});

it('never renders a bank field even if one is somehow present', () => {
  render(<PledgeCard pledge={{ ...BASE, status: 'active', accountNumber: '1234567' } as never} />);
  expect(screen.queryByText('1234567')).not.toBeInTheDocument();
});

it('offers no cancel or change control in v1', () => {
  render(<PledgeCard pledge={{ ...BASE, status: 'active' }} />);
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- pledge-card`
Expected: FAIL - component missing.

- [ ] **Step 3: Implement**

Render the four states from spec §5.1. **Read-only** - no cancel or change control in v1; families contact the temple. The card reads `PledgeDoc` only, so it cannot render a bank field.

- [ ] **Step 4: Place it**

**Primary:** the donation success page, quiet copy, **after** the adult-class selection (P4) so the free requirement is completed before a money ask.
**Secondary:** the family dashboard / `/family/donations`.
Suppress the ask on the success page when a pledge already exists - at most one acknowledgement line.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- pledge-card`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/features/family/components/pledge-card.tsx \
        apps/portal/src/app/family/donate/success/ apps/portal/src/app/family/
git commit -m "feat(pledges): state-driven pledge card

The card transforms rather than disappearing: verification is manual and may
take days, and hiding the only surface that mentions pledges would leave a
family with nowhere to check. Reads the non-sensitive PledgeDoc only, so it
cannot render a bank field. Read-only in v1."
```

---

### Task 6: The accounting export and the backstop sweep

**Files:**
- Create: `apps/portal/scripts/export-pledge-details.ts`
- Create: `apps/portal/scripts/purge-stale-pledge-secrets.ts`
- Test: `apps/portal/scripts/__tests__/purge-stale-pledge-secrets.test.ts`

**Interfaces:**
- Consumes: `decryptBankDetails` (Task 1)
- Produces: two CLI scripts

- [ ] **Step 1: Write the failing test for the sweep**

```ts
it('purges secrets for pledges pending longer than the window', async () => {
  await seedPledge({ pid: 'p-old', status: 'pending', submittedAt: daysAgo(120) });
  await seedPledge({ pid: 'p-new', status: 'pending', submittedAt: daysAgo(10) });

  await purgeStalePledgeSecrets({ olderThanDays: 90, commit: true });

  expect(await readSecretDoc('p-old')).toBeNull();
  expect(await readSecretDoc('p-new')).not.toBeNull();
});

it('keeps the pledge record itself - only the secret is purged', async () => {
  await seedPledge({ pid: 'p-old', status: 'pending', submittedAt: daysAgo(120) });
  await purgeStalePledgeSecrets({ olderThanDays: 90, commit: true });
  expect(await readPledgeDoc('p-old')).not.toBeNull();
});

it('dry-run by default writes nothing', async () => {
  await seedPledge({ pid: 'p-old', status: 'pending', submittedAt: daysAgo(120) });
  await purgeStalePledgeSecrets({ olderThanDays: 90 });
  expect(await readSecretDoc('p-old')).not.toBeNull();
});
```

The sweep exists because confirm and cancel are the only other purge paths, so a **forgotten** pledge would otherwise hold real bank account numbers indefinitely - the likeliest failure mode, not the rarest.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- purge-stale-pledge-secrets`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement both scripts**

Both follow repo script conventions: UAT-guarded, `--dry-run` default, `--allow-prod` to override, and a `pnpm` alias using `tsx --env-file=.env.local`.

`export-pledge-details.ts` is the **only** decrypt path. It writes the decrypted rows to a local file for the accounting hand-off and records an audit row naming who ran it and when.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cmt/portal test -- purge-stale-pledge-secrets`
Expected: PASS.

- [ ] **Step 5: Runbook**

Add both scripts to §10, the sweep as a recurring operational step, and a dated §14 entry. Document the accounting hand-off: who runs the export, how the decrypted file is transmitted, and how it is destroyed afterwards (spec O6).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/scripts/export-pledge-details.ts \
        apps/portal/scripts/purge-stale-pledge-secrets.ts \
        apps/portal/package.json docs/runbooks/production-cutover-checklist.md
git commit -m "feat(pledges): accounting export and the stale-secret sweep

The export script is the only decrypt path - deliberately a guarded CLI act,
not a page, and it audits who ran it. The sweep exists because confirm and
cancel are the only other purge paths, so a forgotten pledge would otherwise
hold real account numbers indefinitely. It purges the secret and keeps the
pledge record, so nothing is lost operationally."
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Seed the config**

Create `app_config/pledge` in UAT: `{ enabled: true, minMonthlyAmount: 50, suggestedAmounts: [50, 100, 200] }`.

- [ ] **Step 2: Playwright E2E**

Create `apps/portal/e2e/setu/family/pledge.spec.ts`:
- password sign-in as a family manager
- complete a Bala Vihar donation, land on the success page, see the pledge ask **after** the adult-class selection
- submit a pledge with valid bank details
- assert the card shows **pending**
- call the admin confirm endpoint as admin
- assert the card shows **active** and `pledge_secrets/{pid}` is **gone**
- assert no page and no API response anywhere contains a bank field
- clean up

Run: `pnpm test:e2e -- pledge`

- [ ] **Step 3: N=2**

Seed a family with two pledges over time - one cancelled, one active - and assert the card renders the active one. A single-pledge fixture cannot catch a component that picks "the first pledge".

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: PASS. Required before pushing shared route or schema changes.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/e2e/setu/family/pledge.spec.ts
git commit -m "test(pledges): deployed-UAT end-to-end coverage

Walks submit through confirm against real UAT, asserting the secret is gone
after confirmation and that no page or API response anywhere exposes a bank
field. Includes the N=2 case - a family with a cancelled and an active
pledge - which a single-pledge fixture cannot catch."
```

---

## Self-Review

**Spec coverage** - `2026-07-25-monthly-pledge-pad-design.md`:
- §2 all locked decisions → Tasks 1-6 ✅
- §3 no upload → nothing built; stated in Global Constraints ✅
- §4.1 `pledges` doc → Task 2 ✅
- §4.2 `pledge_secrets`, no read path, outside `/api/setu/*` → Tasks 2, 4 ✅
- §4.3 AES-256-GCM, key version, key custody → Task 1 ✅
- §4.4 `app_config/pledge` → Tasks 2, 7 ✅
- §5 placement, §5.1 state-driven card → Task 5 ✅
- §6.1 submit → Tasks 3, 4 ✅
- §6.2 confirm + purge + audit → Task 3 ✅
- §6.3 cancel → Task 3 ✅
- §6.4 backstop sweep → Task 6 ✅
- §7 SES-managed activation email → Task 4 Step 4 (mechanism from P3) ✅
- §8 security posture → Tasks 1, 4 ✅
- §10.1-10.7 verification → Tasks 1-7 ✅

> **§6.4's stale-pledge report** (list anything pending beyond ~14 days so a human notices before the sweep fires) is **not** built here. The sweep covers the data risk; the report is operational visibility. Flagged for the reviewer to confirm it is acceptable to defer, since without it the first signal is a silent purge 90 days later.

**Placeholder scan:** no TBD/TODO. Task 2 Step 3 defers exact bank-field digit lengths to spec O7 while shipping the Canadian-convention defaults - a real instruction with a working default, not a gap.

**Type consistency:** `BankDetails` / `EncryptedPayload` (Task 1) are consumed in Tasks 3 and 6. `PledgeStatus` / `PledgeDoc` (Task 2) appear in Tasks 3, 4 and 5 with identical members. `AuditActor` matches P1 Task 5's exported shape. `sendManagedEmail({ name: 'pledge-activated' })` matches the `ManagedEmailName` member P3 Task 2 defines.

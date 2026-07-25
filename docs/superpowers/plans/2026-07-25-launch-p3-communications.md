# P3 - Communications: SES Templates & SMS Sign-in Posture - Implementation Plan

> # ⛔ SUPERSEDED 2026-07-25 - DO NOT IMPLEMENT THIS FILE
>
> Replaced by **`2026-07-25-launch-p3-communications-v2.md`**.
>
> Reviewed as REQUEST CHANGES: 3 critical, 7 major, 6 minor
> (`docs/superpowers/reviews/2026-07-25-review-p3.md`).
>
> The three that make it unimplementable as written:
>
> 1. **Task 3's migration point does not exist**, and the file that does is the shared
>    three-way dispatcher - rewriting its body would route **`otp-code` through the
>    managed SES path**, the one outcome the whole plan exists to prevent. `sendOtpEmail`,
>    which Task 4 tests against, does not exist anywhere.
> 2. **`sendTemplatedEmail` and `SendTemplatedEmailArgs` already exist** with incompatible
>    shapes, two call sites, and three test files that `vi.mock` them by name. Task 1 would
>    have shipped two exports under one name meaning opposite things.
> 3. **The register→sign-in phone handoff becomes a hard dead end.** `sign-in/page.tsx:184`
>    deliberately suppresses the saved password preference for a handoff, so a family
>    matched on phone gets an OTP they can never receive with no fallback.
>
> Task 4's OTP "pin" is also a tautology that cannot fail. Work from v2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** move every non-OTP email onto AWS-SES-managed templates with a code fallback, and make SMS sign-in fail with a clear message instead of a silent nothing.

**Architecture:** a new `sendTemplatedEmail` joins the `Sender` interface so templated sends still pass through the existing allowlist, redirect and mock machinery. A per-email registry maps a logical email to its SES template name; when no name is configured, or SES reports the template missing, the existing in-code template is used instead. SMS sign-in is refused at the route with a typed error and surfaced in the UI, behind a flag that restores it when AWS SNS eventually leaves the sandbox.

**Tech Stack:** `@aws-sdk/client-ses` (SES v1 classic), Next.js 16, TypeScript, Zod, Vitest.

## Global Constraints

See `2026-07-25-aug-3-launch-INDEX.md` § Global Constraints. Specific to this plan:

- **OTP email is exempt from the SES migration, permanently.** It is the sign-in path for every family; a renamed SES template would lock everyone out. Task 2 pins this with a test.
- **Never call `ses.ts` directly.** Everything goes through `resolveSender()`, which holds the UAT allowlist, the redirect-to-test-address branch and the mock. Bypassing it mails real families from a test run.
- Any `/api/setu/**` shape or error-code change needs a dated entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.

**Measured environment state (2026-07-24), which is why Task 5 exists:**
- AWS **SES** is production-ready: `ca-central-1`, out of sandbox, 50,000/day, domain and FROM address verified.
- AWS **SNS** is **not**: still in the sandbox, `$1` monthly spend limit, **zero origination numbers**. SMS reaches nobody, and sandbox exit is an AWS/carrier review measured in business days to weeks.
- The legacy roster is **100% email-reachable**: 867 families, 767 with both email and phone, 100 email-only, **zero phone-only**. Refusing SMS sign-in locks nobody out.

---

## File Structure

- `apps/portal/src/lib/aws/ses.ts` - add `sendTemplatedEmail`
- `apps/portal/src/lib/aws/resolve-sender.ts` - extend `Sender`, route the new method through the safety nets
- `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts` - mock support
- `apps/portal/src/lib/aws/email-templates-config.ts` - NEW: logical email → SES template name
- `apps/portal/src/lib/aws/send-managed-email.ts` - NEW: the try-SES-then-fallback decision, in one place
- `apps/portal/src/app/api/setu/auth/send-code/route.ts` - refuse SMS
- `apps/portal/src/app/api/setu/auth/verify-code/route.ts` - mirror the refusal
- `apps/portal/src/app/sign-in/page.tsx` - surface it
- `apps/portal/src/lib/flags.ts` - `smsOtp` flag

---

### Task 1: `sendTemplatedEmail` and the Sender interface

**Files:**
- Modify: `apps/portal/src/lib/aws/ses.ts`
- Modify: `apps/portal/src/lib/aws/resolve-sender.ts:7-8`
- Modify: `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts`
- Test: `apps/portal/src/lib/aws/__tests__/ses.test.ts`, `apps/portal/src/lib/aws/__tests__/resolve-sender.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface SendTemplatedEmailArgs {
    to: string;
    templateName: string;
    data: Record<string, string | number>;
  }
  export async function sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void>
  // Sender gains: sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void>
  export class SesTemplateNotFoundError extends Error {}
  ```

- [ ] **Step 0: Read the current SDK docs before writing the call**

The repo depends on `@aws-sdk/client-ses` (SES v1 classic). Its templated-send command is `SendTemplatedEmailCommand`, taking `Template` and `TemplateData` (a JSON **string**). **Confirm the exact command name and argument shape against the current AWS SDK documentation before writing it** rather than trusting this plan or training data. Note the error code SES returns for a missing template - Task 2 keys its fallback on it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
import { sendTemplatedEmail } from '../ses';

const ses = mockClient(SESClient);
beforeEach(() => { ses.reset(); process.env.AWS_SES_FROM_EMAIL = 'from@chinmayatoronto.org'; });

describe('sendTemplatedEmail', () => {
  it('invokes the named SES template with JSON-encoded data', async () => {
    ses.on(SendTemplatedEmailCommand).resolves({ MessageId: 'm-1' });
    await sendTemplatedEmail({
      to: 'family@example.com',
      templateName: 'PledgeActivated',
      data: { familyName: 'Rana', monthlyAmount: 50 },
    });
    const call = ses.commandCalls(SendTemplatedEmailCommand)[0]!;
    expect(call.args[0].input).toMatchObject({
      Source: 'from@chinmayatoronto.org',
      Destination: { ToAddresses: ['family@example.com'] },
      Template: 'PledgeActivated',
    });
    expect(JSON.parse(call.args[0].input.TemplateData as string))
      .toEqual({ familyName: 'Rana', monthlyAmount: 50 });
  });

  it('throws SesTemplateNotFoundError when the template is missing', async () => {
    ses.on(SendTemplatedEmailCommand).rejects(
      Object.assign(new Error('Template does not exist'), { name: 'TemplateDoesNotExistException' }),
    );
    await expect(
      sendTemplatedEmail({ to: 'a@b.com', templateName: 'Nope', data: {} }),
    ).rejects.toBeInstanceOf(SesTemplateNotFoundError);
  });

  it('rethrows any other SES failure unchanged', async () => {
    ses.on(SendTemplatedEmailCommand).rejects(
      Object.assign(new Error('Throttled'), { name: 'ThrottlingException' }),
    );
    await expect(
      sendTemplatedEmail({ to: 'a@b.com', templateName: 'X', data: {} }),
    ).rejects.not.toBeInstanceOf(SesTemplateNotFoundError);
  });
});
```

The third test is what keeps the Task 2 fallback narrow: a throttle must stay distinguishable from a missing template.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- ses.test`
Expected: FAIL - `sendTemplatedEmail` is not exported.

- [ ] **Step 3: Implement**

Add to `ses.ts`, reusing the existing module-cached `client()`:

```ts
export interface SendTemplatedEmailArgs {
  to: string;
  templateName: string;
  data: Record<string, string | number>;
}

/** SES reported the named template does not exist. Distinct from every other
 *  failure so the caller can fall back to an in-code template WITHOUT also
 *  swallowing throttles, auth errors or network faults. */
export class SesTemplateNotFoundError extends Error {
  constructor(templateName: string) {
    super(`[aws/ses] template not found: ${templateName}`);
    this.name = 'SesTemplateNotFoundError';
  }
}

export async function sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void> {
  const from = process.env.AWS_SES_FROM_EMAIL;
  if (!from) throw new Error('[aws/ses] AWS_SES_FROM_EMAIL is required');
  try {
    await client().send(
      new SendTemplatedEmailCommand({
        Source: from,
        Destination: { ToAddresses: [args.to] },
        Template: args.templateName,
        TemplateData: JSON.stringify(args.data),
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === 'TemplateDoesNotExistException') {
      throw new SesTemplateNotFoundError(args.templateName);
    }
    throw err;
  }
}
```

Use whatever error name Step 0 confirmed if it differs.

- [ ] **Step 4: Extend the Sender interface**

In `resolve-sender.ts`, add `sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void>` to `Sender`, and implement it in the real sender with the **same** allowlist and redirect branches the existing `sendEmail` uses. Add a mock implementation in `mock-sender.ts` that records the call without touching AWS.

Add a `resolve-sender` test asserting a templated send is redirected when `SETU_EMAIL_REDIRECT_TO` is set, and dropped when an allowlist excludes the recipient - the same guarantees `sendEmail` already carries.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- ses resolve-sender mock-sender`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/lib/aws/ apps/portal/src/features/check-in/shared/notifications/mock-sender.ts
git commit -m "feat(email): add sendTemplatedEmail for AWS-managed SES templates

Invokes a template by name with JSON data instead of an inline subject and
body. Added to the Sender interface so templated sends still pass through
the allowlist, redirect and mock machinery - a direct ses.ts call would
bypass all three and mail real families from a test run.

A missing template raises SesTemplateNotFoundError, distinct from every
other SES failure, so the fallback that lands next can be narrow."
```

---

### Task 2: The template registry and the narrow fallback

**Files:**
- Create: `apps/portal/src/lib/aws/email-templates-config.ts`
- Create: `apps/portal/src/lib/aws/send-managed-email.ts`
- Test: `apps/portal/src/lib/aws/__tests__/send-managed-email.test.ts`

**Interfaces:**
- Consumes: `sendTemplatedEmail`, `SesTemplateNotFoundError` (Task 1); `renderEmailTemplate` (existing)
- Produces:
  ```ts
  export type ManagedEmailName =
    | 'payment-reminder' | 'donation-thank-you' | 'setu-invite'
    | 'setu-join-request' | 'pledge-activated';
  export async function sendManagedEmail(args: {
    to: string;
    name: ManagedEmailName;
    data: Record<string, string | number>;
    fallback?: () => { subject: string; text: string; html: string };
  }): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

```ts
describe('sendManagedEmail', () => {
  it('uses the SES template when one is configured', async () => {
    configureTemplate('payment-reminder', 'PaymentReminder');
    await sendManagedEmail({ to: 'a@b.com', name: 'payment-reminder', data: { familyName: 'Rana' }, fallback });
    expect(sender.sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'PaymentReminder' }),
    );
    expect(sender.sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to the code template when NO template name is configured', async () => {
    configureTemplate('payment-reminder', undefined);
    await sendManagedEmail({ to: 'a@b.com', name: 'payment-reminder', data: {}, fallback });
    expect(sender.sendEmail).toHaveBeenCalledTimes(1);
    expect(sender.sendTemplatedEmail).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();   // expected during rollout
  });

  it('falls back AND logs an ERROR when SES says the template is missing', async () => {
    configureTemplate('payment-reminder', 'PaymentReminder');
    sender.sendTemplatedEmail.mockRejectedValue(new SesTemplateNotFoundError('PaymentReminder'));
    await sendManagedEmail({ to: 'a@b.com', name: 'payment-reminder', data: {}, fallback });
    expect(sender.sendEmail).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();  // a misconfiguration, not a design state
  });

  it('does NOT fall back on any other SES failure, and does not double-send', async () => {
    configureTemplate('payment-reminder', 'PaymentReminder');
    sender.sendTemplatedEmail.mockRejectedValue(
      Object.assign(new Error('Throttled'), { name: 'ThrottlingException' }),
    );
    await expect(
      sendManagedEmail({ to: 'a@b.com', name: 'payment-reminder', data: {}, fallback }),
    ).rejects.toThrow('Throttled');
    expect(sender.sendEmail).not.toHaveBeenCalled();
  });
});
```

The fourth test is the important one. Falling back on *every* error would turn "our email is misconfigured" into a permanently invisible condition, and the code templates would quietly become the real system while everyone believed SES was live.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cmt/portal test -- send-managed-email`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the registry**

`email-templates-config.ts` maps each `ManagedEmailName` to an SES template name read from env (one variable per email, e.g. `SES_TEMPLATE_PAYMENT_REMINDER`), returning `undefined` when unset. Add every variable to `turbo.json`'s env array - **Turborepo strips env from the build sandbox, so a missing entry passes locally and fails on Vercel.**

- [ ] **Step 4: Implement the decision**

`send-managed-email.ts` implements exactly the matrix from spec §4.1 - configured → templated send; not configured → fallback + info log; `SesTemplateNotFoundError` → fallback + **error** log; anything else → rethrow, no fallback. Keep this decision in **one** place so no call site can invent its own.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test -- send-managed-email`
Expected: PASS, all four cases.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/lib/aws/email-templates-config.ts \
        apps/portal/src/lib/aws/send-managed-email.ts \
        apps/portal/src/lib/aws/__tests__/send-managed-email.test.ts turbo.json
git commit -m "feat(email): SES template registry with a deliberately narrow fallback

Falls back to the in-code template when no SES template is configured (info)
or when SES reports it missing (error). Does NOT fall back on throttles,
auth failures or network faults - that would mask real delivery problems and
could double-send, and the code templates would silently become the real
system while everyone believed SES was live.

Template names come from env, registered in turbo.json so the Vercel build
sandbox actually receives them."
```

---

### Task 3: Migrate the four non-OTP emails

**Files:**
- Modify: `apps/portal/src/features/check-in/shared/notifications/send-email-service.ts:13`
- Modify: `apps/portal/src/app/api/setu/invite/send/route.ts:177`
- Modify: `apps/portal/src/app/api/setu/join-request/send/route.ts:69`
- Test: each route's test file

**Interfaces:**
- Consumes: `sendManagedEmail` (Task 2)
- Produces: no new types

- [ ] **Step 1: Write the failing test**

For each of the four, assert that the send goes through `sendManagedEmail` with the right `name` and the exact `data` key set. Example for the invite:

```ts
it('sends the invite through the managed-email path with the agreed variables', async () => {
  await POST(inviteReq());
  expect(sendManagedEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'setu-invite',
      data: {
        inviterName: 'Vaibhav Rana',
        familyName: 'Rana',
        relation: 'Spouse',
        acceptUrl: expect.stringContaining('/invite/'),
      },
    }),
  );
});
```

**These four data-key assertions are the variable contract.** TypeScript cannot check across the boundary into Vaibhav's SES template, so a rename on either side must fail a test here rather than silently render an email with blanks.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- invite/send join-request/send send-email-service`
Expected: FAIL - still calling the old paths.

- [ ] **Step 3: Migrate each call site**

Replace each direct `sendEmail({ ...template(props) })` with `sendManagedEmail({ to, name, data, fallback: () => template(props) })`. The **existing template function becomes the fallback** - it is not deleted.

- [ ] **Step 4: Keep the code templates and the dispatcher**

Do **not** delete any file in `lib/aws/templates/`, and do not retire `renderEmailTemplate`. They are the fallback layer now. `otp-code` continues to route through `renderEmailTemplate` exactly as today.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @cmt/portal test`
Expected: PASS. Run the full suite - integration tests live in separate directories and a targeted glob misses them.

- [ ] **Step 6: Record the variable contract**

Create `docs/runbooks/ses-email-templates.md` listing, per email: the logical name, the env variable holding its SES template name, and the **exact** variable keys the portal sends. This is what Vaibhav builds against. Link it from the cutover runbook.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/features/check-in/shared/notifications/send-email-service.ts \
        apps/portal/src/app/api/setu/invite/send/route.ts \
        apps/portal/src/app/api/setu/join-request/send/route.ts \
        docs/runbooks/ses-email-templates.md
git commit -m "feat(email): route the four non-OTP emails through SES templates

Each keeps its in-code template as the fallback, so a template that does not
exist yet degrades to today's behaviour instead of to silence. OTP is
untouched by design.

Tests pin the exact variable key set per email - that contract cannot be
type-checked across the boundary into the SES-side template, so a rename on
either side has to fail a test rather than render an email with blanks.
docs/runbooks/ses-email-templates.md is what Vaibhav builds against."
```

---

### Task 4: Pin the OTP exemption

Cheap insurance against a future well-meaning "finish the migration" that takes sign-in down.

**Files:**
- Test: `apps/portal/src/lib/aws/__tests__/otp-exemption.test.ts`

**Interfaces:** none

- [ ] **Step 1: Write the test**

```ts
it('OTP email never uses the SES-managed path, even if a template exists', async () => {
  // OTP is the sign-in path for every family. A renamed or deleted SES
  // template would lock everyone out, so the exemption is enforced in code -
  // not by the mere absence of a template.
  process.env.SES_TEMPLATE_OTP_CODE = 'OtpCode';
  await sendOtpEmail({ to: 'a@b.com', code: '123456' });
  expect(sender.sendTemplatedEmail).not.toHaveBeenCalled();
  expect(sender.sendEmail).toHaveBeenCalledTimes(1);
});

it('otp-code is not a ManagedEmailName', () => {
  const names: ManagedEmailName[] = [
    'payment-reminder', 'donation-thank-you', 'setu-invite', 'setu-join-request', 'pledge-activated',
  ];
  expect(names).not.toContain('otp-code' as never);
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @cmt/portal test -- otp-exemption`
Expected: PASS immediately - Task 3 never touched the OTP path. A failure means the migration went too far.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/src/lib/aws/__tests__/otp-exemption.test.ts
git commit -m "test(email): pin the OTP exemption from SES templates

OTP is the sign-in path for every family, so a renamed SES template would
lock everyone out. The exemption is enforced in code rather than by the
absence of a template, and this test is what stops a future well-meaning
'finish the migration' from taking sign-in down."
```

---

### Task 5: SMS sign-in is unsupported and says so

Today `POST /api/setu/auth/send-code` returns `200 {success:true}` for a phone, sends nothing deliverable, and leaves the user waiting for a code that never arrives.

**Files:**
- Modify: `apps/portal/src/lib/flags.ts`
- Modify: `apps/portal/src/app/api/setu/auth/send-code/route.ts`
- Modify: `apps/portal/src/app/api/setu/auth/verify-code/route.ts`
- Modify: `apps/portal/src/app/sign-in/page.tsx:234-254`
- Test: both route test files and the sign-in page test

**Interfaces:**
- Consumes: nothing
- Produces: `flags.smsOtp: boolean`; typed `400 { error: 'sms-signin-unsupported' }`

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a phone sign-in with a typed error while SMS OTP is off', async () => {
  const res = await POST(jsonReq({ type: 'phone', value: '4165550100' }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'sms-signin-unsupported' });
});

it('refuses BEFORE any family lookup, so it leaks nothing about who exists', async () => {
  await POST(jsonReq({ type: 'phone', value: '4165550100' }));
  expect(findSetuFamilyByContact).not.toHaveBeenCalled();
});

it('email sign-in is unaffected', async () => {
  const res = await POST(jsonReq({ type: 'email', value: 'a@b.com' }));
  expect(res.status).toBe(200);
});

it('verify-code mirrors the refusal so no attempt is burned', async () => {
  const res = await POST_VERIFY(jsonReq({ type: 'phone', value: '4165550100', code: '123456' }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'sms-signin-unsupported' });
});
```

The second test matters: the check runs on the **shape of the input**, before any lookup, so it cannot become an account-enumeration oracle.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cmt/portal test -- send-code verify-code`
Expected: FAIL - currently returns 200.

- [ ] **Step 3: Add the flag**

In `apps/portal/src/lib/flags.ts`:

```ts
  // SMS OTP sign-in. OFF: AWS SNS is in the sandbox with no origination
  // number, so SMS reaches nobody. Measured 2026-07-24: all 867 legacy
  // families have an email and none is phone-only, so email covers everyone.
  // Flip ON once SNS is out of the sandbox AND a Canadian origination number
  // is registered - at which point the +1/NANP gate becomes the live rule.
  smsOtp: process.env.NEXT_PUBLIC_FEATURE_SMS_OTP === 'true',
```

Read `process.env.NEXT_PUBLIC_FEATURE_SMS_OTP` **literally** - a helper indirection defeats Next's static inlining and the client flag silently reads false. Add it to `turbo.json`'s env array.

- [ ] **Step 4: Refuse at both routes**

In `send-code`, immediately after `bodySchema` parses and **before** the rate-limit and any family lookup:

```ts
  // Refused on input SHAPE alone, before any lookup, so this cannot become an
  // account-enumeration oracle. Returning a typed error rather than today's
  // silent 200 is the whole point: a phone user currently waits forever for a
  // code that was never deliverable.
  if (type === 'phone' && !flags.smsOtp) {
    return NextResponse.json({ error: 'sms-signin-unsupported' }, { status: 400 });
  }
```

Mirror it in `verify-code` at the same position.

- [ ] **Step 5: Surface it in the UI**

In `sign-in/page.tsx`, when the Phone tab is selected and `flags.smsOtp` is false: show an inline notice that SMS sign-in is unavailable and to use an email address instead, and block submission client-side. Keep the Phone tab **visible** - a user expecting SMS should be told why, not left hunting for a missing option. Update the hint at `:237-239` and the placeholder at `:236`.

Phone **capture** is untouched everywhere else - registration, member add/edit and profile all keep accepting any country's number for WhatsApp.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @cmt/portal test -- send-code verify-code sign-in`
Expected: PASS.

- [ ] **Step 7: Mobile API changelog**

Append a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md`: both endpoints now return `400 { error: 'sms-signin-unsupported' }` for `type: 'phone'`, and the mobile app must surface it rather than showing an OTP entry screen.

- [ ] **Step 8: Verify against deployed UAT**

Open `/sign-in`, choose Phone, and confirm the notice appears and submission is blocked. Then sign in by email and confirm it still works end to end.

- [ ] **Step 9: Commit**

```bash
git add apps/portal/src/lib/flags.ts \
        apps/portal/src/app/api/setu/auth/send-code/route.ts \
        apps/portal/src/app/api/setu/auth/verify-code/route.ts \
        apps/portal/src/app/sign-in/page.tsx \
        apps/portal/docs/MOBILE_API_CHANGELOG.md turbo.json
git commit -m "feat(auth): SMS sign-in is unsupported and now says so

send-code returned 200 for a phone, sent nothing deliverable, and left the
user waiting for a code that never arrived. Both send-code and verify-code
now return 400 sms-signin-unsupported, and the sign-in page explains it
rather than hiding the option.

Refused on input shape before any family lookup, so it cannot become an
account-enumeration oracle. Behind NEXT_PUBLIC_FEATURE_SMS_OTP (default
off) - flip it on once SNS leaves the sandbox with an origination number,
at which point the +1/NANP gate becomes the live rule.

Phone capture is untouched everywhere else; numbers are still collected for
WhatsApp."
```

---

## Self-Review

**Spec coverage** - `2026-07-25-ses-managed-email-templates-design.md`:
- §1 policy, OTP exempt → Tasks 3, 4 ✅
- §3 items 1-4 (`sendTemplatedEmail`, Sender, mock, config) → Tasks 1, 2 ✅
- §3 items 5-6 amended by §4.2 (keep templates, keep dispatcher) → Task 3 Step 4 ✅
- §4.1 the exact fallback matrix → Task 2 Step 1, all four rows ✅
- §5 operational constraints → Task 1 Step 0, Task 2 Step 3 (turbo.json) ✅
- §6.1-6.7 verification → Tasks 1-4 ✅

**Spec coverage** - `2026-07-24-aug-3-launch-batch-design.md` §8 (the gap P2's self-review flagged):
- §8.0 SMS unsupported with an explicit error, flag-gated → Task 5 ✅
- §8.2 items 1-3, 5 (both routes, UI, mobile changelog) → Task 5 ✅
- §8.3 anti-enumeration preserved → Task 5 Step 1 test 2 ✅
- §8.4 phone capture unaffected → Task 5 Step 5 ✅
- §8.2 item 4 (`sns.ts` belt-and-braces `+1` guard) → **NOT covered.** Deliberate: with SMS sign-in refused at the route, `sns.ts` is only reached by prasad reminders and join-request notices. Adding a `+1` guard there would silently drop notifications to the international numbers this batch explicitly keeps collecting. Revisit when the SMS flag is turned on.

**Placeholder scan:** no TBD/TODO. Task 1 Step 0 deliberately instructs verification against live SDK docs rather than asserting a signature from memory - that is a real instruction, not a placeholder.

**Type consistency:** `SendTemplatedEmailArgs` and `SesTemplateNotFoundError` (Task 1) are consumed in Task 2 under the same names. `ManagedEmailName` (Task 2) is used in Tasks 3 and 4 with an identical member list, and `'pledge-activated'` is included so P5 needs no change here. `flags.smsOtp` (Task 5) matches the `NEXT_PUBLIC_FEATURE_SMS_OTP` variable named in the spec.

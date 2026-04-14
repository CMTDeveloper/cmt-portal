# Slice B5 — Notifications & Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the B2/B1/B4 mock notification sender with real AWS SES/SNS-backed senders. Add email templates as TSX components rendered server-side. Wire Vercel Cron via `vercel.ts` to run a daily cache-reset job and a weekly unpaid-family reminder job. Every send is idempotent via a `lastSentAt` marker in Firestore so duplicate cron firings don't spam users.

**Architecture:** Real AWS senders live in `apps/portal/src/lib/aws/*` as server-only modules (`import 'server-only'` at the top). Templates live in `apps/portal/src/lib/aws/templates/*.tsx` and are rendered to HTML via a small server-side renderer. The existing `mockSender` in `features/check-in/shared/notifications/mock-sender.ts` stays — it's used in Vitest tests and when `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false` (the production path delegates to a `resolveSender()` function that picks mock vs real based on the flag). Cron handlers live under `/api/cron/*` and validate an `authorization: Bearer <CRON_SECRET>` header.

**Tech Stack:** Adds `@aws-sdk/client-ses@^3.700`, `@aws-sdk/client-sns@^3.700`, `@aws-sdk/client-mock@^4.0` (test-only), `@vercel/config@latest` (for `vercel.ts`). Uses Node 22 LTS. No `@react-email/render` dependency — we write a tiny in-repo renderer for the handful of templates (YAGNI, keeps the bundle small).

**Spec:** `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md` §14 (B5 detail)

**Predecessor plans:** B0, B2, B3, B1, B4.

---

## Pre-flight notes

**Working directory:** `/Users/dineshmatta/projects/chinmaya-mission-portal`

**Prerequisites:** B0 + B2 + B3 + B1 + B4 shipped.

```sh
test -f apps/portal/src/features/check-in/shared/notifications/mock-sender.ts && \
test -f apps/portal/src/app/api/check-in/admin/unpaid/route.ts && \
echo "OK" || echo "MISSING prerequisite"
```

**Feature flag:** Leave `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=false` in `.env.local` throughout this plan. The flag flips to `true` only in production after the merge, when the env var is set in Vercel and the first manual smoke test confirms the SES/SNS calls work.

**AWS env vars** must exist in `.env.local` for runtime paths even if tests mock them:

```
AWS_SES_REGION=ca-central-1
AWS_SNS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...        # UAT/dev creds — can be a stub; never called in dev because NOTIFY=false
AWS_SECRET_ACCESS_KEY=...
AWS_SES_FROM_EMAIL=bvregistration@chinmayatoronto.org
AWS_SNS_TOPIC_ARN=arn:aws:sns:ca-central-1:...:family-checkin-sms
CRON_SECRET=<16+ char random string>
```

---

## File structure overview

```
apps/portal/src/lib/aws/
  ses.ts                                                    [Task 2]
  sns.ts                                                    [Task 3]
  region.ts                                                 [Task 1]
  render-template.ts                                        [Task 4]
  resolve-sender.ts                                         [Task 5]
  templates/
    otp-code-email.tsx                                      [Task 4]
    payment-reminder-email.tsx                              [Task 4]
    donation-thank-you-email.tsx                            [Task 4]
  __tests__/
    region.test.ts                                          [Task 1]
    ses.test.ts                                             [Task 2]
    sns.test.ts                                             [Task 3]
    render-template.test.tsx                                [Task 4]
    resolve-sender.test.ts                                  [Task 5]

apps/portal/src/features/check-in/notifications/
  payment-reminder-service.ts                               [Task 7]
  send-email-service.ts                                     [Task 6]
  __tests__/
    payment-reminder-service.test.ts                        [Task 7]
    send-email-service.test.ts                              [Task 6]

apps/portal/src/app/api/check-in/notifications/
  send-email/route.ts                                       [Task 6]
  payment-reminder/route.ts                                 [Task 7]
  __tests__/
    send-email.test.ts                                      [Task 6]
    payment-reminder.test.ts                                [Task 7]

apps/portal/src/app/api/cron/
  reset-cache/route.ts                                      [Task 9]
  send-weekly-payment-reminders/route.ts                    [Task 10]
  __tests__/
    reset-cache.test.ts                                     [Task 9]
    send-weekly-payment-reminders.test.ts                   [Task 10]

vercel.ts                                                    [Task 11, NEW at repo root]
apps/portal/e2e/b5-notifications.spec.ts                    [Task 12]
README.md                                                    [Task 13]
CLAUDE.md                                                    [Task 13]
```

**Task count:** 13. **Final task pushes.**

---

## Task 1: Install AWS SDK deps + create `region.ts`

**Files:**
- Modify: `apps/portal/package.json`
- Create: `apps/portal/src/lib/aws/region.ts`
- Test: `apps/portal/src/lib/aws/__tests__/region.test.ts`

- [ ] **Step 1: Install AWS SDK and test mock**

```sh
pnpm --filter @cmt/portal add @aws-sdk/client-ses@^3.700.0 @aws-sdk/client-sns@^3.700.0
pnpm --filter @cmt/portal add -D @aws-sdk/client-mock@^4.0.0
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/portal/src/lib/aws/__tests__/region.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sesRegion, snsRegion } from '../region';

beforeEach(() => {
  delete process.env.AWS_SES_REGION;
  delete process.env.AWS_SNS_REGION;
});

describe('sesRegion', () => {
  it('returns env when set', () => {
    process.env.AWS_SES_REGION = 'us-west-2';
    expect(sesRegion()).toBe('us-west-2');
  });
  it('defaults to ca-central-1', () => {
    expect(sesRegion()).toBe('ca-central-1');
  });
});

describe('snsRegion', () => {
  it('returns env when set', () => {
    process.env.AWS_SNS_REGION = 'eu-west-1';
    expect(snsRegion()).toBe('eu-west-1');
  });
  it('defaults to us-east-1', () => {
    expect(snsRegion()).toBe('us-east-1');
  });
});
```

- [ ] **Step 3: Run — expect failure**

- [ ] **Step 4: Create `apps/portal/src/lib/aws/region.ts`**

```ts
import 'server-only';

export function sesRegion(): string {
  return process.env.AWS_SES_REGION ?? 'ca-central-1';
}

export function snsRegion(): string {
  return process.env.AWS_SNS_REGION ?? 'us-east-1';
}
```

- [ ] **Step 5: Run — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/package.json pnpm-lock.yaml apps/portal/src/lib/aws/region.ts apps/portal/src/lib/aws/__tests__/region.test.ts
git commit -m "feat(portal): install AWS SDK + region helpers (ses=ca-central-1, sns=us-east-1 defaults)"
```

---

## Task 2: `apps/portal/src/lib/aws/ses.ts` — real SES sender

**Files:**
- Create: `apps/portal/src/lib/aws/ses.ts`
- Test: `apps/portal/src/lib/aws/__tests__/ses.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/lib/aws/__tests__/ses.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { sendEmail } from '../ses';

const sesMock = mockClient(SESClient);

beforeEach(() => {
  sesMock.reset();
  process.env.AWS_SES_FROM_EMAIL = 'noreply@chinmayatoronto.org';
  process.env.AWS_SES_REGION = 'ca-central-1';
});

describe('sendEmail', () => {
  it('calls SES SendEmailCommand with correct shape', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'msg-1' });
    await sendEmail({
      to: 'a@b.com',
      subject: 'Test',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: { Subject: { Data: string }; Body: { Html: { Data: string }; Text: { Data: string } } };
    };
    expect(input.Source).toBe('noreply@chinmayatoronto.org');
    expect(input.Destination.ToAddresses).toEqual(['a@b.com']);
    expect(input.Message.Subject.Data).toBe('Test');
    expect(input.Message.Body.Html.Data).toBe('<p>Hello</p>');
    expect(input.Message.Body.Text.Data).toBe('Hello');
  });

  it('throws a descriptive error on SES failure', async () => {
    sesMock.on(SendEmailCommand).rejects(new Error('AccessDenied'));
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'T', text: 't' }),
    ).rejects.toThrow(/AccessDenied/);
  });
});
```

Install `aws-sdk-client-mock` if not already added:

```sh
pnpm --filter @cmt/portal add -D aws-sdk-client-mock@^4.0.0
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/lib/aws/ses.ts`**

```ts
import 'server-only';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { sesRegion } from './region';

let cached: SESClient | undefined;
function client(): SESClient {
  if (cached) return cached;
  cached = new SESClient({ region: sesRegion() });
  return cached;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const from = process.env.AWS_SES_FROM_EMAIL;
  if (!from) {
    throw new Error('[aws/ses] AWS_SES_FROM_EMAIL is required');
  }
  await client().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [args.to] },
      Message: {
        Subject: { Data: args.subject },
        Body: {
          Text: { Data: args.text },
          ...(args.html ? { Html: { Data: args.html } } : {}),
        },
      },
    }),
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/aws/ses.ts apps/portal/src/lib/aws/__tests__/ses.test.ts apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(portal): add SES sendEmail wrapper (server-only, singleton client)"
```

---

## Task 3: `apps/portal/src/lib/aws/sns.ts` — real SNS sender

**Files:**
- Create: `apps/portal/src/lib/aws/sns.ts`
- Test: `apps/portal/src/lib/aws/__tests__/sns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/lib/aws/__tests__/sns.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { sendSMS } from '../sns';

const snsMock = mockClient(SNSClient);

beforeEach(() => {
  snsMock.reset();
  process.env.AWS_SNS_REGION = 'us-east-1';
});

describe('sendSMS', () => {
  it('calls SNS PublishCommand with PhoneNumber and Message', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-1' });
    await sendSMS({ phone: '+16475550100', message: 'Hari OM' });
    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input as { PhoneNumber: string; Message: string };
    expect(input.PhoneNumber).toBe('+16475550100');
    expect(input.Message).toBe('Hari OM');
  });

  it('prepends + if missing', async () => {
    snsMock.on(PublishCommand).resolves({ MessageId: 'sms-2' });
    await sendSMS({ phone: '16475550100', message: 'x' });
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input as { PhoneNumber: string };
    expect(input.PhoneNumber).toBe('+16475550100');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/lib/aws/sns.ts`**

```ts
import 'server-only';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { snsRegion } from './region';

let cached: SNSClient | undefined;
function client(): SNSClient {
  if (cached) return cached;
  cached = new SNSClient({ region: snsRegion() });
  return cached;
}

export interface SendSMSArgs {
  phone: string;
  message: string;
}

export async function sendSMS(args: SendSMSArgs): Promise<void> {
  const phone = args.phone.startsWith('+') ? args.phone : `+${args.phone}`;
  await client().send(
    new PublishCommand({
      PhoneNumber: phone,
      Message: args.message,
    }),
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/aws/sns.ts apps/portal/src/lib/aws/__tests__/sns.test.ts
git commit -m "feat(portal): add SNS sendSMS wrapper (server-only, singleton client, auto + prefix)"
```

---

## Task 4: Email templates + tiny template renderer

**Files:**
- Create: `apps/portal/src/lib/aws/templates/otp-code-email.tsx`
- Create: `apps/portal/src/lib/aws/templates/payment-reminder-email.tsx`
- Create: `apps/portal/src/lib/aws/templates/donation-thank-you-email.tsx`
- Create: `apps/portal/src/lib/aws/render-template.ts`
- Test: `apps/portal/src/lib/aws/__tests__/render-template.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/portal/src/lib/aws/__tests__/render-template.test.tsx
import { describe, it, expect } from 'vitest';
import { renderEmailTemplate } from '../render-template';

describe('renderEmailTemplate', () => {
  it('renders otp-code template', () => {
    const { subject, html, text } = renderEmailTemplate('otp-code', { code: '123456' });
    expect(subject).toMatch(/verification code/i);
    expect(html).toContain('123456');
    expect(text).toContain('123456');
  });

  it('renders payment-reminder template', () => {
    const { subject, html, text } = renderEmailTemplate('payment-reminder', {
      familyName: 'Acme',
    });
    expect(subject).toMatch(/payment/i);
    expect(html).toContain('Acme');
    expect(text).toContain('Acme');
  });

  it('renders donation-thank-you template', () => {
    const { subject, html, text } = renderEmailTemplate('donation-thank-you', {
      familyName: 'Acme',
    });
    expect(subject).toMatch(/thank/i);
    expect(html).toContain('Acme');
    expect(text).toContain('Acme');
  });

  it('throws on unknown template', () => {
    expect(() =>
      // @ts-expect-error testing unknown
      renderEmailTemplate('unknown', {}),
    ).toThrow(/unknown.*template/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create the three templates**

```tsx
// apps/portal/src/lib/aws/templates/otp-code-email.tsx
import 'server-only';

export interface OtpCodeProps {
  code: string;
}

export function otpCodeEmail({ code }: OtpCodeProps) {
  return {
    subject: 'Your CMT portal verification code',
    text: `Hari OM! Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM!</p>
  <p>Your verification code is:</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; background: #f5f4f0; padding: 12px; display: inline-block">${code}</p>
  <p>This code expires in 10 minutes.</p>
</body></html>`,
  };
}
```

```tsx
// apps/portal/src/lib/aws/templates/payment-reminder-email.tsx
import 'server-only';

export interface PaymentReminderProps {
  familyName: string;
}

export function paymentReminderEmail({ familyName }: PaymentReminderProps) {
  return {
    subject: 'Payment reminder — Chinmaya Mission Toronto',
    text: `Hari OM ${familyName}! Your family check-in has been recorded. Please see a sevak at your next visit to settle your outstanding payment. Thank you for your seva.`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM ${familyName}!</p>
  <p>Your family check-in has been recorded. Please see a sevak at your next visit to settle your outstanding payment.</p>
  <p>Thank you for your seva.</p>
</body></html>`,
  };
}
```

```tsx
// apps/portal/src/lib/aws/templates/donation-thank-you-email.tsx
import 'server-only';

export interface DonationThankYouProps {
  familyName: string;
}

export function donationThankYouEmail({ familyName }: DonationThankYouProps) {
  return {
    subject: 'Thank you from Chinmaya Mission Toronto',
    text: `Dear ${familyName}, thank you for your generous donation. Your seva makes our programs possible. Hari OM!`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Dear ${familyName},</p>
  <p>Thank you for your generous donation. Your seva makes our programs possible.</p>
  <p>Hari OM!</p>
</body></html>`,
  };
}
```

- [ ] **Step 4: Create `apps/portal/src/lib/aws/render-template.ts`**

```ts
import 'server-only';
import { otpCodeEmail, type OtpCodeProps } from './templates/otp-code-email';
import { paymentReminderEmail, type PaymentReminderProps } from './templates/payment-reminder-email';
import {
  donationThankYouEmail,
  type DonationThankYouProps,
} from './templates/donation-thank-you-email';

export type TemplateName = 'otp-code' | 'payment-reminder' | 'donation-thank-you';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmailTemplate(
  name: 'otp-code',
  props: OtpCodeProps,
): RenderedEmail;
export function renderEmailTemplate(
  name: 'payment-reminder',
  props: PaymentReminderProps,
): RenderedEmail;
export function renderEmailTemplate(
  name: 'donation-thank-you',
  props: DonationThankYouProps,
): RenderedEmail;
export function renderEmailTemplate(name: TemplateName, props: unknown): RenderedEmail {
  switch (name) {
    case 'otp-code':
      return otpCodeEmail(props as OtpCodeProps);
    case 'payment-reminder':
      return paymentReminderEmail(props as PaymentReminderProps);
    case 'donation-thank-you':
      return donationThankYouEmail(props as DonationThankYouProps);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown email template: ${String(exhaustive)}`);
    }
  }
}
```

Note: the templates don't actually use JSX runtime — they return plain HTML strings. The `.tsx` extension is kept for future migration to a real JSX renderer. If the linter complains about the extension, rename the three template files to `.ts` and drop the JSX.

- [ ] **Step 5: Run test — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/lib/aws/templates/ apps/portal/src/lib/aws/render-template.ts apps/portal/src/lib/aws/__tests__/render-template.test.tsx
git commit -m "feat(portal): add email templates (otp-code, payment-reminder, donation-thank-you) + typed renderer"
```

---

## Task 5: `resolve-sender.ts` — flag-based mock/real switch

**Files:**
- Create: `apps/portal/src/lib/aws/resolve-sender.ts`
- Test: `apps/portal/src/lib/aws/__tests__/resolve-sender.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/lib/aws/__tests__/resolve-sender.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ses', () => ({ sendEmail: vi.fn() }));
vi.mock('../sns', () => ({ sendSMS: vi.fn() }));
vi.mock('@/features/check-in/shared', () => ({
  mockSender: {
    sendEmail: vi.fn(),
    sendSMS: vi.fn(),
  },
}));

import { sendEmail as realSendEmail } from '../ses';
import { sendSMS as realSendSMS } from '../sns';
import { mockSender } from '@/features/check-in/shared';
import { resolveSender } from '../resolve-sender';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY;
});

describe('resolveSender', () => {
  it('routes to mock when NOTIFY flag is false', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'false';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'a@b.com', subject: 's', text: 't' });
    expect(mockSender.sendEmail).toHaveBeenCalled();
    expect(realSendEmail).not.toHaveBeenCalled();
  });

  it('routes to real SES when NOTIFY flag is true', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    const sender = resolveSender();
    await sender.sendEmail({ to: 'a@b.com', subject: 's', text: 't' });
    expect(realSendEmail).toHaveBeenCalledWith({ to: 'a@b.com', subject: 's', text: 't' });
    expect(mockSender.sendEmail).not.toHaveBeenCalled();
  });

  it('routes SMS accordingly', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY = 'true';
    const sender = resolveSender();
    await sender.sendSMS({ phone: '+1', message: 'x' });
    expect(realSendSMS).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/lib/aws/resolve-sender.ts`**

```ts
import 'server-only';
import { sendEmail as realSendEmail, type SendEmailArgs } from './ses';
import { sendSMS as realSendSMS, type SendSMSArgs } from './sns';
import { mockSender } from '@/features/check-in/shared';

export interface ResolvedSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
}

export function resolveSender(): ResolvedSender {
  const enabled = process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY === 'true';
  if (!enabled) {
    return mockSender;
  }
  return { sendEmail: realSendEmail, sendSMS: realSendSMS };
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/lib/aws/resolve-sender.ts apps/portal/src/lib/aws/__tests__/resolve-sender.test.ts
git commit -m "feat(portal): resolveSender picks real AWS vs mockSender based on NOTIFY flag"
```

---

## Task 6: `POST /api/check-in/notifications/send-email` — generic send-email route

Renders a template, resolves the sender, dispatches the email.

**Files:**
- Create: `apps/portal/src/features/check-in/notifications/send-email-service.ts`
- Create: `apps/portal/src/app/api/check-in/notifications/send-email/route.ts`
- Test: `apps/portal/src/features/check-in/notifications/__tests__/send-email-service.test.ts`
- Test: `apps/portal/src/app/api/check-in/notifications/__tests__/send-email.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/portal/src/features/check-in/notifications/__tests__/send-email-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/aws/render-template', () => ({
  renderEmailTemplate: vi.fn((_name: string, _props: unknown) => ({
    subject: 'S',
    text: 'T',
    html: '<p>H</p>',
  })),
}));
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(() => ({ sendEmail: vi.fn(), sendSMS: vi.fn() })),
}));

import { renderEmailTemplate } from '@/lib/aws/render-template';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { sendTemplatedEmail } from '../send-email-service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendTemplatedEmail', () => {
  it('renders template and dispatches via resolved sender', async () => {
    const fakeSender = { sendEmail: vi.fn(), sendSMS: vi.fn() };
    (resolveSender as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fakeSender);

    await sendTemplatedEmail({
      to: 'a@b.com',
      template: 'otp-code',
      props: { code: '123456' },
    });

    expect(renderEmailTemplate).toHaveBeenCalledWith('otp-code', { code: '123456' });
    expect(fakeSender.sendEmail).toHaveBeenCalledWith({
      to: 'a@b.com',
      subject: 'S',
      text: 'T',
      html: '<p>H</p>',
    });
  });
});
```

```ts
// apps/portal/src/app/api/check-in/notifications/__tests__/send-email.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/notifications/send-email-service', () => ({
  sendTemplatedEmail: vi.fn(),
}));

import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';
import * as appHandler from '../../send-email/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/check-in/notifications/send-email', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: 'not-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 200 and calls service on happy path', async () => {
    (sendTemplatedEmail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            to: 'a@b.com',
            template: 'donation-thank-you',
            props: { familyName: 'Acme' },
          }),
        });
        expect(res.status).toBe(200);
      },
    });
    expect(sendTemplatedEmail).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/notifications/send-email-service.ts`**

```ts
import 'server-only';
import { renderEmailTemplate, type TemplateName } from '@/lib/aws/render-template';
import { resolveSender } from '@/lib/aws/resolve-sender';

export interface SendTemplatedEmailArgs {
  to: string;
  template: TemplateName;
  props: Record<string, unknown>;
}

export async function sendTemplatedEmail(args: SendTemplatedEmailArgs): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendered = (renderEmailTemplate as any)(args.template, args.props);
  const sender = resolveSender();
  await sender.sendEmail({
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}
```

- [ ] **Step 4: Create `apps/portal/src/app/api/check-in/notifications/send-email/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  to: z.string().email(),
  template: z.enum(['otp-code', 'payment-reminder', 'donation-thank-you']),
  props: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  await sendTemplatedEmail({
    to: parsed.data.to,
    template: parsed.data.template,
    props: parsed.data.props,
  });
  return NextResponse.json({ success: true }, { status: 200 });
}
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/notifications/send-email-service.ts apps/portal/src/app/api/check-in/notifications/send-email/ apps/portal/src/features/check-in/notifications/__tests__/send-email-service.test.ts apps/portal/src/app/api/check-in/notifications/__tests__/send-email.test.ts
git commit -m "feat(portal): POST /api/check-in/notifications/send-email wrapping template render + sender"
```

---

## Task 7: `POST /api/check-in/notifications/payment-reminder` — idempotent reminder

Sends the payment reminder to one family. Writes `families/{fid}/lastReminderSentAt` in Firestore and skips if sent within the last 24 hours.

**Files:**
- Create: `apps/portal/src/features/check-in/notifications/payment-reminder-service.ts`
- Create: `apps/portal/src/app/api/check-in/notifications/payment-reminder/route.ts`
- Test: `apps/portal/src/features/check-in/notifications/__tests__/payment-reminder-service.test.ts`
- Test: `apps/portal/src/app/api/check-in/notifications/__tests__/payment-reminder.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/portal/src/features/check-in/notifications/__tests__/payment-reminder-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeDoc = { get: vi.fn(), set: vi.fn() };
const fakeCollection = { doc: vi.fn(() => fakeDoc) };
const fakeFirestore = { collection: vi.fn(() => fakeCollection) };

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => fakeFirestore),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

vi.mock('@/features/check-in/notifications/send-email-service', () => ({
  sendTemplatedEmail: vi.fn(),
}));

import { findFamilyById } from '@/features/check-in/shared';
import { sendTemplatedEmail } from '@/features/check-in/notifications/send-email-service';
import {
  sendPaymentReminder,
  IDEMPOTENCY_WINDOW_MS,
} from '../payment-reminder-service';

beforeEach(() => {
  vi.clearAllMocks();
  fakeDoc.get.mockReset();
  fakeDoc.set.mockReset();
});

describe('sendPaymentReminder', () => {
  it('skips when family is paid', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'paid',
      contacts: [],
      students: [],
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('paid');
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('skips when family has no email contact', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'phone', value: '+1' }],
      students: [],
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no-email');
  });

  it('skips when last reminder was within idempotency window', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastReminderSentAt: Date.now() - 1000 }),
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('throttled');
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('sends when throttle window has elapsed and updates lastReminderSentAt', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    fakeDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ lastReminderSentAt: Date.now() - IDEMPOTENCY_WINDOW_MS - 1000 }),
    });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(true);
    expect(sendTemplatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', template: 'payment-reminder' }),
    );
    expect(fakeDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastReminderSentAt: expect.any(Number) }),
      { merge: true },
    );
  });

  it('sends the first reminder for a family that has no prior record', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      name: 'Acme',
      paymentStatus: 'unpaid',
      contacts: [{ type: 'email', value: 'a@b.com' }],
      students: [],
    });
    fakeDoc.get.mockResolvedValueOnce({ exists: false });
    const result = await sendPaymentReminder('42');
    expect(result.sent).toBe(true);
    expect(sendTemplatedEmail).toHaveBeenCalled();
  });
});
```

```ts
// apps/portal/src/app/api/check-in/notifications/__tests__/payment-reminder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/check-in/notifications/payment-reminder-service', () => ({
  sendPaymentReminder: vi.fn(),
}));

import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import * as appHandler from '../../payment-reminder/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/check-in/notifications/payment-reminder', () => {
  it('returns 400 on missing fid', async () => {
    await testApiHandler({
      appHandler,
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

  it('returns 200 with service result', async () => {
    (sendPaymentReminder as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sent: true,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ familyId: '42' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sent).toBe(true);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Create `apps/portal/src/features/check-in/notifications/payment-reminder-service.ts`**

```ts
import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared';
import { sendTemplatedEmail } from './send-email-service';

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours

export interface PaymentReminderResult {
  sent: boolean;
  reason?: 'paid' | 'no-email' | 'throttled' | 'not-found';
}

export async function sendPaymentReminder(familyId: string): Promise<PaymentReminderResult> {
  const family = await findFamilyById(familyId);
  if (!family) return { sent: false, reason: 'not-found' };
  if (family.paymentStatus === 'paid') return { sent: false, reason: 'paid' };

  const email = family.contacts.find((c) => c.type === 'email')?.value;
  if (!email) return { sent: false, reason: 'no-email' };

  const ref = portalFirestore().collection('family_notifications').doc(familyId);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const data = snap.data() as { lastReminderSentAt?: number } | undefined;
    if (data?.lastReminderSentAt && now - data.lastReminderSentAt < IDEMPOTENCY_WINDOW_MS) {
      return { sent: false, reason: 'throttled' };
    }
  }

  await sendTemplatedEmail({
    to: email,
    template: 'payment-reminder',
    props: { familyName: family.name },
  });

  await ref.set({ lastReminderSentAt: now }, { merge: true });
  return { sent: true };
}
```

- [ ] **Step 4: Create `apps/portal/src/app/api/check-in/notifications/payment-reminder/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  familyId: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const result = await sendPaymentReminder(parsed.data.familyId);
  return NextResponse.json(result, { status: 200 });
}
```

- [ ] **Step 5: Run tests — expect pass**

- [ ] **Step 6: Commit**

```sh
git add apps/portal/src/features/check-in/notifications/payment-reminder-service.ts apps/portal/src/app/api/check-in/notifications/payment-reminder/ apps/portal/src/features/check-in/notifications/__tests__/payment-reminder-service.test.ts apps/portal/src/app/api/check-in/notifications/__tests__/payment-reminder.test.ts
git commit -m "feat(portal): payment-reminder service with 24h idempotency + route handler"
```

---

## Task 8: Update B1 kiosk check-in route to use the resolved sender

The B1 route currently imports `mockSender` directly. Swap to the new `resolveSender()` + templated email via `sendTemplatedEmail`.

**Files:**
- Modify: `apps/portal/src/app/api/check-in/families/[familyId]/check-in/route.ts`

- [ ] **Step 1: Update the route to call `sendPaymentReminder`**

Replace the inline `mockSender.sendEmail(...)` block in `apps/portal/src/app/api/check-in/families/[familyId]/check-in/route.ts` with:

```ts
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';

// ... existing imports

// In POST handler, replace the "Unpaid families receive a reminder" section with:
if (family.paymentStatus !== 'paid') {
  await sendPaymentReminder(familyId);
}
```

Remove the `mockSender` import if it's no longer referenced.

- [ ] **Step 2: Update the existing B1 test for the check-in route**

The B1 test `families-check-in.test.ts` mocked `mockSender` directly. It now needs to mock `sendPaymentReminder`:

```ts
// Replace the mock block at the top of the test file
vi.mock('@/features/check-in/notifications/payment-reminder-service', () => ({
  sendPaymentReminder: vi.fn(),
}));
vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

// The "does not send payment reminder for paid families" test becomes:
it('does not call sendPaymentReminder for paid families', async () => {
  const { sendPaymentReminder } = await import('@/features/check-in/notifications/payment-reminder-service');
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
  expect(sendPaymentReminder).not.toHaveBeenCalled();
});

// The "sends payment reminder for unpaid families" test becomes:
it('calls sendPaymentReminder for unpaid families', async () => {
  const { sendPaymentReminder } = await import('@/features/check-in/notifications/payment-reminder-service');
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
  expect(sendPaymentReminder).toHaveBeenCalledWith('42');
});
```

- [ ] **Step 3: Run the updated test — expect pass**

```sh
pnpm --filter @cmt/portal test -- src/app/api/check-in/families/
```

- [ ] **Step 4: Commit**

```sh
git add apps/portal/src/app/api/check-in/families/
git commit -m "refactor(portal): B1 kiosk check-in route delegates unpaid reminder to B5 service"
```

---

## Task 9: `POST /api/cron/reset-cache` — cron stub

The standalone app's `reset-cache` is a no-op in the portal (no Redis) but the endpoint exists as a placeholder for future cache-layer work.

**Files:**
- Create: `apps/portal/src/app/api/cron/reset-cache/route.ts`
- Test: `apps/portal/src/app/api/cron/__tests__/reset-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/cron/__tests__/reset-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';
import * as appHandler from '../../reset-cache/route';

beforeEach(() => {
  process.env.CRON_SECRET = 'a'.repeat(32);
});

describe('POST /api/cron/reset-cache', () => {
  it('returns 401 on missing Authorization', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 401 on wrong secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: 'Bearer wrong' },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 200 on valid secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      },
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/cron/reset-cache/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Portal doesn't use Redis; this endpoint exists for parity and future use.
  return NextResponse.json({ success: true, cleared: 0 }, { status: 200 });
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/cron/reset-cache/ apps/portal/src/app/api/cron/__tests__/reset-cache.test.ts
git commit -m "feat(portal): POST /api/cron/reset-cache with CRON_SECRET bearer auth (no-op body)"
```

---

## Task 10: `POST /api/cron/send-weekly-payment-reminders` — weekly sweep

Iterates unpaid families and calls `sendPaymentReminder` for each.

**Files:**
- Create: `apps/portal/src/app/api/cron/send-weekly-payment-reminders/route.ts`
- Test: `apps/portal/src/app/api/cron/__tests__/send-weekly-payment-reminders.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/src/app/api/cron/__tests__/send-weekly-payment-reminders.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@cmt/firebase-shared/admin/rtdb', () => ({
  readRtdb: vi.fn(),
}));

vi.mock('@/features/check-in/notifications/payment-reminder-service', () => ({
  sendPaymentReminder: vi.fn(),
}));

import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import * as appHandler from '../../send-weekly-payment-reminders/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'a'.repeat(32);
});

describe('POST /api/cron/send-weekly-payment-reminders', () => {
  it('returns 401 without secret', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('iterates unpaid families and calls sendPaymentReminder', async () => {
    (readRtdb as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      '1': { fid: '1', name: 'A', paymentStatus: 'paid', contacts: [], students: [] },
      '2': { fid: '2', name: 'B', paymentStatus: 'unpaid', contacts: [], students: [] },
      '3': { fid: '3', name: 'C', paymentStatus: 'partial', contacts: [], students: [] },
    });
    (sendPaymentReminder as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: true });

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { authorization: `Bearer ${'a'.repeat(32)}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.processed).toBe(2);
        expect(body.sent).toBe(2);
      },
    });
    expect(sendPaymentReminder).toHaveBeenCalledTimes(2);
    expect(sendPaymentReminder).toHaveBeenCalledWith('2');
    expect(sendPaymentReminder).toHaveBeenCalledWith('3');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create `apps/portal/src/app/api/cron/send-weekly-payment-reminders/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { sendPaymentReminder } from '@/features/check-in/notifications/payment-reminder-service';
import type { Family } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return false;
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};
  const unpaid = Object.values(all).filter((f) => f.paymentStatus !== 'paid');

  let sent = 0;
  let skipped = 0;
  for (const family of unpaid) {
    const result = await sendPaymentReminder(family.fid);
    if (result.sent) sent += 1;
    else skipped += 1;
  }

  return NextResponse.json(
    { success: true, processed: unpaid.length, sent, skipped },
    { status: 200 },
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```sh
git add apps/portal/src/app/api/cron/send-weekly-payment-reminders/ apps/portal/src/app/api/cron/__tests__/send-weekly-payment-reminders.test.ts
git commit -m "feat(portal): weekly payment-reminder cron handler with CRON_SECRET auth"
```

---

## Task 11: `vercel.ts` at repo root — Vercel Cron declaration

First and only use of `vercel.ts` in the slice (targeted exception from slice A non-goal #10).

**Files:**
- Create: `/Users/dineshmatta/projects/chinmaya-mission-portal/vercel.ts`
- Install: `@vercel/config`

- [ ] **Step 1: Install `@vercel/config`**

```sh
pnpm add -D -w @vercel/config@latest
```

- [ ] **Step 2: Create `vercel.ts` at the repo root**

```ts
// vercel.ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [
    // Daily cache reset at 00:00 UTC (parity with standalone app)
    { path: '/api/cron/reset-cache', schedule: '0 0 * * *' },
    // Weekly unpaid-family reminder sweep — Sundays 14:00 UTC
    { path: '/api/cron/send-weekly-payment-reminders', schedule: '0 14 * * 0' },
  ],
};
```

- [ ] **Step 3: Typecheck root**

```sh
pnpm --filter @cmt/portal typecheck && pnpm build
```

Expected: `vercel.ts` compiles. If `@vercel/config/v1` resolves differently for your installed version, adapt the import accordingly — the only requirement is the `crons` field shape.

- [ ] **Step 4: Commit**

```sh
git add vercel.ts package.json pnpm-lock.yaml
git commit -m "feat: add vercel.ts with cron declarations (daily reset-cache, weekly reminders)"
```

---

## Task 12: Playwright `e2e/b5-notifications.spec.ts`

**Files:**
- Create: `apps/portal/e2e/b5-notifications.spec.ts`

- [ ] **Step 1: Write the e2e**

```ts
// apps/portal/e2e/b5-notifications.spec.ts
import { test, expect } from './fixtures';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

test.describe('B5 — notifications & cron', () => {
  test('cron endpoints reject missing secret', async ({ request }) => {
    const reset = await request.post('/api/cron/reset-cache');
    expect(reset.status()).toBe(401);
    const sweep = await request.post('/api/cron/send-weekly-payment-reminders');
    expect(sweep.status()).toBe(401);
  });

  test('cron reset-cache accepts valid secret', async ({ request }) => {
    test.skip(!CRON_SECRET, 'CRON_SECRET not set');
    const res = await request.post('/api/cron/reset-cache', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
```

- [ ] **Step 2: Lint**

- [ ] **Step 3: Commit**

```sh
git add apps/portal/e2e/b5-notifications.spec.ts
git commit -m "test(portal): add b5-notifications.spec.ts covering cron auth"
```

---

## Task 13: Docs + mark slice B shipped + final pre-push + push

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update README — mark slice B shipped**

```markdown
- **Slice A** — ✅ **Shipped** — Monorepo scaffold + portal app shell + 4 shared packages
- **Slice B** — ✅ **Shipped** — Family-check-in port + portal auth foundation
  - B0 ✅ Portal auth foundation
  - B2 ✅ Family portal
  - B3 ✅ Teacher portal
  - B1 ✅ Kiosk 1:1 port (dark-launched)
  - B4 ✅ Admin dashboard + provisioning
  - B5 ✅ Notifications & cron
- **Slice C** — Port `chinmaya-event-registration` into `/events/*` (next)
- **Slice E+** — Future modules
```

- [ ] **Step 2: Update CLAUDE.md**

```markdown
**Slice A status:** ✅ Shipped.
**Slice B status:** ✅ Shipped. Spec: `docs/superpowers/specs/2026-04-13-slice-b-family-check-in-port-design.md`. Six sub-slices B0–B5 delivered. Slice D struck from roadmap — B0 absorbed it.
**Next slice:** C — port `chinmaya-event-registration` into `apps/portal/src/app/events/*`. Spec pending.
```

- [ ] **Step 3: Full pre-push**

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 4: Commit docs**

```sh
git add README.md CLAUDE.md
git commit -m "docs: mark slice B shipped (B0-B5 complete), slice C next"
```

- [ ] **Step 5: Production flag flip (manual, Vercel dashboard)**

Before pushing:
1. In Vercel env for **production**: set `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true`
2. Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_FROM_EMAIL`, `AWS_SNS_TOPIC_ARN` with real prod values
3. Set `CRON_SECRET` to a 32-byte random string
4. Save

- [ ] **Step 6: Push**

```sh
git push origin main
```

Pre-push hook re-runs. On green, main is updated on GitHub; Vercel redeploys; cron is registered; B5 is live.

**Slice B is complete.**

- [ ] **Step 7: Manual production smoke test**

After the production deploy:
1. Visit `/check-in/admin/unpaid` and click "Send donation email" for one family. Check the recipient's inbox.
2. Manually trigger the reset-cache cron (from Vercel dashboard) and confirm it returns 200.
3. Wait for Sunday 14:00 UTC (or manually trigger) and confirm weekly reminders fire and dedupe correctly.

Slice B is shipped.

---

## B5 acceptance gate summary

| # | Criterion | Verified by |
|---|---|---|
| B5-AC-1 | `sendEmail` calls SES `SendEmailCommand` with correct shape | Task 2 test |
| B5-AC-2 | `sendSMS` calls SNS `PublishCommand` with correct shape | Task 3 test |
| B5-AC-3 | Payment reminder updates `lastReminderSentAt` | Task 7 test |
| B5-AC-4 | Same reminder twice within 24h sends once | Task 7 test |
| B5-AC-5 | Cron endpoints return 401 without `CRON_SECRET` | Tasks 9 + 10 tests |
| B5-AC-6 | `NOTIFY=false` → mock used; no AWS SDK call | Task 5 test |
| B5-AC-7 | `vercel.ts` validates against `@vercel/config` type | Task 11 typecheck |
| B5-AC-8 | Playwright b5-notifications covers cron auth | Task 12 |
| B5-AC-9 | Template snapshots green | Task 4 tests |
| B5-AC-10 | ≥80% coverage under `features/check-in/notifications/` + `lib/aws/` | Soft |
| B5-AC-11 | No `@aws-sdk/*` in client bundles | Bundle audit |
| B5-AC-12 | Typecheck + lint + test + build green | Task 13 |

On green: **Slice B is shipped**. Next: slice C plan (port event registration).

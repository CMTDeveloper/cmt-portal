# SES-managed email templates

The portal can render its non-OTP emails from **SES-managed templates** instead
of the HTML built in code. This file is the contract between the two sides. The
variable names cross the boundary as an untyped JSON blob, so nothing in
TypeScript checks them: a name that does not match renders as a **blank** in the
delivered email, with no compile error, no runtime error, and no log.

## How the switch works

Each logical email has a `SES_TEMPLATE_*` environment variable naming its
template on the SES side.

- **Var unset (or blank)** → the portal renders that email in code, exactly as
  it does today. This is the default and a perfectly good steady state.
- **Var set to a template that exists** → SES renders it.
- **Var set to a template that does NOT exist** → the portal logs an **error**
  and falls back to the in-code renderer, so nobody loses an email over a typo.
  Grep the logs for `[send-managed-email]` to find these.

There is no flag day. Migrate one template at a time by setting one variable.
To roll one back, clear its variable.

Implementation: `apps/portal/src/lib/aws/send-managed-email.ts`,
`email-templates-config.ts`, `ses.ts`.

## The templates

Create each in **`AWS_SES_REGION`** (`ca-central-1`). SES templates are
region-scoped; one created in another region behaves exactly like one that does
not exist.

### 1. `setu-invite` — env `SES_TEMPLATE_SETU_INVITE`

A family manager invites someone to join their family.

| Variable | Meaning |
|---|---|
| `inviterName` | Display name of the manager sending the invite |
| `familyName` | The family being joined |
| `relation` | How the invitee relates to the family (e.g. "Spouse") |
| `acceptUrl` | Full URL to accept. Must be a link. |

```json
{
  "inviterName": "Raj Sharma",
  "familyName": "Sharma Family",
  "relation": "Spouse",
  "acceptUrl": "https://cmt-setu.vercel.app/invite/8fQ2...",
  "_testRecipient": ""
}
```

The invite expires in 14 days (`SETU_INVITE_TTL_DAYS`); say so in the body.

### 2. `setu-join-request` — env `SES_TEMPLATE_SETU_JOIN_REQUEST`

Someone asked to join a family; every manager of that family is notified.

| Variable | Meaning |
|---|---|
| `requesterName` | Name of the person asking, or their contact if unnamed |
| `requesterContact` | The email or phone they used |
| `familyName` | The family they want to join |
| `reviewUrl` | Full URL for a manager to approve or decline |

```json
{
  "requesterName": "Asha Sharma",
  "requesterContact": "asha@example.com",
  "familyName": "Sharma Family",
  "reviewUrl": "https://cmt-setu.vercel.app/join-request/tok123",
  "_testRecipient": ""
}
```

### 3. `payment-reminder` — env `SES_TEMPLATE_PAYMENT_REMINDER`

Sent by the weekly cron to families whose Bala Vihar payment is outstanding.

| Variable | Meaning |
|---|---|
| `familyName` | The family being reminded |

```json
{ "familyName": "Sharma Family", "_testRecipient": "" }
```

This one goes to **many real families at once**. Test it hardest.

### 4. `donation-thank-you` — env `SES_TEMPLATE_DONATION_THANK_YOU`

Admin-triggered acknowledgement after a donation.

Variables are whatever the admin screen passes as `props`; today that is
`familyName` and `amount`. Confirm against
`apps/portal/src/lib/aws/templates/` before authoring, and treat any variable
the template uses but the code does not send as a guaranteed blank.

### 5. `pledge-activated` — env `SES_TEMPLATE_PLEDGE_ACTIVATED`

**Superseded 2026-07-30 and NOT SENT BY ANYTHING.** The pledge activation now
sends CMT's `bv_enrolled_pledge_complete` (#7 below) instead — one event must
produce one email. The registry entry and env var are retained only so that
setting the var by mistake cannot silently resurrect a second activation email;
nothing reads them. Do not author a template for this.

## The Bala Vihar enrollment trio — authored by CMT, LIVE in prod

Unlike everything above, these three are **set on Preview and Production**
(2026-07-30). CMT owns the copy and authored them in SES directly; the portal
only decides when each fires and what data it carries. All three send from the
verified `bvregistration@chinmayatoronto.org` (already `AWS_SES_FROM_EMAIL`).

🔴 **The SES copy contains a literal `CAD $` before `{{donation_amount}}`.** The
portal therefore sends a BARE number (`500`, `51`, `51.50`). A value carrying its
own symbol renders `CAD $$500`. `formatAmountForTemplate` enforces this and is
asserted in `features/setu/donations/__tests__/bv-enrollment-emails.test.ts`.

🔴 **`SES_CONFIGURATION_SET` is still unset**, so a render failure in any of these
three is invisible — SES accepts the message, returns a MessageId, and delivers
nothing. Set it before Aug 3, and have a human read one real send of each.

### 6. `bv_enrolled_donation_complete` — env `SES_TEMPLATE_BV_ENROLLED_DONATION_COMPLETE`

Subject: *"Your Bala Vihar Enrollment is Confirmed"*.
Variables: `registrant_name`, `donation_amount` (the one-time amount).
Sent from `/donate/success`, **only on a real `→ completed` transition**, so a
reloaded receipt does not re-send.

### 7. `bv_enrolled_pledge_complete` — env `SES_TEMPLATE_BV_ENROLLED_PLEDGE_COMPLETE`

Subject: *"Your Bala Vihar Enrollment is Confirmed"*.
Variables: `registrant_name`, `donation_amount` — **the MONTHLY figure**, since
the copy reads "your monthly continued pledge of CAD $…".
Sent from `activatePledgeAndNotify`, on the `started → active` claim it won.

### 8. `bv_enrolled_donation_pending` — env `SES_TEMPLATE_BV_ENROLLED_DONATION_PENDING`

Subject: *"Your Bala Vihar enrollment is not yet confirmed"*.
Variables: `registrant_name`, `registration_link` (absolute, points at
`/family/enroll/bala-vihar` — the donation CHOICE, not `/family/donate`, which
redirects away).
**Two triggers:** the family returning from Stripe without completing, and
check-in. Both go through `claimPendingEmail`, which stamps
`enrollments/{eid}.pendingEmailSentAt` and enforces a 7-day cooldown so the two
triggers cannot compound. It fails CLOSED — when in doubt, no mail.

## `_testRecipient` — reserved, include it in every template

When `SETU_EMAIL_REDIRECT_TO` is set (the UAT safety net), every outbound email
is delivered to that one test inbox instead of the real family. For plain
in-code emails the portal marks the intended recipient by rewriting the subject
line — but **a templated email has no subject in code; the subject lives in the
SES template**. So the marker is passed as a reserved variable instead.

Every template should render it when it is non-empty, e.g. as a small line at
the top:

```html
{{#if _testRecipient}}
  <p style="background:#fff3cd;padding:8px;font-size:12px">
    TEST SEND — this was really for {{_testRecipient}}
  </p>
{{/if}}
```

Without it, a redirected test run puts every email in one inbox with identical
subjects and no way to tell who each was for, which defeats the point of the
redirect.

## Render failures are silent — this is the important part

If a template **exists but fails to render** (a typo in a variable name, a
malformed `{{#if}}`), SES **accepts the message, returns a MessageId, and
delivers nothing**. The portal cannot see this: the send resolves successfully,
so it logs a send and does not fall back. The recipient simply never hears from
us.

Two things guard against it, and both are required:

1. **`SES_CONFIGURATION_SET`** — a configuration set with a `RENDERING_FAILURE`
   event destination, created **in `AWS_SES_REGION`**. This is the only way a
   render failure becomes visible at all, and it is out of band (SNS /
   CloudWatch), not something the application can react to.
   - Needs a named SNS topic, an alarm, and a person who receives it. A
     destination nobody watches is not a safety net.
   - If the variable names a set that does not exist, the portal logs an error
     and **sends anyway without it** — losing the alarm is bad, losing the email
     to gain the alarm is worse.
2. **A real send per template before pointing production at it.** Set the
   variable in UAT, trigger the actual flow, and confirm the email arrives and
   reads correctly. This is the only check that catches a template which renders
   to blanks.

## Adding a template — checklist

1. Author it in SES in `ca-central-1`, using exactly the variable names above.
2. Include the `_testRecipient` block.
3. Set the `SES_TEMPLATE_*` variable in **UAT only** and trigger the real flow.
4. Read the delivered email. Check every variable rendered — a blank is the
   failure mode, and it does not raise anything.
5. Only then set the variable in production.
6. Add the variable to the Vercel env for that environment. It is already in
   `turbo.json`'s build env and `lib/env.ts`'s inventory.

## What is NOT here, deliberately

**Sign-in codes (OTP) are never SES-managed.** There is no `SES_TEMPLATE_*` for
them and adding one will not compile: `send-managed-email.ts` carries a
compile-time assertion plus a runtime guard. An SES-side template edit ships
with no deploy and no review, and a template that fails to render is delivered
to nobody — for a sign-in code that means locking every family out at once.

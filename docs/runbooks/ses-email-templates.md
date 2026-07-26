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

Reserved for the monthly-pledge feature (P5). Not sent by anything yet.

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

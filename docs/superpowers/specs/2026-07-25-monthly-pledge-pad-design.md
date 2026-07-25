# Monthly Pledge (Pre-Authorized Debit) - Design

> **Status:** Draft for review
> **Author:** CMT Developer (with AI agent)
> **Date:** 2026-07-25
> **Target:** Monday 2026-08-03 (decoupled - see §9)
> **Sibling specs:** `2026-07-24-aug-3-launch-batch-design.md` (launch batch), `2026-07-25-adult-study-class-design.md`

---

## 1. What this is - and what it is NOT

A **monthly pledge** is a voluntary, recurring gift supporting Chinmaya Mission Toronto, collected by **pre-authorized debit (PAD)** at the family's bank. It is set up **manually by the accounting team** from bank details the portal collects.

> **It is NOT the Bala Vihar donation.** The ~$500 yearly Bala Vihar donation, paid via Stripe, gates enrollment and is unchanged by this spec. A pledge is *extra* support on top of it.

This distinction was settled by CMT Developer on 2026-07-25 and it drives every design decision below.

| | Bala Vihar donation | Monthly pledge |
|---|---|---|
| Purpose | Enrollment for the school year | Ongoing support for the mission |
| Amount | ~$500/year, offering-defined | Family-chosen, **min $50/month, configurable** |
| Channel | Stripe checkout | Pre-authorized debit, set up manually by accounting |
| Gates enrollment? | **Yes** | **No - gates nothing, ever** |
| Status field | Existing donation status | **Its own separate status** |
| Required? | Effectively, to enroll | Entirely optional |

### 1.1 Open discrepancy with Vaibhav's written note

Vaibhav's 2026-07-25 note says *"**Regarding the $500 donation**, we are introducing a monthly pledge option"* and *"upon submission, **the Bala Vihar enrollment will be confirmed**, but the donation status will remain in a processing state."*

Both statements only hold if the pledge **is** the payment mechanism for the $500 - i.e. paying it monthly instead of upfront. **CMT Developer's reading (2026-07-25) is that the pledge is separate and additional**, and this spec is built to that.

> ⚠️ **These readings are not reconcilable and produce different features.** Confirm with Vaibhav before implementation starts. If he meant "families may pay their $500 in monthly instalments", this spec is the wrong feature and §5 (placement) and §6 (enrollment linkage) both invert.

---

## 2. Locked decisions (CMT Developer, 2026-07-25)

| Decision | Answer |
|---|---|
| Cheque / direct-deposit-form upload | **None, ever.** Accounting works from the four typed bank fields permanently. |
| Bank details | **Collected and stored** (encrypted), never emailed, never shown in any UI. Manually handed to accounting for PAD setup. |
| Pledge status | **Separate** from the BV donation status. Exists only if a family pledges. |
| Confirmation | **Manual, server-side API** invoked by CMT Developer / Vaibhav. An admin UI may follow later. |
| Purge | **The confirm call itself deletes the bank details.** One action, both effects. |
| Minimum amount | **$50/month**, configurable. |
| Placement | Donation success page (primary) + family dashboard card (secondary). |
| Card once pledged | **Shows pledge status** - it does not disappear. |
| Family cancel / change | **Read-only for v1.** Families contact the temple. A UI cancellation *request* may come later. |
| Family email on activation | **Yes**, via an **AWS-SES-managed template** Vaibhav creates in the SES service. **No subject/body hardcoded in the repo**; the portal passes dynamic variables at call time. See §7. |

---

## 3. Why "no upload" matters more than it looks

Verified 2026-07-25: **no file-upload surface exists anywhere in this codebase.** No Vercel Blob, no S3 upload, no Firebase Storage initialization, no multipart handling, no `<input type="file">`. Independently corroborated by the external review at `SECURITY_REVIEW_2026-07-22.md:1282` ("No file-upload surface was found").

Dropping the upload therefore removes the single largest unknown in this feature - building a first-ever upload surface, for cheque images (about the most sensitive file type available), during production-cutover week. The four typed fields are sufficient to set up a PAD; the cheque is corroboration accounting can request by other means in the rare case they need it.

---

## 4. Data model

Two records, deliberately in **separate top-level collections** so that no family-scoped read can ever sweep up the sensitive one.

### 4.1 `pledges/{pid}` - non-sensitive, family-readable

```ts
{
  pid: string,
  fid: string,
  monthlyAmount: number,          // dollars; >= app_config/pledge.minMonthlyAmount at write time
  status: 'pending' | 'active' | 'cancelled',
  submittedAt: Date,
  confirmedAt: Date | null,
  cancelledAt: Date | null,
  submittedByMid: string,
}
```

`status` semantics:
- **`pending`** - the family submitted; accounting has not yet set up the PAD. **Counts as payment nowhere.**
- **`active`** - accounting confirmed the PAD is live at the bank. Bank details already purged.
- **`cancelled`** - abandoned, rejected, or stopped. Bank details purged.

### 4.2 `pledge_secrets/{pid}` - encrypted, NO read path

```ts
{
  pid: string,
  encryptedPayload: string,       // AES-256-GCM ciphertext (base64)
  iv: string,
  authTag: string,
  keyVersion: number,
  createdAt: Date,
}
```

The plaintext, before encryption, is exactly:

```ts
{ bankNumber, transitNumber, institutionNumber, accountNumber }
```

**Rules, non-negotiable:**
1. **No API route returns this document, decrypted or otherwise** - not admin, not coordinator, not welcome-team. The safest access control is no read path at all.
2. **No `canAccessRoute` rule grants it.** The default-deny at `can-access-route.ts:315` is the backstop if someone later adds a route without thinking.
3. It is a **top-level collection, not** `families/{fid}/...`, so a family or collectionGroup read can never include it.
4. It is **never logged**, never put in an error message, never sent to Sentry.

> **Landmine (verified):** `can-access-route.ts:311-313` - the `/api/setu/*` catch-all grants **welcome-team** by default. A pledge route placed under that prefix without an explicit rule would be readable by precisely the staff who must not see it. **All pledge routes live outside `/api/setu/*` with their own explicit rules.**

### 4.3 Encryption

- **AES-256-GCM**, via Node's built-in `crypto` (no new dependency).
- Key from **`PLEDGE_ENCRYPTION_KEY`** (32 bytes, base64), set on Vercel Production only, and added to `turbo.json`'s env passthrough array or the build will not see it.
- `keyVersion` is stored so a future key rotation can decrypt old records.
- Encrypt/decrypt live in one module (`features/setu/pledges/crypto.ts`) with **no** re-export of the raw key.

> ⚠️ **Key custody:** if `PLEDGE_ENCRYPTION_KEY` is lost, every stored pledge becomes permanently unreadable. It must be backed up somewhere CMT Developer controls **before** the first real submission.

### 4.4 `app_config/pledge` - admin-editable

```ts
{
  enabled: boolean,               // kill switch
  minMonthlyAmount: 50,
  suggestedAmounts: [50, 100, 200],
  // copy fields for the ask card
}
```

Same shape as the existing `app_config/{disclaimers,locations,school_year}` docs, so it stays admin-editable in the portal with no external CMS (repo rule).

---

## 5. Placement - where the family meets this

**Primary: the donation success page** (`/family/donate/success`). The family has just completed the Bala Vihar donation; intent is at its highest and the $500 is provably handled. Quiet copy, not a large call-to-action.

**Secondary: a persistent card** on the family dashboard / `/family/donations`. Catches families who did not act in the success-page moment, and adults with no Bala Vihar children who simply want to support the mission.

**Nowhere else. Specifically NOT:**
- in the enroll flow
- as a modal or interstitial
- as anything that blocks, gates, or delays enrollment or the Bala Vihar donation

> **Rationale for not offering it before the BV donation:** it would cannibalise the payment that actually gates enrollment. A family might pledge $50/month and skip the $500, leaving enrollment stuck behind a manual accounting step for no reason.

### 5.1 The card is state-driven, and it never disappears

| Pledge state | Card |
|---|---|
| none | The ask: "Support the mission monthly, from $50/month" |
| `pending` | "Pledge received - we're setting up your monthly gift. You'll get a confirmation once it's active." |
| `active` | "You're giving $X monthly since [date]. Thank you." |
| `cancelled` | Back to the ask |

Hiding the card after submission was considered and rejected: verification is manual and may take days, and during exactly that window the family will want to know whether it worked. Removing the only surface that mentions pledges leaves them with nowhere to look.

The success-page ask is suppressed the same way once a pledge exists - at most one quiet acknowledgement line, never a repeat ask.

**The card reads `pledges/{pid}` only.** It cannot leak bank details by construction, and after confirmation there is nothing sensitive left to leak anyway.

---

## 6. Flows

### 6.1 Submit

1. Family opens the pledge form from either entry point.
2. Chooses a monthly amount (≥ `minMonthlyAmount`) and enters bank number, transit number, institution number, account number.
3. `POST /api/pledges` (outside `/api/setu/*`; family-manager only):
   - validates the amount against `app_config/pledge`
   - validates the bank fields for **shape** (digit lengths) - no external verification exists or is implied
   - in one transaction: writes `pledges/{pid}` with `status: 'pending'` **and** `pledge_secrets/{pid}` with the encrypted payload
4. Family sees the `pending` card. **No enrollment or donation state changes. Nothing is gated.**

### 6.2 Confirm (manual, after accounting sets up the PAD)

`POST /api/admin/pledges/[pid]/confirm` - **admin only** (see §10 O2).

In a single transaction:
1. `pledges/{pid}.status = 'active'`, `confirmedAt = now`
2. **`pledge_secrets/{pid}` is deleted**
3. an `audit_log` row is written (the collection introduced by the launch-batch spec §2)

Then, outside the transaction, the activation email is sent (see §7).

> This is the design's best property: **the purge trigger is the verification action itself.** The bank details cannot outlive their purpose by accident, because the only thing that ends their usefulness is the same call that deletes them. No retention cron to forget or misfire.

### 6.3 Cancel / reject

`POST /api/admin/pledges/[pid]/cancel` - same shape, opposite outcome: `status = 'cancelled'`, secret deleted, audit row written. Covers withdrawal, rejection, and bad data.

### 6.4 Backstop sweep - the gap the happy path leaves

Confirm and cancel are the only purge paths, so a pledge that is simply **forgotten** holds real bank account numbers indefinitely. That is the likeliest failure mode, not the rarest.

- A scheduled sweep purges `pledge_secrets` for any pledge still `pending` after **90 days** (assumption - see §10 O3), leaving the `pledges` record intact so nothing is operationally lost.
- A **stale-pledge report** lists anything `pending` beyond ~14 days so a human notices before the sweep ever fires.

---

## 7. Activation email - AWS-managed SES template

**Decision (CMT Developer, 2026-07-25): the template lives in the AWS SES service, not in this repo.** Vaibhav authors and maintains it there. The portal only *invokes* it by name and supplies the dynamic variables.

> **No email subject or body text is hardcoded in the codebase for this feature.** Copy changes are made in SES by Vaibhav and take effect with no code change and no deploy.

This is a **new pattern for this repo** and deliberately diverges from the five existing templates in `apps/portal/src/lib/aws/templates/`, which are TypeScript functions returning inline `{subject, text, html}`. Those are left exactly as they are - this spec does not migrate them.

### 7.1 What must be built

The current mail layer cannot do this. `ses.ts` exposes only `sendEmail`, which builds `Subject` and `Body` inline via `SendEmailCommand` (verified: `ses.ts:1-37`). Required additions:

1. **`sendTemplatedEmail` in `lib/aws/ses.ts`** - invokes the SES-side template by name with a JSON data payload, rather than an inline subject/body.
   > The repo depends on `@aws-sdk/client-ses` (SES v1 classic), whose templated-send command is `SendTemplatedEmailCommand` taking `Template` + `TemplateData`. **Verify the exact command and argument shape against the current AWS SDK docs at implementation time** rather than trusting this from memory.
2. **Extend the `Sender` interface** (`resolve-sender.ts:7-8`) with the new method, so templated sends pass through the same allowlist / redirect / mock machinery as everything else. A raw call to `ses.ts` that bypasses `resolveSender()` would defeat the UAT safety nets.
3. **Mock sender support** so tests never hit AWS.
4. **Template name as configuration**, not a literal buried in a handler.

### 7.2 Dynamic variables

Supplied by the portal at call time - family name, monthly amount, activation date. **Never any bank detail.**

The exact variable names are a contract between Vaibhav's SES template and the calling code. They must be agreed and written down (O5), because a mismatch fails at send time, not at build time.

### 7.3 Operational constraints

- **SES templates are per-region and per-account.** The template must exist in `AWS_SES_REGION` (currently `ca-central-1`). If UAT and production share one AWS account, one template serves both - **confirm this**, because if they diverge, a template that exists in UAT and not in prod fails only in production.
- **Missing template fails at runtime**, not at deploy. The send must be wrapped so a missing or renamed template **cannot roll back the confirm transaction** - the pledge is already active and the bank details are already purged; a failed email must be logged and surfaced, never allowed to undo that. This is why §6.2 sends outside the transaction.
- `resolveSender()` (`resolve-sender.ts:50-127`) has redirect and silent-drop branches in non-production environments, so a UAT test may not see mail arrive at the real address. Testing gotcha, not a bug.
- **SES here cannot send attachments** (`SendEmailCommand`, not `SendRawEmailCommand`). Irrelevant while there is no upload, but it forecloses "attach a receipt PDF" later without a mail-layer change.
- **Escaping is now SES's job.** Because the template is server-side at AWS and interpolates a family-supplied name, Vaibhav must ensure the template handles that safely. The repo-side escaping question disappears along with the repo-side template.

---

## 8. Security posture

This feature introduces the most sensitive data in the system, into a codebase with an open security backlog. What this design does about that:

| Risk | Mitigation |
|---|---|
| Firestore leak / over-broad service account | Payload is **AES-256-GCM ciphertext**; Firestore's own at-rest encryption does not protect against an Admin-SDK read |
| Staff seeing bank details | **No read path exists at all** - not a role check that can be misconfigured |
| Accidental inclusion in a family read | **Separate top-level collection**, never a `families` subcollection |
| A future route exposing it | No `canAccessRoute` rule + default-deny at `:315`; routes live outside the welcome-team-granting `/api/setu/*` catch-all |
| Data outliving its purpose | Purge is **the same call** as confirmation; plus cancel path and a 90-day sweep |
| Email interception / logging | **Nothing sensitive is ever emailed.** Sidesteps the log-PII finding at `SECURITY_REVIEW_2026-07-22.md:712-735`, which names the exact `resolve-sender.ts` lines a banking email would traverse |
| Unverified money counted as real | `pending` **counts as payment nowhere**; only a server-side staff action sets `active` |

### 8.1 Deliberately NOT inheriting the existing donation flaw

`SECURITY_REVIEW_2026-07-22.md:265-299` (**High**, open): donation settlement is **client-trusted** today - a manager can POST `status: "completed"`, or merely visit the success page, and the donation is recorded as paid with no payment (`mark-donation-status.ts:5-31`).

A manually-processed PAD has **no provider webhook**, so it can never be made provider-authoritative the way Stripe can. This spec therefore does the one thing available: **the client can never move a pledge out of `pending`.** Only an authenticated staff-side call does. The pledge path is the pattern that finding recommends, applied to the flow that most needs it.

> It also does not touch or extend the existing Stripe settlement path. That finding remains open and is out of scope here.

### 8.2 Known residual

**No `firestore.rules` file is tracked in this repo** (verified). Database-level rules are unmanaged, so every guarantee above rests on Admin-SDK-only access being true in practice. Encryption is what makes that residual tolerable: even direct database access yields ciphertext. Tracking rules in-repo is worth doing, but is not gated on this feature.

---

## 9. Scope, sequencing, and what it depends on

Because a pledge **gates nothing**, this feature is fully decoupled from the production cutover's critical path. It can ship on Aug 3 or slip a week without holding back enrollment, donations, or the launch batch. That is a deliberate property, not an accident.

Depends on:
- `audit_log` (defined in the launch-batch spec §2)
- `app_config` pattern (exists)
- No new npm dependency - `crypto` is built in

Does **not** depend on: file upload, Stripe changes, the donation-status model, or the Adult Study Class spec.

---

## 10. Verification

1. **Deployed-UAT E2E**: submit a pledge, assert the card shows `pending`, run confirm, assert the card shows `active` **and `pledge_secrets/{pid}` is gone.**
2. **Negative security test - the most important one here:** assert that **no** API route returns bank details for any role (family-manager, welcome-team, coordinator, admin). Assert `pledge_secrets` is unreachable through every family/roster/report read.
3. **N=2**: a family with two pledges over time (one cancelled, one active) must render correctly - the card must not pick "the first pledge".
4. **Round-trip crypto test**: encrypt → decrypt → identical plaintext; and a wrong-key decrypt must fail closed, never return garbage.
5. **Purge test**: confirm and cancel both delete the secret. A failed transaction must leave **both** records untouched - never a status flip without a purge, or a purge without a status flip.
6. **Amount validation**: below `minMonthlyAmount` is rejected server-side, not just in the form.
7. **`pending` counts nowhere**: assert a pending pledge does not alter the payment chip, roster status, enrollment confirmation, or any report.

---

## 11. Open items

| # | Item | Owner |
|---|---|---|
| **O1** | **Confirm the §1.1 discrepancy with Vaibhav** - is the pledge extra support (this spec) or a monthly instalment plan for the $500 (a different feature)? Blocking. | CMT Developer |
| **O2** | Who may invoke confirm/cancel - **admin only** (assumed here, most conservative for a financial action), or admin + coordinator? | CMT Developer |
| **O3** | Backstop sweep window - **90 days** assumed (§6.4). | CMT Developer |
| **O4** | `PLEDGE_ENCRYPTION_KEY` generated, set on Vercel Production, added to `turbo.json` env passthrough, and **backed up** before the first real submission. | CMT Developer |
| **O5** | Vaibhav creates the activation template **in AWS SES** (`ca-central-1`). Needs: the **template name** and the exact **variable names**, agreed and written down - a mismatch fails at send time, not at build time (§7.2). | Vaibhav |
| **O8** | Confirm UAT and production share one AWS account/region for SES templates. If they diverge, a template present in UAT but absent in prod fails **only in production** (§7.3). | CMT Developer |
| **O6** | Accounting hand-off mechanics: who runs the extraction script, how the decrypted file is transmitted, and how it is destroyed afterwards. The portal's job ends at the script. | CMT Developer |
| **O7** | Bank-field shape validation rules (digit lengths for bank / transit / institution / account). Canadian standard is 3-digit institution, 5-digit transit - to be confirmed. | CMT Developer |

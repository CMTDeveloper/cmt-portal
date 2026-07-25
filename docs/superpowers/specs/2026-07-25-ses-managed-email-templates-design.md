# SES-Managed Email Templates - Design

> **Status:** Draft for review
> **Author:** CMT Developer (with AI agent)
> **Date:** 2026-07-25
> **Sibling specs:** `2026-07-24-aug-3-launch-batch-design.md`, `2026-07-25-monthly-pledge-pad-design.md`, `2026-07-25-adult-study-class-design.md`

---

## 1. The policy

**Decision (CMT Developer, 2026-07-25):** every email the portal sends goes through a **template managed in the AWS SES service**, authored and maintained by Vaibhav. The portal supplies only the recipient, the template name, and the dynamic variables.

**Exception: OTP emails stay in code.**

> **No email subject or body copy lives in the repository**, other than the OTP template. Copy changes happen in SES and take effect with no code change and no deploy.

### 1.1 Why OTP is exempt (and should stay that way)

OTP is the sign-in path for every family. Keeping it in code means:
- **No external dependency on the auth critical path.** A renamed or deleted SES template would lock every family out of the portal.
- **One less network-visible failure mode** on the flow that must work at 9am on a Sunday.
- It has exactly one variable (`code`) and never needs copy review.

This is worth stating explicitly so nobody "finishes the migration" later and takes sign-in down with it.

---

## 2. Current state (verified 2026-07-25)

Five templates exist, all TypeScript functions returning `{subject, text, html}`, in `apps/portal/src/lib/aws/templates/`.

**Two different dispatch patterns coexist:**

| Template | Dispatch | Call site | Migrate? |
|---|---|---|---|
| `otp-code` | `renderEmailTemplate` | `features/check-in/notifications/send-email-service.ts:13` | **NO - exempt** |
| `payment-reminder` | `renderEmailTemplate` | same service | Yes |
| `donation-thank-you` | `renderEmailTemplate` | same service | Yes |
| `setu-invite` | **inline spread** | `api/setu/invite/send/route.ts:177` | Yes |
| `setu-join-request` | **inline spread** | `api/setu/join-request/send/route.ts:69` | Yes |

- `renderEmailTemplate` (`lib/aws/render-template.ts`) is an overloaded dispatcher over three names, with an exhaustive `never` check at the default branch.
- Its only production consumer calls it as `(renderEmailTemplate as any)(...)` (`send-email-service.ts:13`) - a type escape hatch that defeats the overloads.
- The other two templates bypass the dispatcher entirely and spread straight into `sendEmail` args.

**The send layer cannot do templated sends at all.** `lib/aws/ses.ts:1-37` exposes only `sendEmail`, which builds `Subject` and `Body` inline via `SendEmailCommand`.

---

## 3. What gets built

1. **`sendTemplatedEmail` in `lib/aws/ses.ts`** - invokes an SES-side template by name with a JSON data payload.
   > The repo depends on `@aws-sdk/client-ses` (SES v1 classic), whose templated-send command is `SendTemplatedEmailCommand` taking `Template` + `TemplateData`. **Verify the exact command and argument shape against current AWS SDK docs at implementation time** rather than trusting it from memory.
2. **Extend the `Sender` interface** (`resolve-sender.ts:7-8`) with the new method. **This is not optional:** `resolveSender()` holds the UAT allowlist, the redirect-to-test-address branch, and the mock sender. A direct `ses.ts` call would bypass all three and mail real families from a test run.
3. **Mock sender support**, so tests never reach AWS.
4. **Template names as configuration**, not literals buried in handlers.
5. **Migrate the four non-OTP templates**, deleting each TS template file only once its SES counterpart is verified working.
6. **Retire or narrow `renderEmailTemplate`** once only `otp-code` remains - a three-way dispatcher for one entry is dead weight. Note its `as any` consumer must be fixed or removed alongside it.

---

## 4. The risk, and the recommended sequencing

**Migrating a working email can only break it.** There is no upside to moving `setu-invite` beyond consistency, and a variable-name mismatch between Vaibhav's SES template and the calling code **fails at send time, not at build time** - nothing catches it until an invite silently does not arrive.

Invites are load-bearing for launch: families invite co-managers, and a broken invite email during cutover week is a support problem with no workaround.

**Recommended split:**

| Phase | Scope | When |
|---|---|---|
| **A - infrastructure + new email** | `sendTemplatedEmail`, `Sender` interface, mock support, and the **pledge activation** email (SES from birth - nothing to break) | **Aug 3 batch** |
| **B - migrate the four existing** | `payment-reminder`, `donation-thank-you`, `setu-invite`, `setu-join-request` | **After launch** |

Phase A is required anyway by the pledge spec, carries no regression risk, and proves the whole mechanism on a brand-new email. Phase B then moves working emails one at a time on a calm week, each verified in UAT before the TS template is deleted.

> If Vaibhav authors all five SES templates now, that is fine - Phase B becomes a fast sequence of small changes. The recommendation is about **when the switchover lands in production**, not when the templates get written.

---

## 5. Operational constraints

- **SES templates are per-region and per-account.** They must exist in `AWS_SES_REGION` (currently `ca-central-1`). **Confirm UAT and production share an account** - if they diverge, a template present in UAT and absent in prod fails *only in production*, after everything looked green.
- **A missing template fails at runtime, not deploy.** Every call site needs a decision about what happens when the send throws. For the pledge, the send sits outside the confirm transaction precisely so a template problem cannot roll back an activated pledge.
- **Variable names are an untyped contract** between Vaibhav's SES templates and the calling code. They must be written down per template and asserted in tests, because TypeScript cannot check across that boundary.
- **Escaping moves to SES.** Templates interpolating family-supplied names (invite, join-request) must handle that safely on the AWS side. The repo-side escaping inconsistency disappears with the repo-side templates.
- **No attachments either way.** `SendEmailCommand` is not `SendRawEmailCommand`; `SendTemplatedEmailCommand` does not add attachment support. Any future "attach a receipt" ask needs a mail-layer change regardless.
- `resolveSender()` (`resolve-sender.ts:50-127`) redirects or silently drops in non-production, so a UAT test may not see mail arrive at the real address. Testing gotcha, not a bug.

---

## 6. Verification

1. **Per-template UAT send** before its TS version is deleted - subject, body, and every variable rendered correctly with real data.
2. **Variable-contract test** per template: assert the exact payload key set the portal sends. A rename on either side must fail a test, not a family's invite.
3. **`resolveSender()` still governs**: assert templated sends honour the allowlist and redirect branches, and that mocks intercept them in tests.
4. **OTP untouched**: assert `otp-code` still renders in-process and never calls SES templates. This is the guard against a well-meaning future migration.
5. **Failure mode**: with a deliberately wrong template name, assert the caller degrades as designed - the pledge stays active and the error is logged, never a rolled-back transaction or a 500 to the family.

---

## 7. Open items

| # | Item | Owner |
|---|---|---|
| **O1** | Approve the Phase A / Phase B split (§4), or direct that all four migrate for Aug 3. | CMT Developer |
| **O2** | Vaibhav creates the SES templates in `ca-central-1` and supplies **template names + exact variable names** per template. | Vaibhav |
| **O3** | Confirm UAT and production share one AWS account/region for SES (§5). | CMT Developer |
| **O4** | Decide whether `renderEmailTemplate` is retired or narrowed to OTP-only once Phase B completes, and fix its `as any` consumer (`send-email-service.ts:13`). | CMT Developer |

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

## 4. Migrate everything for Aug 3, with a code fallback

**Decision (CMT Developer, 2026-07-25):**

> Migrate everything for Aug 3. For every scenario, an SES template must be present - **if it is not, fall back to the existing code email.**

That fallback is what makes a full Aug-3 migration safe. My earlier concern was that migrating working emails could only break them, and that a variable-name mismatch **fails at send time, not build time** - nobody notices until an invite silently fails to arrive. With a fallback, a missing or misnamed template degrades to today's behaviour instead of to silence.

### 4.1 Fallback semantics - narrow, loud, and never silent

The fallback exists to survive a **missing** template. It must not paper over a broken one.

| Condition | Behaviour |
|---|---|
| No SES template name configured for this email | Use the code template. Log at info - an expected state during rollout. |
| SES rejects the send with **template-not-found** | Use the code template. **Log at error** - this is a misconfiguration, not a design state. |
| SES send fails any other way (throttle, auth, network, bad data) | **Do NOT fall back.** Fail as the caller would today. A fallback here would mask real delivery failures and send the same mail twice on a partial failure. |

The distinction matters: falling back on *every* error turns "our email is misconfigured" into a permanently invisible condition, and the code templates would quietly become the real system while everyone believes SES is live.

### 4.2 What this implies

- **The code templates are kept, not deleted.** They become the fallback layer. §3 item 5 is amended: no template file is removed in this batch.
- **A missing template is therefore never fatal**, which removes the launch-week risk that motivated the earlier phased recommendation.
- **Rollout can be incremental at runtime, not in code.** Vaibhav creates SES templates one at a time; each one starts being used the moment it exists, with no deploy.
- **`renderEmailTemplate` stays** (§3 item 6 is deferred) - it is the fallback dispatcher now, not dead weight.
- **The error-level log is the migration checklist.** Anything still logging template-not-found after launch is an SES template that has not been created yet.

> One risk survives and should be watched: if a template exists but its **variable names** are wrong, SES may accept the send and render an email with blanks where the family's name or amount should be. That is not a fallback case - it is a bad template, and only the per-template variable-contract test (§6.2) and a real UAT send will catch it.

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
6. **Fallback matrix (§4.1)** - one test per row:
   - no template configured → code template used, info logged
   - template-not-found → code template used, **error** logged
   - any other SES failure → **no fallback**, error propagates as it does today, and the mail is **not** sent twice
7. **OTP never touches the templated path** even if someone creates an `otp-code` template in SES. The exemption is enforced in code, not by the absence of a template.

---

## 7. Open items

| # | Item | Owner |
|---|---|---|
| ~~O1~~ | RESOLVED 2026-07-25 - **migrate everything for Aug 3, with a code fallback when an SES template is absent** (§4). Code templates are retained as the fallback layer rather than deleted. | done |
| **O2** | Vaibhav creates the SES templates in `ca-central-1` and supplies **template names + exact variable names** per template. | Vaibhav |
| **O3** | Confirm UAT and production share one AWS account/region for SES (§5). | CMT Developer |
| **O4** | Decide whether `renderEmailTemplate` is retired or narrowed to OTP-only once Phase B completes, and fix its `as any` consumer (`send-email-service.ts:13`). | CMT Developer |

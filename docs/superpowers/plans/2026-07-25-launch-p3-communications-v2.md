# P3 v2 - Communications (SES-managed templates + SMS sign-in posture)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every non-OTP email through an SES-managed template with a loud, narrow code fallback, keep OTP out of that path by construction, and make SMS sign-in fail honestly everywhere it is still offered.

**Architecture:** A low-level `sendSesTemplatedEmail` joins the two sender interfaces so it inherits the UAT allowlist and redirect safety net. A registry maps five logical email names to `SES_TEMPLATE_*` env vars; `sendManagedEmail(name, to, data, fallback)` uses SES when a name is configured and falls back to the existing in-code renderer only for **missing** templates, never for delivery failures. OTP is excluded at compile time and at runtime, not by convention. Separately, SMS sign-in returns a typed 400 at every route that still offers it.

**Tech Stack:** `@aws-sdk/client-ses` 3.1030.0 (SES v1 classic), Next.js 16, Zod, Vitest.

**Supersedes:** `2026-07-25-launch-p3-communications.md`, reviewed as REQUEST CHANGES (3 critical, 7 major, 6 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p3.md`.

**Specs:** `docs/superpowers/specs/2026-07-25-ses-managed-email-templates-design.md`; `docs/superpowers/specs/2026-07-24-aug-3-launch-batch-design.md` §8.

---

## Global Constraints

- **`sendTemplatedEmail` is already taken, and means the opposite thing.** `features/check-in/notifications/send-email-service.ts:5,11` exports `SendTemplatedEmailArgs { to; template; props }` and `sendTemplatedEmail(args)` for the **in-code** renderer, consumed by `payment-reminder-service.ts:4,31`, `app/api/check-in/notifications/send-email/route.ts:3,18`, and three test files that `vi.mock` the module **by that export name**. This plan introduces `sendSesTemplatedEmail` (low level, `lib/aws/ses.ts`) and `sendManagedEmail` (registry + fallback). **Never ship two exports named `sendTemplatedEmail`.**
- **The sender interface is `ResolvedSender`, and there are two of them.** `lib/aws/resolve-sender.ts:6-9` declares `ResolvedSender`; `features/check-in/shared/notifications/mock-sender.ts:13-16` declares a separate `NotificationSender`, and `mockSender` is typed against it while being returned as a `ResolvedSender` at `resolve-sender.ts:53`. **Both interfaces gain any new method, in the same commit**, or that assignment fails typecheck - and the two whole-module mock factories in `resolve-sender.test.ts:3,5-10` must be widened with it. There is no interface called `Sender`.
- **Paths.** The real email service is `apps/portal/src/features/check-in/**notifications**/send-email-service.ts`. `features/check-in/shared/notifications/` contains **only** `mock-sender.ts`. Getting this wrong is what made v1's Task 3 unimplementable.
- **`sendOtpEmail` does not exist** anywhere in `apps/portal/src` or `packages/`. Do not write a test against it.
- **Everything in `lib/aws/` starts with `import 'server-only'`** (`ses.ts:1`, `sns.ts:1`, `resolve-sender.ts:1`, `render-template.ts:1`). New files there must too, or a stray client import reads `undefined` for every `SES_TEMPLATE_*` and silently pins the fallback path forever.
- **New env vars go in `turbo.json`'s `env` array** or Vercel builds strip them: local passes, prod fails. `NEXT_PUBLIC_FEATURE_SMS_OTP` is currently absent from `turbo.json:12-56`.
- **All Firestore/SES ops target UAT.** No em dashes. Commit author `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### SDK facts, verified against the installed package (not training data)

`@aws-sdk/client-ses@3.1030.0`, pinned `^3.700.0` at `apps/portal/package.json:54`. No `client-sesv2` in the tree, so this is SES v1 classic.

- `SendTemplatedEmailCommand` is exported - `dist-types/commands/index.d.ts:51`.
- `SendTemplatedEmailRequest` carries `Source`, `Destination`, `Template`, `TemplateData` (a JSON **string**), and `ConfigurationSetName?` - `dist-types/models/models_0.d.ts`.
- `TemplateDoesNotExistException` exists with `readonly name: "TemplateDoesNotExistException"` - `dist-types/models/errors.d.ts:486-487`.

Use `err instanceof TemplateDoesNotExistException` imported from the SDK, not a `.name` string compare. Two nearby names make loose matching dangerous: `CustomVerificationEmailTemplateDoesNotExistException` (`errors.d.ts:428`) and an unrelated bounce-reason literal `TemplateDoesNotExist` with no `Exception` suffix (`enums.d.ts:61`). Never refactor this to `.includes()`.

### The failure mode the fallback matrix cannot see

The SDK's own command documentation says it plainly (`SendTemplatedEmailCommand.d.ts:72`):

> if Amazon SES can't render the email because the template contains errors, it doesn't send the email. Additionally, because it already accepted the message, Amazon SES doesn't return a message stating that it was unable to send the email.

So a template that **exists but fails to render** resolves successfully: `sendManagedEmail` logs a send, no fallback fires, and nothing is delivered. For `setu-invite` that is silent loss, and strictly worse than today. Spec §4.1's caveat only anticipates the milder "renders with blanks" case. Task 2 Step 6 addresses it.

### Deliberate deviations from the spec

1. **Spec §8.4 understates the SMS regression and is corrected.** It records "a non-`+1` number cannot be added" via `/api/setu/contacts/send-code` as a known limitation of the old NANP-gate design. Under §8.0's "no SMS at all" posture, that route (`route.ts:74-76`) is dead for **every** number including Canadian ones. Task 5 covers it rather than inheriting the old wording.
2. **Task 5 also fixes the legacy path, which the spec does not mention.** `/api/auth/family/send-code:48-56` still calls `resolveSender().sendSMS`, and its UI still offers Phone (`features/check-in/family/family-login-form.tsx:81-85`). CLAUDE.md states legacy `/login` + `/check-in/*` is **still the production entry point** for existing BV families, so leaving it is leaving the exact bug this requirement exists to fix, on the path most families use.
3. **The `+1`/NANP gate: spec §8.2 items 1-3 are not built. Item 4 IS built.** §8.0 supersedes items 1-3 - "no SMS" is strictly simpler than "some countries only", and those are sign-in-path gates that only become operative if SNS clears the sandbox, so writing them now is dead code with a dormant test.

   **Item 4 is not a sign-in item and that reasoning does not transfer to it.** §8.0 governs sign-in only, but `sns.ts:17`'s `sendSMS` is the publish layer for **seven** call sites, and Task 5 touches three. Four keep publishing today, to numbers §1.8 measured as unreachable:
   - `features/setu/prasad/reminder-service.ts:59` (daily cron)
   - `features/setu/prasad/proposal-notify.ts:47`
   - `app/api/setu/join-request/send/route.ts:80` (manager notification)

   So item 4 is operative **right now**, for every prasad reminder and every join-request SMS. It is a five-line refuse-and-log guard inside `sns.ts:17` that covers all callers at once, including the three routes Task 5 already edits. Build it (Task 5 Step 6b) rather than defer it on a rationale that does not apply.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/portal/src/lib/aws/ses.ts` | `sendSesTemplatedEmail` (low-level SES v1 call) | 1 |
| `apps/portal/src/lib/aws/resolve-sender.ts:6-9,50-127` | `ResolvedSender` gains the method; allowlist + redirect branches | 1 |
| `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts:13-16` | `NotificationSender` gains it; mock records a templated call | 1 |
| `apps/portal/src/lib/aws/email-templates-config.ts` | name → `SES_TEMPLATE_*` registry | 2 |
| `apps/portal/src/lib/aws/send-managed-email.ts` | `sendManagedEmail` + the narrow fallback | 2 |
| `apps/portal/src/app/api/setu/invite/send/route.ts:175-178` | migrate `setu-invite` | 3 |
| `apps/portal/src/app/api/setu/join-request/send/route.ts:65-73` | migrate `setu-join-request` | 3 |
| `apps/portal/src/features/check-in/notifications/payment-reminder-service.ts:31` | migrate `payment-reminder` | 3 |
| `apps/portal/src/app/api/check-in/notifications/send-email/route.ts:18` | migrate `donation-thank-you` **only**; this route also dispatches `otp-code` | 3 |
| `apps/portal/src/app/api/setu/auth/send-code/route.ts` | OTP exemption; SMS refusal | 4, 5 |
| `apps/portal/src/app/api/setu/auth/verify-code/route.ts` | mirror the SMS refusal | 5 |
| `apps/portal/src/app/sign-in/page.tsx:241` | guard inside `handleSendCode` | 5 |
| `apps/portal/src/app/register/page.tsx:434` | do not hand phone matches to an OTP-only screen | 5 |
| `apps/portal/src/app/api/auth/family/send-code/route.ts:48-56` | legacy path refusal | 5 |
| `apps/portal/src/features/check-in/family/family-login-form.tsx:81-85` | legacy UI | 5 |
| `apps/portal/src/app/api/setu/contacts/send-code/route.ts:74-76` | add-a-phone refusal | 5 |
| `apps/portal/src/lib/flags.ts`, `turbo.json` | `NEXT_PUBLIC_FEATURE_SMS_OTP` | 5 |
| `docs/runbooks/ses-email-templates.md` (create), `production-cutover-checklist.md` | variable contract + cutover entries | 6 |

---

## Task 1: `sendSesTemplatedEmail` on both sender interfaces

**Files:**
- Modify: `apps/portal/src/lib/aws/ses.ts`
- Modify: `apps/portal/src/lib/aws/resolve-sender.ts:6-9` (`ResolvedSender`), `:50-127` (mock / allowlist / redirect branches)
- Modify: `apps/portal/src/features/check-in/shared/notifications/mock-sender.ts:13-16` (`NotificationSender`) and the `mockSender` literal
- Test: `apps/portal/src/lib/aws/__tests__/ses.test.ts`, `resolve-sender.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SendSesTemplatedEmailArgs {
    to: string;
    templateName: string;               // the SES-side template name
    data: Record<string, unknown>;      // serialized to TemplateData JSON
  }
  export async function sendSesTemplatedEmail(args: SendSesTemplatedEmailArgs): Promise<void>
  ```
  **Not** `sendTemplatedEmail` - see Global Constraints.

- [ ] **Step 1: Write the failing tests**

Cover: the command is `SendTemplatedEmailCommand`; `Template` is the template name; `TemplateData` is `JSON.stringify(data)`; `Source` comes from the same sender identity `sendEmail` uses; a `TemplateDoesNotExistException` propagates unchanged (the *caller* decides to fall back, not this layer).

**Plus the two governance branches spec §6 item 3 requires**, which are the whole reason the method joins the interface:
- with `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY` unset, a templated send reaches `mockSender.sendSesTemplatedEmail`, not the real one
- with the flag on and `SETU_EMAIL_ALLOWLIST` set, a send to a non-allowlisted address reaches `mockSender`, not the real one

`aws-sdk-client-mock` is already the convention here (`__tests__/ses.test.ts:2,6,16,23`).

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @cmt/portal exec vitest run src/lib/aws/__tests__/ses.test.ts --project node
```

- [ ] **Step 3: Implement in `ses.ts`**

Mirror the existing `sendEmail`'s client construction and sender-identity resolution exactly. This layer does no fallback and swallows nothing.

- [ ] **Step 4: Add it to BOTH sender interfaces**

`ResolvedSender` (`resolve-sender.ts:6-9`) **and** `NotificationSender` (`mock-sender.ts:13-16`). Widening only `ResolvedSender` breaks `resolve-sender.ts:53` (`return mockSender`), the one assignability position. (`:85` and `:113` are method calls on existing members and are unaffected - the conclusion holds, the evidence is one site, not three.)

**Widen the two mock factories in the same commit, or every test in `resolve-sender.test.ts` fails on module access.** Both are whole-module replacements:

```ts
// apps/portal/src/lib/aws/__tests__/resolve-sender.test.ts:3
vi.mock('../ses', () => ({ sendEmail: vi.fn() }));
// :5-10
vi.mock('@/features/check-in/shared', () => ({
  mockSender: { sendEmail: vi.fn(), sendSMS: vi.fn() },
}));
```

Once `resolve-sender.ts` imports `sendSesTemplatedEmail` from `./ses` and the mock branch calls `mockSender.sendSesTemplatedEmail(args)`, vitest 4 raises `No "sendSesTemplatedEmail" export is defined on the "../ses" mock` on access. Add the export to the first factory and the method to the second.

- [ ] **Step 5: Carry the allowlist and redirect branches - and fix the marker they depend on**

The existing redirect works by **rewriting the subject**:

```ts
// resolve-sender.ts:74
await realSendEmail({ ...args, to: emailRedirectTo, subject: `[test → ${args.to}] ${args.subject}` });
```

A templated send has **no subject in code** - it lives in SES. Copying this branch literally means every redirected templated email lands in the tester's single inbox with an identical SES subject and no indication of who it was for, destroying the exact signal `SETU_EMAIL_REDIRECT_TO` exists to provide.

Carry the marker as a **reserved template variable** instead:

```ts
sendSesTemplatedEmail: async (args) => {
  if (emailRedirectTo) {
    await realSendSesTemplatedEmail({
      ...args,
      to: emailRedirectTo,
      // Reserved variable. SES templates should render it when present so a
      // redirected test send still says who it was really for. There is no
      // subject to prefix - the subject lives in the SES template.
      data: { ...args.data, _testRecipient: args.to },
    });
    return;
  }
  // ... allowlist branch, then the real send
}
```

`_testRecipient` becomes part of the variable contract in Task 6 so Vaibhav includes it in every template.

The **mock** logs `subject` and `text` (`mock-sender.ts:24-28`), neither of which exists on a templated send. Specify what it records: `{ to, templateName, dataKeys: Object.keys(data) }`. Do **not** log `data` values - they carry family names and amounts.

- [ ] **Step 6: Run the tests, then commit**

```bash
git add apps/portal/src/lib/aws apps/portal/src/features/check-in/shared/notifications/mock-sender.ts
git commit -m "feat(email): sendSesTemplatedEmail on both sender interfaces

Named sendSesTemplatedEmail, not sendTemplatedEmail: that name is already
exported from features/check-in/notifications/send-email-service.ts for the
IN-CODE renderer, with two call sites and three test files that vi.mock it by
name. Two exports with one name meaning opposite things would be a trap.

Both interfaces gain the method. There is no interface called Sender:
resolve-sender.ts declares ResolvedSender, mock-sender.ts declares a separate
NotificationSender, and mockSender is used as a ResolvedSender at three sites -
widening only one fails typecheck at all three.

The redirect safety net could not be copied literally. It marks the intended
recipient by rewriting the subject, and a templated send has no subject in
code. The marker moves to a reserved _testRecipient template variable, which
Task 6 adds to the variable contract."
```

---

## Task 2: The registry and the narrow fallback

**Files:**
- Create: `apps/portal/src/lib/aws/email-templates-config.ts` (starts with `import 'server-only'`)
- Create: `apps/portal/src/lib/aws/send-managed-email.ts` (same)
- Test: `apps/portal/src/lib/aws/__tests__/send-managed-email.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ManagedEmailName =
    | 'payment-reminder' | 'donation-thank-you'
    | 'setu-invite' | 'setu-join-request' | 'pledge-activated';
  // 'otp-code' is deliberately absent. Task 4 pins that at compile time.

  export async function sendManagedEmail(args: {
    name: ManagedEmailName;
    to: string;
    data: Record<string, unknown>;
    fallback: () => Promise<void>;
  }): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests - all five rows**

Spec §4.1 gives three; two more are needed to make the behaviour fully specified:

```ts
it('uses the code fallback when no SES template name is configured', async () => { /* info log */ });

it('uses the code fallback when SES says the template does not exist', async () => {
  // ERROR log - this is a misconfiguration, not a design state. The error log
  // IS the migration checklist per spec 4.2.
});

it('does NOT fall back on any other SES failure', async () => {
  // Throttle / auth / network / bad data propagate. Falling back here would
  // mask real delivery failures and risk a double send.
});

it('propagates a fallback failure unchanged, and does not re-wrap it', async () => {
  // The template-not-found error is logged and swallowed; whatever the FALLBACK
  // throws is what the caller sees. This matters at the invite:
  // app/api/setu/invite/send/route.ts:175-178 sends after the transaction
  // commits and does not catch, so a throw is a 500 with the invite row already
  // written. The caller must see the real cause, not SesTemplateNotFoundError.
});

it('never sends twice', async () => {
  // Only two conditions reach the fallback: never-attempted, and
  // TemplateDoesNotExist. SES does not queue a message it rejected for a
  // missing template, so neither can double-send.
});
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement the registry**

Read `SES_TEMPLATE_*` per name. `import 'server-only'` at the top. Missing var means "not configured", which is the info-level fallback, not an error.

**Add all five `SES_TEMPLATE_*` names plus `SES_CONFIGURATION_SET` to `turbo.json`'s `build.env` array** (currently `:12-56`, which already lists `AWS_SES_REGION`, `AWS_SES_FROM_EMAIL`, `SETU_EMAIL_ALLOWLIST`, `SETU_EMAIL_REDIRECT_TO` and every other AWS/SETU var, and none of the new ones). Stage `turbo.json` in Step 7's commit. These are server-only vars read at request time, so the practical bite is narrower than the Global Constraint implies - Vercel injects the full env into the function runtime either way - but they are absent from Turborepo's build hash, so changing a template name will not invalidate a cached build. Add them for that, and for consistency with the rule.

Also add them to `apps/portal/src/lib/env.ts`'s `portalEnvSchema`. That file is the single written inventory of portal env and explicitly lists vars it does not itself consume ("Read directly from `process.env` in `resolveSender()`; listed here for schema completeness"). Zod's non-strict object ignores unknown keys so nothing breaks either way; the inventory just stops being complete.

- [ ] **Step 4: Implement `sendManagedEmail` - through `resolveSender()`, never `./ses`**

```ts
await resolveSender().sendSesTemplatedEmail({ to, templateName, data });
```

**This is the single most important line in the plan.** After Task 1 there are two importable callables with the same name: the raw `lib/aws/ses.ts` export and the governed `resolveSender().sendSesTemplatedEmail`. `send-managed-email.ts` sits in the same directory as `ses.ts`, so `import { sendSesTemplatedEmail } from './ses'` is the *natural* import and the wrong one. Spec §3 item 2, verbatim:

> **This is not optional:** `resolveSender()` holds the UAT allowlist, the redirect-to-test-address branch, and the mock sender. A direct `ses.ts` call would bypass all three and mail real families from a test run.

Concretely, a direct call skips `SETU_EMAIL_ALLOWLIST` (`resolve-sender.ts:19-28`), `SETU_EMAIL_REDIRECT_TO` (`:66-67`), and the `NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY !== 'true'` route to `mockSender` (`:51-54`). Every non-prod environment would then mail `setu-invite`, `setu-join-request`, `payment-reminder` and `donation-thank-you` to real recipients - and the payment-reminder cron would blast the roster.

Use `err instanceof TemplateDoesNotExistException` from the SDK. Never a `.name` string compare, never `.includes()` - see Global Constraints.

- [ ] **Step 4b: Pin the routing with a test that fails if someone imports `./ses` directly**

```ts
vi.mock('@/lib/aws/resolve-sender');
vi.mock('../ses');

it('sends through resolveSender, never the raw ses module', async () => {
  await sendManagedEmail({ name: 'setu-invite', to: 'a@b.com', data: {}, fallback: noop });
  expect(mockResolved.sendSesTemplatedEmail).toHaveBeenCalledTimes(1);
  expect(rawSendSesTemplatedEmail).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run the tests**

- [ ] **Step 6: Route render failures to an out-of-band alarm - the application still cannot see them**

**Be precise about what this buys, because the obvious reading is wrong.** The SDK's next sentence after the render-failure warning (`SendTemplatedEmailCommand.d.ts:75-77`) is "we highly recommend that you set up Amazon SES to send you **notifications** when Rendering Failure events occur." A configuration-set event destination publishes to SNS / CloudWatch / Firehose - strictly out of band. With `ConfigurationSetName` set:

- `client().send(...)` still resolves with a `MessageId` (`SendTemplatedEmailResponse` carries only that)
- `sendManagedEmail` still logs a send and still does not fall back
- the recipient still gets nothing

So this is **alerting, not correctness**. The in-application gap stays open. Do it anyway - a silent loss someone gets paged for beats one nobody sees - but name a topic, an alarm and an owner in Task 6, or it is a config change nobody reads.

**The thing that actually closes the gap is the per-template UAT send in Task 6 Step 3.** By this plan's own admission it is the only other barrier between a bad template and silent loss, so it is a numbered non-optional step there, not a parenthetical here.

Implementation, with the failure mode this step introduces:

`SendTemplatedEmailRequest` accepts `ConfigurationSetName?` (verified at `models_0.d.ts:3290`). **Omit the key entirely when `SES_CONFIGURATION_SET` is unset** - do not let `undefined` ride in on a spread. And add a row to the fallback matrix, because `ConfigurationSetDoesNotExistException` is in the command's declared throws (`SendTemplatedEmailCommand.d.ts:135`):

| Condition | Behaviour |
|---|---|
| `ConfigurationSetDoesNotExistException` | Log at **error**, then **retry once without `ConfigurationSetName`**. Do not fail the send. |

Without that row, the plan's own "never fall back on any other SES failure" rule means a misspelled `SES_CONFIGURATION_SET`, or one created in a region other than `AWS_SES_REGION` (configuration sets are region-scoped exactly like templates), makes **all five managed emails throw** - a failure that is impossible today and impossible without this step. Worst at the invite (a 500 with the row already written) and the payment-reminder cron (retries forever, since `lastReminderSentAt` is written after the send). Add it as a sixth test.

AWS-side prerequisite for Vaibhav: create the configuration set **in `AWS_SES_REGION`** with a `RENDERING_FAILURE` destination. Record it in Task 6.

- [ ] **Step 7: Commit**

---

## Task 3: Migrate the four non-OTP emails - at their real call sites

**v1 named a file that does not exist and would have routed OTP through SES.** It said to modify `features/check-in/shared/notifications/send-email-service.ts:13` (that directory holds only `mock-sender.ts`) and to migrate two templates there. The real file, `features/check-in/notifications/send-email-service.ts:11-20`, is a **single generic wrapper** over `args.template: 'otp-code' | 'payment-reminder' | 'donation-thank-you'`. Rewriting its body to call `sendManagedEmail` sends **OTP through the managed path** - the one thing this whole plan exists to prevent.

**Leave `sendTemplatedEmail` alone as the in-code render path.** Migrate at the four call sites:

| Email | Real call site |
|---|---|
| `setu-invite` | `app/api/setu/invite/send/route.ts:175-178` |
| `setu-join-request` | `app/api/setu/join-request/send/route.ts:65-73` |
| `payment-reminder` | `features/check-in/notifications/payment-reminder-service.ts:31` |
| `donation-thank-you` | `app/api/check-in/notifications/send-email/route.ts:18` - **branch on `template`; only this one migrates.** `otp-code` and `payment-reminder` keep calling `sendTemplatedEmail` from here. |

**Behaviour to preserve, per call site:**
- **invite** - post-transaction and uncaught, so today a send failure is a 500 with the invite row already written. The matrix preserves that. This is also the email the render-failure gap (Task 2 Step 6) hits hardest. While you are here, guard `inviterName!` / `familyName!` at `:177` for **emptiness, not nullness**: both are `let`s at `:64-65` assigned unconditionally inside the transaction (`:75`, `:108`), so the `!` is a definite-assignment escape and a null guard would catch nothing. The real degradation is an empty string, which renders as a blank in SES.
- **join-request** - wrapped in `Promise.allSettled`, so nothing propagates either way. The safest of the four.
- **payment-reminder** - writes `lastReminderSentAt` **after** the send (`:37`), so a rethrow leaves the idempotency window unset and the next cron retries. Preserved either way; state it in the commit.
- **donation-thank-you** - admin-triggered from `features/check-in/admin/send-donation-email-button.tsx:26`.

- [ ] **Step 1: Write the failing contract tests**

One per template, asserting the exact `{ name, data }` handed to `sendManagedEmail`. `expect.objectContaining({ name: 'setu-invite', data: { ... } })` compares `data` by deep equality, which is the point - variable names are an untyped contract across the SES boundary and TypeScript cannot check them.

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Migrate the four call sites**, each passing `fallback: () => <existing code path>`
- [ ] **Step 4: Two assertions per call site, because "the old tests still pass" proves nothing here**

An earlier draft of this step said the three files that `vi.mock` `send-email-service` by export name "must still pass unmodified". **That gate cannot fail** - and it is structurally the same tautology this plan calls out in v1's Task 4.

Those files do not mock `sendManagedEmail`. After the migration the real one runs, finds no `SES_TEMPLATE_*` in the test env, and takes the fallback, which calls the still-mocked `sendTemplatedEmail`. So `payment-reminder-service.test.ts:110` and `send-email.test.ts:47` pass whether the migration happened, happened wrong, or never happened at all.

Assert both halves instead:

1. **Mock `@/lib/aws/send-managed-email`** and assert `sendManagedEmail` was called with the expected `name` and `data`. This is the migration.
2. **Unmocked, with no `SES_TEMPLATE_*` set**, assert the fallback reaches `sendTemplatedEmail`. This is the safety net.

Add `delete process.env.SES_TEMPLATE_*` in `beforeEach` so test 2's independence is structural rather than incidental on `.env.local` not being loaded.

Then run `pnpm test`.
- [ ] **Step 5: Commit**

---

## Task 4: Pin the OTP exemption in code, not in convention

v1's two tests were both non-functional: one called `sendOtpEmail`, which does not exist, and the other asserted `expect(names).not.toContain('otp-code')` over an array the test itself wrote - a tautology that **cannot fail**. Adding `'otp-code'` to `ManagedEmailName` would leave it green, which is precisely the failure it was written to prevent.

- [ ] **Step 1: Compile-time assertion**

```ts
// If 'otp-code' is ever added to ManagedEmailName this stops compiling.
type _OtpNotManaged = 'otp-code' extends ManagedEmailName ? never : true;
const _assertOtpNotManaged: _OtpNotManaged = true;
void _assertOtpNotManaged;
```

- [ ] **Step 2: Runtime guard inside `sendManagedEmail`**

Throw on any `name` matching `/otp|code|verif/i`, with a comment saying why. Defends against a cast or an `as never` slipping past the type.

- [ ] **Step 3: Behavioural tests against the REAL OTP senders**

Two live paths, and neither is `sendOtpEmail`:
- `app/api/setu/auth/send-code/route.ts:150-159` - the Setu sign-in OTP, which builds subject and text **inline** and calls `resolveSender().sendEmail` directly. It does not go through `sendTemplatedEmail` at all.
- `features/check-in/notifications/send-email-service.ts` with `template: 'otp-code'` - the legacy dispatcher.

Assert both still call `sendEmail` (not `sendSesTemplatedEmail`) after Task 3.

- [ ] **Step 4: Run and commit**

---

## Task 5: SMS sign-in fails honestly, everywhere it is offered

Spec §8.0. Four surfaces, not one.

- [ ] **Step 1: Add the flag**

`NEXT_PUBLIC_FEATURE_SMS_OTP`, default **off**, in `lib/flags.ts` as `flags.smsOtp` **and** in `turbo.json`'s `env` array (absent today at `:12-56`).

**One public flag, read on both sides.** An earlier draft floated an additional server-only `SETU_SMS_OTP` and left the choice to the executor - that is an unassigned design decision in the middle of a task, and it lets the UI flag and the route flag drift apart. Every other `NEXT_PUBLIC_FEATURE_*` in `lib/flags.ts` is already read server-side; follow that. `flags.smsOtp` does not exist yet - a repo-wide grep for `SMS_OTP` / `smsOtp` returns nothing - so there is no precedent to preserve.

- [ ] **Step 2: Typed 400 at `/api/setu/auth/send-code` and `verify-code`**

**Gate it on the flag** - an unconditional 400 makes `flags.smsOtp` decorative, and spec §8.0 requires the block to be reversible ("flipping it on restores SMS sign-in"):

```ts
if (type === 'phone' && !flags.smsOtp) {
  return NextResponse.json({ error: 'sms-signin-unsupported' }, { status: 400 });
}
```

**Place it on the shape of the input, before `findSetuFamilyByContact` (`route.ts:72`) and before the anti-enumeration silent-200 (`:128-135`)**, so every phone input gets an identical response whether or not the number is registered. Placing it before the rate limit at `:51` is also fine - it does strictly less work and bypasses nothing. Mirror in `verify-code` or a user burns verify attempts against a code that was never sent.

Test both directions: flag off → 400; **flag on → still reaches `sendSMS`**. The second is what keeps the flag real.

`MOBILE_API_CHANGELOG.md` entry required - the mobile app calls the same route.

- [ ] **Step 2b: The four existing tests that assert SMS *is* sent, and one you must not simply delete**

All four pass today and all four break here. Enumerated because the failure mode is an executor improvising which assertions to invert:

| Test | Broken by |
|---|---|
| `app/api/setu/auth/send-code/__tests__/route.test.ts:148-158` - `accepts phone contact, calls SNS sender with E.164-canonical phone` | Step 2 |
| `app/api/setu/auth/send-code/__tests__/route.test.ts:160-169` - `phone variations all canonicalize to the same E.164 form` | Step 2 |
| `app/api/auth/family/send-code/__tests__/route.test.ts:155-174` - `calls sendSMS for phone type` | Step 5 |
| `app/api/setu/contacts/send-code/__tests__/route.test.ts:70-73` - `sends an OTP SMS for a phone contact (E.164-canonical)` | Step 6 |

Also affected by Step 4: `app/sign-in/__tests__/page.test.tsx:124-135` (`SignInPage - prefill from ?type=phone&value=`) and `:561-569`.

**The second one is identity-critical and must not just be deleted.** It is the only coverage of `normalizeContactForKey('phone', ...)` canonicalization, and spec §8.1 says changing that function **re-keys identities** - sign-in misses the existing family and a brand-new auth user is created. **Move those assertions onto `normalizeContactForKey` directly** so the guarantee keeps a test after the route stops exercising it.

- [ ] **Step 3: Guard inside `handleSendCode`, not just the copy**

`sign-in/page.tsx` duplicates the whole form across two layouts. The shared consts are at `:232-239` (`contactLabel`, `contactPlaceholder`, `contactHint`), but the **interactive** parts are duplicated:

- mobile submit `:606`, toggle `:620`
- desktop submit `:722`, toggle `:736`
- shared handler `handleSendCode` at `:241`

Patching only the consts leaves **both** submit buttons live, so "blocked client-side" silently does not happen. Put the refusal at the top of `handleSendCode` so both layouts are covered by construction, and surface the notice from the shared const. There is no "Phone tab" - it is a toggle button labelled `Use phone number instead`; keep it visible per §8.0.

- [ ] **Step 4: Do not hand phone matches to a screen that cannot serve them**

`register/page.tsx:434` hands off `/sign-in?type=${match.matchedType}&value=...`. On `/sign-in`, `:174` sets `initialContactType = 'phone'` and `:179` computes `hasOtpHandoff`, which at `:184` **suppresses the saved password preference** - deliberately, so the handoff drives an OTP proof.

So a returning family matched on **phone** lands pre-set to Phone, with their number filled in, and the password fallback switched off. Under Step 2 they now get an explicit 400 instead of today's silent nothing - honest, but still a dead end for a family the portal just recognised.

Fix one of these, and test it:
- hand off only when `matchedType === 'email'`, or
- when a `type=phone` handoff arrives and the flag is off, land on the Email tab with a notice: we recognised your number, sign in with the email on your account.

`app/register/__tests__/page.test.tsx:185` currently asserts `'/sign-in?type=phone&value=4165550000'` - that assertion changes with this step. Update it deliberately, do not delete it.

- [ ] **Step 5: The legacy path - the one most families still use**

`/api/auth/family/send-code:48-56` still calls `resolveSender().sendSMS`, and `features/check-in/family/family-login-form.tsx:81-85` still offers Phone. CLAUDE.md: legacy `/login` + `/check-in/*` is **still the production entry point** for existing BV families. Leaving it means those users keep getting the silent nothing this requirement exists to fix.

Apply the same typed refusal and the same UI notice behind the same flag.

- [ ] **Step 6: Adding a phone to an existing profile**

`/api/setu/contacts/send-code:74-76` SMSes a code to verify a phone being added to a profile. Spec §8.4 records this as a limitation **for non-`+1` numbers** under the old NANP-gate design; under §8.0 it is dead for **every** number, Canadian included. That is a materially larger regression than §8.4 describes.

**Decision, made here rather than left to the executor: hide the add-phone affordance behind `flags.smsOtp`, and leave the email add-path untouched.** It is reversible with the flag, and the alternative - adding an unverified phone - creates contact rows that `contactKeys` would then key on, which is a worse trade than temporarily losing the capability.

**The affordance, named.** An earlier draft named only the API route, which is the same defect as v1's (a file the executor cannot find) with the sign flipped:

- `apps/portal/src/app/family/settings/contacts/page.tsx:118` - `onClick={() => beginAdd('phone')}`, with `beginAdd` at `:41` and the type state at `:18`
- `apps/portal/src/features/setu/contacts/contacts-client.ts:15` - `sendContactCode`
- `apps/portal/src/app/api/setu/contacts/send-code/route.ts:74-76` - the SMS branch

Spec §8.4 **already carries the rescope** (it was corrected when this plan was written and cross-references this step) - do not re-edit it.

Note what is genuinely untouched: registration verifies by **email** (`register/family/page.tsx:358-364` hardcodes `type: 'email'`), so phone *capture* at registration and member add/edit is unaffected. It is the *verification* that gates adding one later which is dead.

- [ ] **Step 6b: Refuse non-`+1` publishes at the `sns.ts` layer (spec §8.2 item 4)**

One guard inside `sendSMS` (`lib/aws/sns.ts:17`) covers all seven callers, including the four this task does not otherwise touch - the two prasad senders and the join-request manager notification, all of which publish to unreachable international numbers today and bill for them:

```ts
if (!args.phone.startsWith('+1')) {
  console.error(`[sns] refusing non-+1 publish to ${args.phone.slice(0, 4)}... - SNS cannot deliver`);
  return;
}
```

Log the prefix only, never the full number. This is belt-and-braces, independent of `flags.smsOtp`: even with SMS sign-in restored, a non-NANP publish still goes nowhere.

- [ ] **Step 6c: Mirror the refusal in the other two verify routes**

Step 2 mirrors `send-code` into `verify-code` so nobody burns attempts against a code that was never sent. The same reasoning applies to the two paired routes this task also disables, and neither was named:
- `app/api/auth/family/verify-code/route.ts` (pairs with Step 5)
- `app/api/setu/contacts/verify-code/route.ts` (pairs with Step 6)

Both accept `type: 'phone'` today. Low impact - no code exists to verify, so they fail as `invalid-or-expired` - but the principle should be applied consistently or not stated.

- [ ] **Step 7: Run the full suite, then commit**

---

## Task 6: The variable contract and the cutover entries

- [ ] **Step 1: Create `docs/runbooks/ses-email-templates.md`**

Per template: the SES template name, every variable the calling code sends, an example `TemplateData` payload, and the reserved `_testRecipient` variable from Task 1 Step 5. This is the untyped cross-system contract; it is the only place it exists in writing.

**And the escaping requirement, which nothing else in the repo will state once this ships.** Spec §5: "Escaping moves to SES." Today `lib/aws/templates/setu-invite-email.ts:9-16` defines `escapeHtml()` and `:20-23` applies it to `inviterName`, `familyName` and `relation` - all family-supplied (`invite/send/route.ts:75`, `:108`). Once the send is a `TemplateData` payload rendered by SES, **that protection stops running** and lives entirely in how the template is authored.

Write it explicitly, and flag it in the handoff:

> Every variable carrying family-supplied text - `inviterName`, `familyName`, `relation`, `requesterName`, `requesterContact` - MUST use double-brace `{{var}}` interpolation in the SES template, never triple-brace `{{{var}}}`. Handlebars escapes the first and does not escape the second. The repo-side `escapeHtml()` no longer runs for these emails.

Same for `setu-join-request-email.ts`.

- [ ] **Step 1b: The per-template UAT send gate - one checkbox per template**

Promoted out of Task 2 Step 6 because it is, by this plan's own reasoning, the **only** in-application barrier between a bad template and silent loss. A configuration set alerts someone out of band; this is what stops the send.

**No `SES_TEMPLATE_*` var is set in production until that template has rendered correctly in a real UAT send**, checked against the variable contract above:

- [ ] `payment-reminder`
- [ ] `donation-thank-you`
- [ ] `setu-invite`
- [ ] `setu-join-request`
- [ ] `pledge-activated`

Note `resolveSender()` redirects or drops in non-production (`resolve-sender.ts:50-127`), so a UAT send may not land at the real address - check the redirect inbox, and use `_testRecipient` to confirm who it was for.

- [ ] **Step 2: Cutover entries**

Five `SES_TEMPLATE_*` vars, `SES_CONFIGURATION_SET`, and `NEXT_PUBLIC_FEATURE_SMS_OTP` all need to be in `docs/runbooks/production-cutover-checklist.md`, plus a dated §14 entry. Without this, launch sets none of them and every email silently uses the code fallback while everyone believes SES is live.

Also record spec §5's open question: **confirm UAT and production share an AWS account.** If they diverge, a template present in UAT and absent in prod fails **only in production**, after everything looked green.

- [ ] **Step 3: Commit**

---

## Self-review

**Spec coverage.** SES spec §1.1 OTP exemption → Task 4 (now enforced, not asserted). §3 build list → Tasks 1-3. §4.1 fallback matrix → Task 2 Step 1, extended from three rows to five. §4.2 keep code templates → Task 3 (`sendTemplatedEmail` untouched). §5 operational constraints → Task 6, including the shared-account question. §6 verification → Task 2 Step 6's UAT gate + Task 3's contract tests. Launch spec §8.0 → Task 5, across four surfaces. §8.2's NANP gate → **deliberately not built** (deviation 3). §8.4 → corrected in Task 5 Step 6.

**Type consistency.** `sendSesTemplatedEmail` / `SendSesTemplatedEmailArgs` (Task 1) are distinct from the existing `sendTemplatedEmail` / `SendTemplatedEmailArgs` throughout. `sendManagedEmail` (Task 2) is consumed with the same `{ name, to, data, fallback }` shape in Task 3 and guarded in Task 4.

**Every review finding addressed:** C1 → Task 3's real call sites + the branch that keeps `otp-code` off the managed path. C2 → the naming rule in Global Constraints. C3 → Task 5 Step 4. M1 → Task 2 Step 6. M2 → Task 4 Steps 1-3. M3 → Task 1 Step 4. M4 → Task 1 Step 5. M5 → Task 2 Step 1 test 4. M6 → Task 5 Step 3. M7 → Task 5 Steps 5-6 + deviation 1. m1 → Task 5 Step 1. m2 → the SDK facts block (Step 0 is closed). m3 → Global Constraints (`server-only`). m4 → Task 3's null-guard note. m5 → the File Structure table. m6 → Task 6 Step 2.

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p3v2.md`): 1 critical, 9 major, 10 minor. The v1 defects were confirmed fixed; the new ones clustered in the two places v2 *added* material and the one place it *dropped* an instruction v1 had. What changed most:

1. **The critical was mine, and the rename caused it.** v2 created two same-named callables - `lib/aws/ses.ts`'s `sendSesTemplatedEmail` and `resolveSender().sendSesTemplatedEmail` - and then Task 2 never said which one `sendManagedEmail` uses. `send-managed-email.ts` is a sibling of `ses.ts`, so the natural import is the wrong one, and spec §3 item 2 says a direct `ses.ts` call "would bypass all three and mail real families from a test run". Now stated, and pinned by a test that fails if `./ses` is imported directly.
2. **`ConfigurationSetName` buys alerting, not correctness.** The SDK's next sentence recommends *notifications*; an event destination is out of band, the send still resolves, and the recipient still gets nothing. Step 6 is retitled honestly and the per-template UAT gate - the thing that actually closes the gap - is promoted to a numbered Task 6 step with a checkbox per template. Step 6 also introduced a **new** hard failure: `ConfigurationSetDoesNotExistException` is in the declared throws, and under this plan's own no-fallback rule a misspelled or wrong-region `SES_CONFIGURATION_SET` would make all five emails throw. It now has its own matrix row.
3. **"The three test files must still pass unmodified" was a tautology** - the same defect this plan criticises in v1's Task 4. Those files do not mock `sendManagedEmail`, so the fallback path keeps them green whether the migration happened, happened wrong, or never happened. Replaced with two real assertions per call site.
4. **Deviation 3's rationale was wrong for spec §8.2 item 4.** `sns.ts`'s `sendSMS` has seven callers and Task 5 touches three; the prasad reminders and the join-request notification publish to unreachable numbers **today**, so "dead code, dormant until SNS clears" does not apply. Now built as Task 5 Step 6b.

Also corrected: four currently-passing tests that assert SMS *is* sent, one of which is the **only** coverage of the identity-critical `normalizeContactForKey` canonicalization (§8.1) and must be moved rather than deleted; the flag left undecided in Task 5 Step 1 and never applied in Step 2; the add-phone UI file left unnamed; the `turbo.json` / `env.ts` entries v2 dropped; and the escaping requirement that stops running once SES renders these emails.

**Known risk.** Task 2 Step 6 depends on an AWS-side action by someone other than the implementer. If the configuration set does not exist by launch, the per-template UAT send in Task 6 is the **only** thing preventing a silently-undelivered email, and it is a manual gate. Say so out loud at cutover rather than discovering it from a family who never got their invite.

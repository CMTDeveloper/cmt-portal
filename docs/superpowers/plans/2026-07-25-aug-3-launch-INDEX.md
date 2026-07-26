# Aug 3 2026 Launch - Plan Index

> **Starting a session? Read [`2026-07-25-EXECUTION-ORDER.md`](./2026-07-25-EXECUTION-ORDER.md) first.**
> It sequences every task across all six plans, lists the non-code blockers and the
> decisions still open, and says what to ship today. This file is the plan catalogue;
> that one is the running order.

> **For agentic workers:** each plan below is independently executable. Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` per plan. Execute in the order given - later plans consume interfaces earlier ones produce.

**Goal:** ship the production cutover plus four feature specs for Monday 2026-08-03.

**Source specs** (all committed under `docs/superpowers/specs/`):
- `2026-07-24-aug-3-launch-batch-design.md`
- `2026-07-25-monthly-pledge-pad-design.md`
- `2026-07-25-adult-study-class-design.md`
- `2026-07-25-ses-managed-email-templates-design.md`

---

## The plans, in execution order

| # | Plan | Covers | Depends on |
|---|---|---|---|
| **P1** | **`2026-07-25-launch-p1-roles-and-cross-family-edit-v2.md`** (v1 superseded, do not implement) | `coordinator` role across **all three** authorization gates, `audit_log`, staff cross-family edit endpoints, welcome edit UI, grade editor for welcome-team | - |
| **P2** | **`2026-07-25-launch-p2-teacher-visitors-roster-v2.md`** (v1 superseded, do not implement) | roster-confirmation `fid` bug + guest date-key fix (**ship these two first, alone**), teacher attendance revamp, `/welcome/visitors` + nav, visitor grade filter, roster Reset, guest→teacher E2E | - |
| **P3** | **`2026-07-25-launch-p3-communications-v2.md`** (v1 superseded, do not implement) | `sendSesTemplatedEmail` + `sendManagedEmail`, narrow code fallback, migrate 4 emails, pin the OTP exemption in code, SMS sign-in refusal across **four** surfaces | - |
| **P4** | **`2026-07-25-launch-p4-adult-study-class-v2.md`** (v1 superseded, do not implement) | Adult program, `$0`/`$101` fee rule, explicit `enrollFamily` mids/override/mode, **reconcile-not-create**, flag-gated `AdultClassGate`, success-page ask + skip | P1 (coordinator offerings grant **and** its can-access-route edits); **P6 Task 5 before P4 Task 8** |
| **P5** | **`2026-07-26-launch-p5-monthly-pledge-v3.md`** (v1 AND v2 superseded, do not implement) | **RESCOPED 2026-07-26 (no bank details - Stripe-hosted PAD).** **deny-all `firestore.rules`** (shipped), status-only pledge record, start->hosted-Stripe redirect, activation (**blocked on spec O9**), admin list, family card. ~~AES-256-GCM~~ ~~purge~~ ~~sweep-as-cron~~ ~~hardened export~~ **all deleted** | P1 (`audit_log`), P3 (`sendManagedEmail`) |
| **P6** | **`2026-07-25-launch-p6-migration-dormant-and-centre-v2.md`** (v1 superseded, do not implement) | Dormant-family skip in the bulk migration, `locationNeedsConfirmation` through the **hand-written field map**, centre selector + the four form edits that stop the redirect loop | - |
| **P0** | `docs/runbooks/production-cutover-checklist.md` | The cutover itself. **Already written and current** - not restated here. | all code merged |

P1, P2 and P3 are mutually independent and can run in parallel. P4 and P5 must wait on their dependencies.

> **P6 is NOT independent of P4, and the collision is semantic rather than textual.** Both edit `apps/portal/src/app/family/layout.tsx` - P6 adds a centre condition to the profile gate at `:53-56` **and its mirrored copy at `:76`**, P4 inserts `AdultClassGate` after `DisclaimerGate` and extracts a shared `earlierGatesPending(data)`. Git merges them cleanly, but if P6 lands without fixing `:76`, **P4 copies the now-incomplete guard** and a family needing centre confirmation can be routed to `/adult-class`. Land P6 Task 5 first, then rebase P4 Task 8 onto it. Both also edit `app/family/__tests__/layout.test.tsx`, which **will** conflict textually in parallel worktrees.

> **P6 was added after a coverage review** found that launch-batch spec §1.9b (dormant-family skip) and §1.9c (unknown-centre prompt) were implemented by none of P1-P5. Both are **cutover-blocking**: §1.9b changes what the production migration imports, and §1.9c is the only thing preventing an unknown-centre family from being silently assigned to Brampton forever.

---

## Global Constraints

Every task in every plan implicitly includes these. Values copied verbatim from the specs and `CLAUDE.md`.

**Repo rules**
- Commit author is always `CMT Developer <developer@chinmayatoronto.org>`. **Never** add an agent as co-author.
- **Never** use `--no-verify`. The pre-push hook runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; a failure means fix the code, not the hook.
- No em dashes in any file. Use a plain hyphen.
- Feature directories are kebab-case; React components PascalCase.
- `@cmt/shared-domain` must contain **no** React, Next, or DOM imports (lint-enforced).
- Files under `features/<a>/` must not import from `features/<b>/` (lint-enforced by `eslint-plugin-boundaries`).
- `exactOptionalPropertyTypes` is on: never assign `undefined` to an optional property - omit the key or use `null`.

**Firestore**
- All DB operations target **`chinmaya-setu-uat` only**. Never prod `chinmaya-setu-715b8`.
- Index deploys: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`. **Never `--force`** against prod.
- Any `.where().orderBy()` or multi-`where` needs an entry in `firestore.indexes.json`. Fake-firestore is index-blind, so green tests prove nothing about indexes.
- Never allocate a sequential id from a COUNT. Use `max(existing suffix) + 1` with `txn.create` (fail-closed), never `txn.set` (silent overwrite).

**Auth**
- Every new `/api/setu/*`, `/api/admin/*`, `/api/welcome/*` path needs an **explicit** `canAccessRoute` rule. The `/api/setu/` catch-all (`can-access-route.ts:311-313`) grants welcome-team; the `/api/admin/` catch-all (`:75`) is admin-only. **Never loosen either catch-all** - `/api/admin/welcome-team*` has no in-handler role check, so widening that prefix hands a role the power to grant welcome-team.
- **Never** check a role with `===`. Use `isAdmin` / `isWelcomeTeam` / `isTeacher` / `isSetuManager` from `@cmt/shared-domain`.
- Read the session with `readSessionFromHeaders(req)` (`@/lib/auth/headers`) or `getServerSession()` (`@/lib/auth/server-session`) - **never** compare the raw `x-portal-role` header string. It holds the **primary** role only; extras arrive in `x-portal-extra-roles`. A welcome-team member who is also a parent has `role='family-member'`, so a raw comparison 403s real staff.

**Testing**
- Tests ship in the **same commit** as the branching logic they cover.
- Vitest E2E suites need `fileParallelism: false`.
- E2E tests must mock `next/cache`'s `revalidateTag`, or mutation routes throw "static generation store missing".
- **Never** run the whole Playwright `setu` suite at once - it cascades the OTP rate limiter. Run per-spec.
- Any change to a `/api/setu/**` request/response shape, error code, or required field requires a dated entry in `apps/portal/docs/MOBILE_API_CHANGELOG.md`.
- Any UAT DB operation (migration, seed, backfill, index, new collection, new script, flag) requires updating `docs/runbooks/production-cutover-checklist.md` **in the same change**, including a dated §14 entry.

**The N=2 rule**
After any one-to-many change, exercise every read path with **two** of the thing, not one. The single-instance fixture is the trap that silently broke a real family's attendance on 2026-06-01.

---

## What is cuttable

If the week compresses, cut in this order. Nothing here blocks the cutover.

1. **P5 monthly pledge** - gates nothing. Families can donate normally without it. **Except P5 Task 1 (the deny-all `firestore.rules`), which is NOT part of this feature and must ship regardless.** There is no rules file in the repo today, `getClientFirestore()` is exported and live, and every family holds an authenticated Firebase session - so the database surface is currently governed by whatever is deployed in the console, which nobody has checked. Ten minutes, independent of the pledge.
2. **P4 adult study class** - additive; no existing user is affected by its absence.
3. **P3 template migration** (the 4 existing emails only) - they work today as code. Keep the `sendManagedEmail` infrastructure if P5 is shipping.
4. **P1 Track A, the coordinator role** (v2 Tasks 1-6) - additive; no existing user loses anything. Cut it whole or not at all: a partially-shipped role that clears middleware but not the handler and layout gates looks granted and reaches nothing, which is worse than not shipping it.

5. **P2's attendance UI rebuild** (v2 Tasks 3-5) - the largest single piece in the batch, on the screen every teacher uses every Sunday, and it requires migrating an existing test suite rather than extending it. The current screen works. P2 Tasks 1-2 and 6-9 deliver without it.

**Never cut:** P2's `roster-confirmation` fid bug and guest date-key fix (v2 Tasks 1-2, both live defects), and the cutover itself.

> **Corrected 2026-07-25.** This section previously listed P1's cross-family edit under "never cut" because "it fixes a live 403." **There is no live 403** - `welcome/family/[fid]/members/[mid]/page.tsx:73` gates the grade editor on `admin &&`, so welcome-team never sees it. Staff cross-family edit (v2 Track B) is a **new capability**, which makes it cuttable on the same footing as the rest, not a defect fix that must ship.

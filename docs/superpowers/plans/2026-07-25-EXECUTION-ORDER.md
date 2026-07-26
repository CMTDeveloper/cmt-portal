# Aug 3 2026 Launch - Execution Order

**Written 2026-07-25 at HEAD `1c5f31f`, at the end of the planning + rebuild pass.**
Start here. Read `docs/superpowers/reviews/README.md` second.

**Status: planning complete, implementation not started.** Six `-v2.md` plans, ~59 tasks, eight days.

---

## Rule zero

**Implement from the `-v2.md` plans only.** Every v1 is marked superseded in place and several would ship broken. If a file name has no `-v2`, it is not the plan.

**Every plan's "Review history" section is load-bearing.** It records what the rebuild itself got wrong and why. Read it before the tasks.

---

## Phase 0 - ship today, independent of everything

These three are unblocked, cheap, and each fixes something real. Nothing depends on them.

| # | What | Where | Why first |
|---|---|---|---|
| 0.1 | **roster-confirmation `fid` bug** | P2 v2 Task 1 | Live defect. `donations` is top-level, so `d.ref.parent.parent?.id` is `undefined` and completed-donation confirmation has **never** fired on the teacher roster. One-line fix, plus the fixture correction that is the actual work. |
| 0.2 | **guest date-key mismatch** | P2 v2 Task 2 | Live defect. Midweek guests are invisible to teachers. Ships with a backfill - dry-run it and check a known Sunday maps to itself, not a week earlier. |
| 0.3 | **UAT `firestore.rules` deny-all** | P5 v2 Task 1, **Steps 1-3 ONLY** | Ten minutes. There is no rules file in the repo at all. **Do not do Steps 4-5 (prod) yet** - see Blockers. |

---

## Phase 1 - the two parallel tracks

Two people can work these simultaneously. They share no files.

### Track A - authorization (P1 v2)

Strictly sequential for 1→2→3; 4 needs 1; 5 and 6 need 4 to be meaningful.

1. **P1 Task 1** - `coordinator` into the type system, atomically. Four build breaks, five silent ones. Includes `RESURRECTABLE_SEVAK_CAPS`, which is a security fix, not a type fix.
2. **P1 Task 2** - session minting. Without it a family-less coordinator cannot get a session at all, so nothing downstream is testable.
3. **P1 Task 3** - `manage-roles.ts`, all four hardcoded sites.
4. **P1 Task 4** - `canAccessRoute`. **Placement is load-bearing**: the broad `/api/admin/levels` clause must sit *below* the `:72-74` teachers regex or welcome-team loses a live capability.
5. **P1 Task 5** - the ten in-handler checks. Derive the list from Task 4's grants, not from a directory.
6. **P1 Task 6** - the two shell gates and the navs.

### Track B - staff cross-family edit (P1 v2)

Independent of Track A except Task 9.

7. **P1 Task 7** - `writeAuditLog`. **P5 depends on this.**
8. **P1 Task 8** - extract the member write core, including the required-field matrix.
9. **P1 Task 10** - grade editor for welcome-team.
10. **P1 Task 9** - staff routes. Needs Tasks 1 and 4 for its fixtures and types.

### Track C - communications (P3 v2), fully independent

11. **P3 Tasks 1-2** - `sendSesTemplatedEmail` on both sender interfaces, then the registry. **Task 2 Step 4 is the one that matters**: `sendManagedEmail` must go through `resolveSender()`, never `./ses`, or non-prod mails real families.
12. **P3 Task 3** - migrate the four emails at their real call sites.
13. **P3 Task 4** - pin the OTP exemption in code.
14. **P3 Task 5** - SMS refusal across four surfaces. **P5 depends on Tasks 1-3.**

---

## Phase 2 - the sequenced pair

**P6 Task 5 must land before P4 Task 8.** Both edit `family/layout.tsx`, and if P6 lands without fixing the mirrored guard at `:76`, P4 copies the incomplete version. Both also edit `family/__tests__/layout.test.tsx` and will conflict textually in parallel worktrees.

15. **P6 Tasks 1-4** - dormancy predicate + the parser's `locationDefaulted` (Task 1 Step 3b - without it the whole centre half is inert), the flag through **both** hand-maps, the migration skip, the PATCH.
16. **P6 Task 5** - the gate, **both copies**.
17. **P4 Tasks 1-7** - schema, `enrollFamily` params, reconcile, prune, selectable adults, the predicate, the route.
18. **P4 Task 8** - `AdultClassGate`, rebased onto P6's `:76` fix.
19. **P4 Tasks 9-12** - the move to `/donate/success`, the generic-route waiver, the payment classifier, E2E.
20. **P6 Tasks 6-7** - the four form edits and E2E.

---

## Phase 3 - the pledge (P5 v2), last

Needs P1 Task 7, P3 Tasks 1-3, and P4's `/donate/success` move.

21. **P5 Tasks 2-8** - crypto, schemas, submit, confirm/cancel, routes, indexes, admin list.
22. **P5 Task 8b** - the form. **This did not exist until the second review.**
23. **P5 Tasks 9-13** - card, sweep-as-cron, export hardening, the real security tests, UAT.

---

## Blockers that are not code

None of these can be closed by writing software. Each blocks something real.

| Blocker | Blocks | Who |
|---|---|---|
| **Export the deployed prod `715b8` ruleset as a baseline** | P5 prod rules; the `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` flip | needs the standalone check-in app's owner to confirm its access surface |
| **SES templates + `SES_CONFIGURATION_SET`** (spec O5, O8) | P3 Task 6, P5's activation email | Vaibhav |
| **The accounting hand-off**: named recipient, encrypted channel, retention limit (spec O6) | P5 Task 11 Step 2 - the highest residual risk in the feature | unassigned |
| **`PLEDGE_ENCRYPTION_KEY` backup** (spec O4) | the pledge flag flip | unassigned |
| **Adult-class screen copy** (spec O7) | P4 Task 7 | Vaibhav |

---

## Decisions the owner still has to make

Each is written into its plan as an explicit open decision, not silently resolved.

1. **P4** - a family enrolled in Bala Vihar but **not yet paid** who enrolls in the adult class gets `$101` with no recourse. Block the enroll, or waive on enrollment rather than payment?
2. **P4** - Task 11 makes free-program families read **Paid** instead of `unknown` on the default `/welcome/roster` view. That is a visible change to the primary staff screen.
3. **P4** - is "Skip" on the success page a real dismissal (needs persistence) or just "not now" (the gate brings them back)? Currently the latter.
4. **P3** - emails and phone numbers are interpolated into `console.log` in `resolve-sender.ts`, `sns.ts`, `send-code/route.ts` and become Sentry breadcrumb **messages**. Key-based redaction cannot reach positional string args. Open half of a Medium audit finding.
5. **P6** - the 299 skipped dormant families are **not findable by welcome-team** at the desk (staff search has no legacy fallback). Recorded as an accepted limit.
6. **The date.** See below.

---

## The honest read on Aug 3

~59 tasks across six plans, eight days, and **no feature code written yet**. The specs are sound and the plans are now twice-reviewed, but planning is not implementation.

If the week compresses, the cut order is in `2026-07-25-aug-3-launch-INDEX.md`. Two things in it are worth repeating:

- **The coordinator role must be cut whole or not at all.** Half-shipped it looks granted and reaches nothing.
- **P5 Task 1's UAT rules are not part of the pledge feature** and should ship even if P5 is cut entirely.

**Never cut:** P2 v2 Tasks 1-2. Both are live production defects, both are cheap, and both are already in Phase 0.

---

## How to work these plans

- **Every plan's "Review history" first.** Six for six, the rebuild introduced a defect that only the second review caught - always a confident claim about code already "verified" once. Re-check before you trust, especially anything asserting that something does *not* exist.
- **Run the second review.** It has never come back empty. Dispatch narrow reviewers that write findings to a file and return one line; returning them in the message body fails at scale.
- **`pnpm test` green does not mean shipped.** Every user-facing route needs a deployed-UAT walkthrough with a realistic multi-instance fixture. `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app` - bare `pnpm test:e2e` runs localhost.
- **Never run the whole Playwright `setu` suite** - it cascades the OTP limiter. Per-spec only.
- **Update the cutover runbook in the same commit** as any UAT DB operation. That rule has been broken once already this batch.

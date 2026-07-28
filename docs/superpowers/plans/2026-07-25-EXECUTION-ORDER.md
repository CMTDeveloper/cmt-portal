# Aug 3 2026 Launch - Execution Order

**Written 2026-07-25 at HEAD `1c5f31f`, at the end of the planning + rebuild pass.**
Start here. Read `docs/superpowers/reviews/README.md` second.

**Status as of 2026-07-27: ALL SIX PLANS ARE SHIPPED.** P1, P2, P3 (bar one step blocked on Vaibhav), P4, P5 v3 and P6 are merged to `main`. **No build work remains for launch.** What is left is three carried verification items, none cutover-blocking: the UNRUN adult-class E2E, the UNRUN pledge E2E (both need an owner flag flip on UAT), and the deferred half of P2 Task 5. 7 days to launch.

| Plan | Done | Remaining |
|---|---|---|
| **P1** roles + cross-family edit | **all 11 tasks** | - |
| **P3** communications | **Tasks 1-6** | only Task 6 Step 3 (per-template UAT send), blocked on Vaibhav's SES templates |
| **P2** teacher/visitors/roster | **Tasks 1-9** | Task 5's desktop-table/mobile-card split + detail drawer only - deferred, see the plan's Task 5 block |
| **P5** monthly pledge → **v3 plan** `2026-07-26-launch-p5-monthly-pledge-v3.md` | **all 8 tasks, SHIPPED 2026-07-27** (`d4fda47`, `e1f2143`, `07533d2`, `310c25c`, `8dd6407`, `22b6573`, `34cb977`, `b4a756e`) - see the SHIPPED block at the top of that plan for the six things the plan got wrong | **The flag stays OFF at launch.** `e2e/setu/pledge.spec.ts` is authored but **UNRUN** - it needs `NEXT_PUBLIC_FEATURE_SETU_PLEDGE=true` on UAT + a rebuild, the two Stripe env vars, and `/pad/*` live. **No new Firestore index** was needed. |
| **P4** adult study class | **all 12 tasks** | the E2E `e2e/setu/adult-class.spec.ts` is authored + fixtures seeded but **UNRUN** - it needs `NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS=true` on the UAT deploy, which diverts the shared E2E family (runbook §14 C2) |
| **P6** migration/dormant/centre | **all 7 tasks** | - |

**▶ NEXT: nothing is building. The remaining work is OWNER-GATED verification.** In priority order: (1) flip `NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS` on UAT + rebuild and run `adult-class.spec.ts` (note runbook §14 C2 - it diverts the shared E2E family); (2) same for `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` + `pledge.spec.ts`, which additionally needs `/pad/*` live and **the Stripe dashboard opened to confirm the price**; (3) P2 Task 5's deferred desktop/mobile split, which is optional. **No cutover-BLOCKING work remains.** Historical note: P6 Task 5 shipped the `layout.tsx:76` fix that **P4 Task 8 must rebase onto** - if you extract a shared `earlierGatesPending(data)` there, it MUST include `needsCentreConfirmation(data.family, data.isManager)` or a family needing centre confirmation gets routed to `/adult-class`.

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

15. ~~**P6 Tasks 1-4**~~ **DONE 2026-07-26** - dormancy predicate + `mapLocationDetailed`, the flag through **both** hand-maps, the migration skip (+ the reconciler fix so the roster does not read 299-missing forever), the PATCH.
16. ~~**P6 Task 5**~~ **DONE** - the gate, both copies, via a shared `needsCentreConfirmation()` predicate.
17. **P4 Tasks 1-7** - schema, `enrollFamily` params, reconcile, prune, selectable adults, the predicate, the route.
18. **P4 Task 8** - `AdultClassGate`, rebased onto P6's `:76` fix.
19. **P4 Tasks 9-12** - the move to `/donate/success`, the generic-route waiver, the payment classifier, E2E.
20. ~~**P6 Tasks 6-7**~~ **DONE** - the four form edits and a 5/5 deployed-UAT E2E. (Ran ahead of P4 rather than after it: they are P6-internal and share no files with P4.)
21. ~~**P2 Tasks 6-9**~~ **DONE 2026-07-26** - `/welcome/visitors` + nav (three navs, not one: admins never see `WELCOME_NAV_ITEMS`), the visitor grade filter, the roster Reset button, and the guest->teacher + `/welcome/visitors` E2E (7/7 against deployed UAT). Task 9 closed the rule-7 hole: `/welcome/visitors` had shipped with no end-to-end test at all. **Carry forward:** the guest writer takes its date from the SERVER clock, so a spec authored on a Sunday passes with Task 2's date-key fix reverted - the specs pin the writer and the reader separately for that reason. See the shipped block above Task 9 in the P2 plan.
22. ~~**P2 Tasks 3-5**~~ **DONE 2026-07-26** (`6e6cec2`, `2db63e6`, `598cc91`) - parent contact + payment verdict (bounded, index-free, batched getAll instead of the plan's fan-out), the view-model widening (allergy text to teachers AND welcome-team, per the owner), and the row restructure that finally lets a row hold a "View profile" link. **Task 5 is PARTIAL:** the desktop-table/mobile-card split and the detail drawer are deliberately deferred - that split is where every hazard in the plan lives (doubled `att-row` breaks five count assertions; doubled `data-unmarked` silently breaks "Next unmarked" on phones). **Sequenced last on purpose: this is cut candidate #5** and the single largest piece in the batch. Take it only if the week has room.

> **GAP FIXED 2026-07-26.** Items 21-22 were missing from this document entirely. It placed P2 Tasks 1-2 in Phase 0 and then never mentioned Tasks 3-9, so the teacher attendance rebuild, `/welcome/visitors`, the visitor grade filter, the roster Reset button and the guest->teacher E2E were invisible to the running order - a documentation gap, never a decision to drop them. Anyone reading only the phases would have concluded P2 was finished after Phase 0. **All 9 tasks have since shipped (2026-07-26); the gap is closed.**

---

## Phase 3 - the pledge (P5 v2), last

> **⚠️ RESCOPED 2026-07-26.** Vaibhav: the portal collects **no** bank details; monthly
> PAD is authorised on a **Stripe-hosted** page through CMT's existing Stripe service.
> The crypto module, the export script and the accounting hand-off are **deleted**, and
> with them two of the three unassigned launch blockers. The build is much smaller but
> now **BLOCKED on spec open item O9** (how the portal learns a mandate was really
> established) and on Vaibhav's integration contract. Item numbering below is stale and
> **✅ v3 PLAN NOW EXISTS: `2026-07-26-launch-p5-monthly-pledge-v3.md` - implement that, not the v2.** The Stripe contract arrived and every blocker is closed: fixed $51/month (TEST price `price_1TxTuwRNUSAfwnFqdXBP8Opi`), step 4 safe to retry, delayed outcomes reconciled by cron, cancellation manual by the temple, and the whole feature **SHIPS DARK** (`/pad/*` is TEST-only). Spec:
> `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.

Needs P1 Task 7, P3 Tasks 1-3, and P4's `/donate/success` move.

23. ~~**P5 Tasks 2-8** - crypto, schemas, submit, confirm/cancel, routes, indexes, admin list.~~ **Task 2 (crypto) DELETED.** The rest need rewriting against the Stripe model.
24. **P5 Task 8b** - the form. **This did not exist until the second review.**
25. **P5 Tasks 9-13** - card, sweep-as-cron, export hardening, the real security tests, UAT.

---

## Blockers that are not code

None of these can be closed by writing software. Each blocks something real.

| Blocker | Blocks | Who |
|---|---|---|
| ~~Export the deployed prod `715b8` ruleset~~ **CLOSED 2026-07-26** | ~~P5 prod rules~~ | Supplied by CMT Developer; committed at `firestore.prod.rules.baseline`. **P5 Task 1 Steps 4-5 need NO new prod deny** - Firestore allow rules are additive, so the `{document=**} if false` block grants nothing and `pledges`/`pledge_secrets` match no rule, i.e. they were never client-writable. The export also revealed an unauthenticated-`create` hole on `verification_codes` that let anyone mint a session as any known contact; fixed in `27b71a3` by moving the portal's OTP store to `setu_verification_codes`. |
| **SES templates + `SES_CONFIGURATION_SET`** (spec O5, O8) | P3 Task 6, P5's activation email | Vaibhav |
| ~~**The accounting hand-off**~~ **CLOSED 2026-07-26** | ~~P5 Task 11 Step 2~~ | **Deleted with the feature's bank-detail collection.** No decrypted file, no recipient, no retention limit - there is nothing to hand off. |
| ~~**`PLEDGE_ENCRYPTION_KEY` backup**~~ **CLOSED 2026-07-26** | ~~the pledge flag flip~~ | **Deleted - nothing is encrypted any more.** |
| **Stripe PAD integration contract** (spec O9) - how the portal learns a mandate was established, the PAD payload, cancellation, and test-mode creds | ALL of P5's remaining build | **Vaibhav** |
| **Adult-class screen copy** (spec O7) | P4 Task 7 | Vaibhav |

---

## Decisions the owner still has to make

Each is written into its plan as an explicit open decision, not silently resolved.

1. **P4** - a family enrolled in Bala Vihar but **not yet paid** who enrolls in the adult class gets `$101` with no recourse. Block the enroll, or waive on enrollment rather than payment?
2. **P4** - Task 11 makes free-program families read **Paid** instead of `unknown` on the default `/welcome/roster` view. That is a visible change to the primary staff screen.
3. **P4** - is "Skip" on the success page a real dismissal (needs persistence) or just "not now" (the gate brings them back)? Currently the latter.
4. **P3** - emails and phone numbers are interpolated into `console.log` in `resolve-sender.ts`, `sns.ts`, `send-code/route.ts` and become Sentry breadcrumb **messages**. Key-based redaction cannot reach positional string args. Open half of a Medium audit finding.
5. ~~**P6** - the 299 skipped dormant families are **not findable by welcome-team** at the desk~~ **ACCEPTED + RECORDED 2026-07-26** in runbook §6 step 2. Confirmed in code: `searchFamilies` and `/welcome/roster` query only `collection('families')` with no legacy fallback, unlike sign-in and the kiosk. All 299 are dormant with no active child, so expected desk traffic is near zero.
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
- **`pnpm test` green does not mean shipped.** Every user-facing route needs a deployed-UAT walkthrough with a realistic multi-instance fixture. Run **bare `pnpm test:e2e`**: since 2026-07-28 the default target is **Preview** (`https://cmt-setu-preview.vercel.app`), defined once in `e2e/_helpers.ts` (`E2E_BASE_URL`), which `playwright.config.ts` imports. **Never set `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app`** - that is Production, and from the Aug 3 cutover it serves real families out of `715b8`. This suite is NOT read-only: it seeds families, enrols children, starts pledges and rewrites `app_config` (a disclaimers-version bump re-gates every family). Preview is pinned to `chinmaya-setu-uat` permanently, which is why the default lives there.
- **Never run the whole Playwright `setu` suite** - it cascades the OTP limiter. Per-spec only.
- **Update the cutover runbook in the same commit** as any UAT DB operation. That rule has been broken once already this batch.

# Cross-Plan Coverage Review - Aug 3 Launch Batch

**Scope:** requirements that fell BETWEEN plans. Single-plan internals are out of scope (other reviewers).
**Reviewed:** 4 specs (launch-batch, monthly-pledge, adult-study-class, ses-templates) vs INDEX + P1-P6.
**Date:** 2026-07-25. Baseline `main` @ `b1395e0`.

---

## Verdict

**Status: FAIL (coverage)** - 12 UNCOVERED, 11 PARTIAL, 6 INDEX defects.

Three of the uncovered items are launch-day blocking:
- **G3** domain re-point has no runbook entry and no owner task (verified absent from the runbook)
- **G8** the adult-class ask never lands on the donation success page, which is the *only* placement the spec names, and P5 builds on top of it
- **G9** the monthly-pledge submit form is not built by any task, yet P5's own E2E submits one

---

## Full requirement table

Legend: **C** covered · **P** partial · **U** uncovered · **N/W** no work needed (owner/decision only)

### Spec A - `2026-07-24-aug-3-launch-batch-design.md`

| ID | § | Requirement | Status | Plan + task | Note |
|---|---|---|---|---|---|
| A-0a | 0 | welcome-team keeps its name everywhere | C | - | no work; no plan renames it |
| A-0b | 0 | Coordinator is a new role | C | P1 T1-T4 | |
| A-0c | 0 | W&R full family edit + audit log | C | P1 T5-T9 | |
| A-1.8 | 1.8 | SES ready / SNS sandboxed (measurement) | N/W | - | drives A-8.0 |
| A-M1 | 1.9a | Refresh `.rtdb-snapshot` before the prod migration | **C** | runbook §6 "STEP 0" | **verified present** at `production-cutover-checklist.md:117-120`. Spec §12 M1 is stale. |
| A-DA | 1.9a | Bulk-migrate at cutover | C | runbook §6 step 2 | verified in §14 2026-07-24 entry |
| A-DB1 | 1.9a | Do NOT run the BV backfill | C | runbook §6 step 8 | verified |
| A-DB2 | 1.9a/§12 | Delete the stale "Recommended for launch" sentence | **C** | runbook already amended | **verified done** at `:172`. Spec §12 D-B is stale. |
| A-DB3 | 1.9a/10 | **Verify "Not in this class yet" is visibly populated per level on launch Sunday** | **U** | none | listed as a spec requirement *and* a §10 cutover-band item. No plan task, no runbook step, no E2E. |
| A-1.9b | 1.9b | Dormant-family skip in the bulk migration | C | P6 T3 | predicate + wiring + csv + dry-run expectation + runbook |
| A-1.9b2 | 1.9b | Grade-first self-heal via `birthMonthYear: null` | N/W | P6 self-review | already true |
| A-1.9c1 | 1.9c | Skipped families stay findable | N/W | P6 self-review | legacy fallback already exists |
| A-1.9c2 | 1.9c | `locationNeedsConfirmation` schema field | C | P6 T2 | |
| A-1.9c3 | 1.9c | Parser reports the defaulted centre | C | P6 T1 | |
| A-1.9c4 | 1.9c | Gate diverts on the flag | C | P6 T4 S3 | |
| A-1.9c5 | 1.9c | Centre selector on `/complete-profile` + clear on save | C | P6 T4 S4-S5 | |
| A-1.9c6 | 1.9c | **Bonus: welcome-team "families with an unconfirmed centre" work queue** | U | none | spec calls it a bonus; low priority but nobody owns it |
| A-2.1 | 2.2.1 | Extract member-write core, `fid` as parameter | C | P1 T6 | |
| A-2.2 | 2.2.2 | 4 staff routes (POST/PATCH/DELETE members, PATCH family) | C | P1 T7, T8 | |
| A-2.3 | 2.2.3 | `canAccessRoute` clauses above the generic `/api/welcome/` | C | P1 T7 S4 | |
| A-2.4 | 2.2.4 | `audit_log` written in the same transaction | C | P1 T5 | |
| A-2.5 | 2.2.5 | Edit affordances on `/welcome/family/[fid]` **and** `/welcome/family/[fid]/members/[mid]` | **P** | P1 T9 (parent page only) | the `[mid]` detail page gets only the `MemberGradeEditor` repoint (T8 S4). No general edit affordance there. |
| A-2.6 | 2.2.6 | Fix the `MemberGradeEditor` 403 | C | P1 T8 | |
| A-2.7 | 2.2.7 | **Last-manager guard must hold on the staff paths too** | **P** | P1 T6 S2 (preserve only) | the guard is preserved in the extraction, but no test in T7/T8 asserts it fires when *staff* demote a family's last manager. Spec calls this out explicitly. |
| A-2.8 | 2.3 | `audit_log` into the runbook collection list | C | P1 T5 S5 | |
| A-2.9 | 2.3 | Read roles via helpers, never `x-portal-role` | C | P1 T7 S1 test 3 | |
| A-3.1 | 3.2 | All 14 coordinator touchpoints | C | P1 T1-T4 | every row of the §3.2 table appears |
| A-3.2 | 3.3 | Exact route-rule placement + `/welcome` redirect allowance | C | P1 T3 S3 | includes the `/api/admin/levels` ordering regression |
| A-3.3 | 3.4 | Negative authorization tests | C | P1 T3 S1 | |
| A-4.1a | 4.1 | Desktop **table columns** (Student, Grade/Level, Primary Parent, Contact, Donation, View, Attendance) | C | P2 T5 S3 | |
| A-4.1b | 4.1 | **4 stat cards** ENROLLED·PRESENT·UNMARKED·**ABSENT** | **P** | none | code today has a **3-up** summary (`attendance-marker.tsx:396-416`). No P2 step adds the 4th. |
| A-4.1c | 4.1 | **Filter chips All/Present/Unmarked/Absent, each with a count** | **P** | none | code today is a **2-way** `'all' \| 'unmarked'` filter (`:140`, `:483-487`). No P2 step widens it. |
| A-4.1d | 4.1 | **Info banner** "Tap a student to mark Present. Anyone left unmarked will automatically be recorded Absent." | **U** | none | string absent from the codebase; no P2 step adds it |
| A-4.1e | 4.1 | **Date navigator** `‹` · date picker · `›` | **P** | none | the page reads `?date=` (`attendance/page.tsx:26`) but no prev/next control is specified in any P2 step |
| A-4.1f | 4.1 | Header buttons `Visitors (n)` / `Previous students (n)` with counts | **P** | none | not named in any P2 step |
| A-4.1g | 4.1 | Footer bar (n Present · n Unmarked · ✓ Auto-saves) | P | partial in code (`:694`) | no P2 step covers the Present/Unmarked halves |
| A-4.2 | 4.2 | Mobile cards | C | P2 T5 S3 | |
| A-4.3a | 4.3 | Safety block in the drawer | C | P2 T5 S4 | |
| A-4.3b | 4.3 | **Accessible label on the red safety dot** ("it is currently a bare visual") | **P** | none | explicitly required by the spec; no P2 step |
| A-4.4 | 4.4 | Bulk collectionGroup reads + index audit | C | P2 T3 | `paymentFromAmounts` verified to exist at `roster/payment.ts:7` |
| A-4.5 | 4.5 | Row restructure away from `<button>` | C | P2 T5 S1/S3 | |
| A-5.1 | 5.1 | Guest date-key defect D1 | C | P2 T2 | incl. backfill script |
| A-5.2 | 5.2 | `/welcome/visitors` | C | P2 T6 | |
| A-5.3 | 5.3 | **UI→UI guest→teacher Playwright E2E** | **U** | none | P2's self-review claims "T5 S6 and T6". T5 S6 is the *teacher attendance* spec and never submits the guest form; **T6 has no E2E step at all**. This is the exact gap `e2e/legacy/b1-kiosk.spec.ts:22` was flagged for, and it is still open. |
| A-5.4 | 5.4 | Visitor grade filter | C | P2 T7 | |
| A-6 | 6 | Roster Reset, `?year=` untouched | C | P2 T8 | |
| A-7 | 7 | Old-portal shutdown | N/W | owner: CMT Developer | out of spec scope |
| A-8.0 | 8.0 | SMS sign-in refused with a typed error, flag-gated | C | P3 T5 | |
| A-8.2a | 8.2 #1 | **`+1`/NANP gate in `send-code` → `400 phone-country-unsupported`** | **U** | none | §8.0: "*The gate is written and tested now, dormant until then.*" P3 T5 implements only `sms-signin-unsupported`. The dormant country gate exists in **no plan**. |
| A-8.2b | 8.2 #2 | Same gate mirrored in `verify-code` | **U** | none | as above |
| A-8.2c | 8.2 #3 | Sign-in client pre-check + hint/placeholder | C | P3 T5 S5 | |
| A-8.2d | 8.2 #4 | `sns.ts` belt-and-braces non-`+1` refuse + log | **U** | none | P3 self-review **declares** this deliberately skipped with a reason. Recorded so it is a decision, not a loss. |
| A-8.2e | 8.2 #5 | Mobile API changelog | C | P3 T5 S7 | |
| A-8.3 | 8.3 | Country check before any lookup (anti-enumeration) | C | P3 T5 S1 test 2 | |
| A-8.5/O3 | 8.5 | **Read-only count of pre-`69132b1` corrupted international phone keys** | **U** | none | "worth a read-only scan during cutover" - no script, no runbook step, no owner task |
| A-9a | 9 | `audit_log` → runbook §3 | C | P1 T5 S5 | |
| A-9b | 9 | New indexes → §5, no `--force` | C | P2 T3 S5 | |
| A-9c | 9 | Dated §14 entry for the batch | C | P1/P2/P5/P6 each | |
| A-9d/O1 | 9 | **Domain re-point `setu.chinmayatoronto.org` (`cmt-setu-coming-soon` → `cmt-setu`): runbook entry + owner + rehearsal** | **U** | none | **Verified absent** - grep for `coming-soon`/`re-point`/`setu.chinmayatoronto.org` across `production-cutover-checklist.md` returns nothing. The INDEX asserts P0 is "already written and current"; it is not. |
| A-11a | 11 | Fixture must include staff who is ALSO a family member | P | P1 T7 unit test only | T9 S6 E2E says "the welcome-team persona"; nothing pins that persona is also a parent |
| A-11b | 11 | **Coordinator claims must survive sign-in - test by signing in** | **P** | P1 T2 (unit) | the only live sign-in as coordinator is **P4 T7 S3**. P1 cannot verify its own §11 trap without P4. |
| A-11c | 11 | Audit rows in the same txn, both directions tested | C | P1 T5, P5 T3 | |
| A-O6 | 12 | Open AWS SNS support cases | N/W | owner | |
| A-O7 | 12 | **Confirm Stripe live mode / `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` at launch** | **U** | none | unowned in every plan, yet **P4 and P5 both place their primary UI on `/family/donate/success`**. If donations stay flag-off at launch, both features are invisible. See X5. |
| A-O8 | 12 | Promote SES/SNS diagnostics into `scripts/` | **U** | none | labelled "follow-up"; still unowned |
| A-O4 | 12 | Reset leaves `?year=` | C | P2 T8 S3 | |
| A-O5 | 12 | Teacher-visible donation/contact privacy | N/W | recorded | |

### Spec B - `2026-07-25-monthly-pledge-pad-design.md`

| ID | § | Requirement | Status | Plan + task | Note |
|---|---|---|---|---|---|
| B-2 | 2 | Locked decisions (no upload, encrypted, separate status, manual confirm, purge-on-confirm, $50 min, placement, card persists, read-only v1, SES email) | C | P5 T1-T6 | |
| B-4.1 | 4.1 | `pledges/{pid}` doc | C | P5 T2 | |
| B-4.2 | 4.2 | `pledge_secrets/{pid}`, no read path, outside `/api/setu/*` | C | P5 T2, T4 | |
| B-4.3 | 4.3 | AES-256-GCM, `keyVersion`, key custody, turbo.json | C | P5 T1 | |
| B-4.4a | 4.4 | `app_config/pledge` document | C | P5 T7 S1 (seed) | |
| B-4.4b | 4.4 | **`app_config/pledge` is ADMIN-EDITABLE in the portal** ("no external CMS", repo rule) | **U** | none | every sibling config has an admin page (`/admin/{disclaimers,locations,school-year,donation-periods,volunteering-skills}` all exist). P5 only *seeds* the doc. No `/admin/pledge`. |
| B-4.4c | 4.4 | **`enabled: boolean` kill switch** | **U** | none | no task reads it. The form, card and route never check it, so the documented kill switch does nothing. |
| B-4.4d | 4.4 | `suggestedAmounts` + ask-card copy fields | **U** | none | not consumed anywhere; the card copy is hardcoded in P5 T5 |
| B-5 | 5 | Placement: success page primary, dashboard secondary, nowhere else | C | P5 T5 S4 | but see X2 (ordering depends on P4) |
| B-5.1 | 5.1 | State-driven card, never disappears | C | P5 T5 | |
| B-6.1a | 6.1 | **The pledge submit FORM (amount + 4 bank fields)** | **U** | none | P5's File Structure and all 7 tasks build crypto, schemas, writes, routes, card, scripts and E2E - **no task builds the form**. T7 S2's E2E step "submit a pledge with valid bank details" has no UI to drive. |
| B-6.1b | 6.1 | `POST /api/pledges` manager-only, fid from session | C | P5 T4 | |
| B-6.2 | 6.2 | Confirm = status flip + purge + audit, one txn | C | P5 T3 | |
| B-6.3 | 6.3 | Cancel | C | P5 T3 | |
| B-6.4a | 6.4 | 90-day backstop sweep | C | P5 T6 | |
| B-6.4b | 6.4 | **Stale-pledge report (~14 days) so a human notices first** | **U** | none | P5 self-review **declares** the deferral and asks the reviewer to confirm. Confirming here: without it, the first signal of a forgotten pledge is a silent purge 90 days later. Recommend a one-line query in the sweep script's dry-run output rather than a new surface. |
| B-7.1 | 7.1 | `sendTemplatedEmail`, `Sender`, mock, template-name-as-config | C | P3 T1-T2 | |
| B-7.2 | 7.2 | **`pledge-activated` variable contract written down** | **P** | P3 T3 S6 covers the *four migrated* emails | `docs/runbooks/ses-email-templates.md` is created in P3 before `pledge-activated` exists, and P5 never adds its row. Spec O5 says a mismatch fails at send time, not build time. |
| B-7.3 | 7.3 | Send outside the txn; a missing template cannot roll back | C | P5 T4 S4 + test | |
| B-8 | 8 | Security posture | C | P5 T1, T4 | |
| B-10 | 10 | Verification 1-7 | C | P5 T1-T7 | modulo B-6.1a: the E2E cannot run without a form |
| B-O2 | 11 | Confirm/cancel = admin only | C | P5 T4 S4 | |
| B-O6 | 11 | Accounting hand-off documented | C | P5 T6 S5 | |
| B-O7 | 11 | Bank-field digit lengths | C | P5 T2 | Canadian defaults shipped |

### Spec C - `2026-07-25-adult-study-class-design.md`

| ID | § | Requirement | Status | Plan + task | Note |
|---|---|---|---|---|---|
| C-2.1 | 2.1 | Five gate conditions | C | P4 T4 | |
| C-2.2 | 2.2 | Selectable = non-teaching adults | C | P4 T3 | |
| C-2.3 | 2.3 | Matrix rows 1-7, row 7 asserted twice | C | P4 T3 + T4 | |
| C-3.2 B1 | 3.2 | `positive()` → `nonnegative()` | C | P4 T1 | |
| C-3.2 B2 | 3.2 | `enrolledMids` self-heal | C | P4 T2 | |
| C-3.2 B3 | 3.2 | Payment summed across programs | N/W by design | §4.2 says it dissolves | but see C-6.5 |
| C-4.1 | 4.1 | The program definition | C | P4 T7 | |
| C-4.2 | 4.2 | Zero override + the `??` regression test | C | P4 T1 | |
| C-4.3a | 4.3 | **Ask on the DONATION SUCCESS PAGE, immediately after the BV donation** | **U** | none | P4 builds `/adult-class` (gate destination) and wires `AdultClassGate` into `/family/layout.tsx`. **No P4 task touches `apps/portal/src/app/family/donate/success/page.tsx`** (the file exists). The spec names the success page as *the* placement and spends a paragraph on ask ordering there. |
| C-4.3b | 4.3 | Multi-select, minimum one, all free | C | P4 T5 | |
| C-4.3c | 4.3 | Copy explains "one parent present during BV classes" | C | P4 T5 S5 | placeholder pending O7 |
| C-4.3d | 4.3 | **A family who SKIPS must be able to return via a state-driven dashboard card** | **U** | none | spec: "*surfaced on the family dashboard*", explicitly modelled on the pledge card. No P4 task. (The gate re-fires, which is *a* recovery, but not the specified affordance and not equivalent for a family who dismissed it mid-flow.) |
| C-4.3a2 | 4.3a | Adult-only family pays $101 via existing Stripe | C | P4 T7 S4 (verify) | |
| C-4.3a3 | 4.3a | **`no-eligible-members` copy is BV-specific and "would read as nonsense here"** | **P** | P4 T7 S4 notes it | flagged, never fixed. No task changes `enroll-cta.tsx:68-69`. |
| C-4.3b2 | 4.3b | Amount editable by admin **and coordinator** | C | P1 T3 (grant) + P4 T7 S3 (verify) | correctly declared in INDEX |
| C-4.4 | 4.4 | `isTeacherAssigned`, pending invites, zero-level teachers | C | P4 T3 | |
| C-4.5a | 4.5 | Adult-first then BV (O3) | N/W | open item | |
| C-4.5b | 4.5 | Exemption survives a BV cancel | N/W | persisted at enroll | |
| C-4.5c | 4.5 | Selected parent removed → reselect prompt | C | P4 T2 test 2 + T4 test 7 | |
| C-4.6 | 4.6 | R1 top-level route, R2 hard nav, R3 trust the write, R4 gate order | C | P4 T5 S5, T6 S3 | |
| C-4.6.1 | 4.6.1 | Term scoping | C | P4 T4 test 8 | |
| C-5 | 5 | `roster-confirmation.ts:77` fid bug | C | **P2 T1** | cross-plan; INDEX never attributes this spec to P2 |
| C-6.5 | 6 | **Regression: fully-paid BV family + exempt adult enrollment still reads `paid`, not `outstanding`** | **P** | none | P4's self-review maps "§6 verification 1-7 → Tasks 1-7" but **no task carries this assertion**. It is the one test that pins B3 having dissolved. P2 T3 builds a *second* payment derivation for attendance; neither plan tests the two together. |
| C-6.7 | 6 | Confirm no new index shape before shipping | P | none | one-line confirmation step, unowned |
| C-O7 | 7 | Vaibhav's gate copy | N/W | owner | |

### Spec D - `2026-07-25-ses-managed-email-templates-design.md`

| ID | § | Requirement | Status | Plan + task | Note |
|---|---|---|---|---|---|
| D-1 | 1 | Every non-OTP email via an SES template; OTP exempt | C | P3 T3, T4 | |
| D-3.1-4 | 3 | `sendTemplatedEmail`, `Sender`, mock, config | C | P3 T1, T2 | |
| D-3.5-6 | 3 | Amended by §4.2 - keep templates + dispatcher | C | P3 T3 S4 | |
| D-4.1 | 4.1 | Fallback matrix, all 3 rows | C | P3 T2 S1 | four tests |
| D-5 | 5 | Operational constraints (region, turbo.json, variable contract) | C | P3 T1 S0, T2 S3 | |
| D-6.1 | 6 | **Per-template real UAT send before relying on it** | **P** | none | P3 has no UAT-send verification step (T5 S8 verifies the sign-in UI only). Gated on O2 (Vaibhav's templates), but nobody owns the send-and-check. |
| D-6.2 | 6 | Variable-contract test per template | C | P3 T3 S1 | four templates; `pledge-activated` missing - see B-7.2 |
| D-6.3 | 6 | `resolveSender()` still governs | C | P3 T1 S4 | |
| D-6.4/6.7 | 6 | OTP never touches the templated path | C | P3 T4 | |
| D-6.5 | 6 | Wrong template name → pledge stays active | C | P5 T4 | |
| D-O4 | 7 | Retire/narrow `renderEmailTemplate`, fix its `as any` | N/W | deferred by §4.2 | owner CMT Developer |

---

## The gaps, ranked

### UNCOVERED (nothing in any plan implements these)

| # | Gap | Spec | Risk | Suggestion |
|---|---|---|---|---|
| **G1** | **`+1`/NANP country gate (`phone-country-unsupported`)** in `send-code` + `verify-code`. §8.0 says it is "written and tested now, dormant"; P3 ships only the SMS-off refusal. | A §8.2 #1-2 | med | Add as P3 Task 5b. ~20 lines + tests. Without it, flipping `NEXT_PUBLIC_FEATURE_SMS_OTP=true` later silently bills undeliverable international SMS. |
| **G2** | **Guest→teacher UI→UI Playwright E2E.** P2's self-review claims coverage that does not exist: T5 S6 is the attendance spec and never submits the guest form; T6 has no E2E step. | A §5.3 | **high** | Add an explicit step to P2 T6: kiosk guest form → assert the child in the teacher visitors panel. This is also the only end-to-end proof of the T2 `sessionDate` fix. |
| **G3** | **Domain re-point runbook entry + rehearsal.** Verified absent from `production-cutover-checklist.md`. INDEX claims P0 is "already written and current". | A §9, O1 | **high** | Add a §6 step + a rehearsal. Launch-day, no rollback rehearsed, no owner task. |
| **G4** | **Scan for pre-`69132b1` corrupted international phone keys.** | A §8.5, O3 | low | 15-line read-only script; add to P6 or the runbook §6 read-only checks. |
| **G5** | **Stripe live-mode / `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` launch decision.** | A O7 | **high** | Both P4 and P5 hang their primary UI off `/family/donate/success`. Unresolved, this decision silently determines whether either feature is reachable. Needs an answer before P4/P5 start. |
| **G6** | **Promote SES/SNS diagnostics into `scripts/`.** | A O8 | low | The ad-hoc script from the design pass is lost; the next diagnosis rewrites it. |
| **G7** | **Verify "Not in this class yet" is populated per level on launch Sunday.** | A §1.9a, §10 | med | It is the *entire* justification for D-B (skipping the BV backfill). No task, no runbook step. Add to runbook §6 as a post-migration check. |
| **G8** | **The adult-class ask on `/family/donate/success`.** P4 builds only the gate route. | C §4.3 | **high** | The spec's named placement. P5 T5 S4 and P5 T7 S2 both *assume* it exists ("after the adult-class selection"), so P5's E2E asserts an ordering nothing produces. |
| **G9** | **The monthly-pledge submit FORM.** No task in P5 builds it. | B §6.1 | **high** | P5 T7 S2's E2E drives a form that does not exist. Add a task between T4 and T5. |
| **G10** | **`app_config/pledge` admin editor + the `enabled` kill switch.** | B §4.4 | med | Every sibling config has an admin page. The documented kill switch is never read, so it does not work. |
| **G11** | **Stale-pledge report (~14 days).** P5 declares the deferral and asks for confirmation. | B §6.4 | med | Recommend accepting the deferral **only** if the sweep's dry-run prints pending-age, otherwise the first signal is a silent 90-day purge. |
| **G12** | **`sns.ts` non-`+1` refuse+log.** P3 declares this deliberately skipped, with a sound reason (it would drop prasad/join-request notices to international numbers this batch keeps collecting). | A §8.2 #4 | low | Accept the deviation; make sure it is revisited when the SMS flag flips (tie it to G1). |

### PARTIAL

| # | Gap | Spec | Missing |
|---|---|---|---|
| **P1g** | Teacher attendance chrome | A §4.1 | 4th stat card (**ABSENT**; code has a 3-up summary at `attendance-marker.tsx:396-416`), 4-way filter chips with counts (code has 2-way `'all'\|'unmarked'` at `:140`,`:483-487`), the **info banner** copy, the `‹ ›` date navigator, header `Visitors (n)` / `Previous students (n)` buttons, the Present/Unmarked footer halves. P2 T5 specifies **only** columns + drawer + mobile cards. |
| **P2g** | Accessible label on the red safety dot | A §4.3 | spec: "it is currently a bare visual". No P2 step. |
| **P3g** | Edit affordances on `/welcome/family/[fid]/members/[mid]` | A §2.2.5 | only the grade-editor repoint lands there |
| **P4g** | Last-manager guard on the **staff** write paths | A §2.2.7 | preserved by the refactor, never asserted for a staff actor |
| **P5g** | B3 roster-payment regression test | C §6.5 | no task asserts a paid BV family + exempt adult enrollment still reads `paid` |
| **P6g** | `no-eligible-members` BV-specific copy | C §4.3a | flagged in P4 T7 S4, never fixed |
| **P7g** | Per-template real UAT send | D §6.1 | unowned |
| **P8g** | `pledge-activated` row in `docs/runbooks/ses-email-templates.md` | B §7.2 / D O2 | P3 writes the doc before the name exists; P5 never adds to it |
| **P9g** | `sendManagedEmail` fallback for `pledge-activated` | B §7 + D §4.1 | **cross-plan interface hole:** P3's matrix row 1 is "no template configured → use the code template", but `pledge-activated` has **no** code template by design, and P5 T4 S4 passes no `fallback`. Behaviour when unconfigured is undefined. Decide: either P3's signature makes `fallback` required-or-explicitly-null with a documented no-fallback path, or P5 ships a minimal code fallback. |
| **P10g** | Coordinator claims-survive-sign-in verified live | A §11 | only exercised in P4 T7 S3 |
| **P11g** | Mobile API changelog for P6 | repo rule | **P6 has no changelog step** despite changing `FamilyDocSchema` (a `@cmt/shared-domain` schema `/api/setu/*` routes use) and widening `PATCH /api/setu/family` to accept `location`. P1/P3/P4/P5 all have one; P6 does not. P4 likewise logs `POST /api/setu/adult-class` but not the `EnrollmentDocSchema` widening (`suggestedAmountOverride` 0, `membershipMode`) that the mobile mirrors. |

---

## INDEX defects

| # | Defect | Evidence |
|---|---|---|
| **X1** | **Wrong filename.** INDEX row P3 points at `2026-07-25-launch-p3-ses-templates.md`. The file on disk is `2026-07-25-launch-p3-communications.md`. An agent following the INDEX cannot open it. |
| **X2** | **P3's "Covers" column omits the SMS sign-in posture entirely** ("sendTemplatedEmail, Sender interface, code-template fallback, migrate 4 templates"). P3 Task 5 is the *only* home for launch-batch §8. Anyone auditing coverage from the INDEX concludes §8 is unowned - which is precisely what P2's self-review warned about. |
| **X3** | **Undeclared dependency P1 ↔ P2 (visitors).** P1 T3 grants `/welcome/visitors` + `/api/welcome/visitors`; P1 T1's `ROLE_REFERENCE` advertises "See the visitor list (/welcome/visitors)"; P1 T4's sidebar **test** asserts a visitors link renders for a coordinator. The page is built in **P2 T6**. Conversely P2 T6 S4 states outright: "*canAccessRoute already grants /welcome/\* to welcome-team and (from P1 Task 3) coordinator*". Each plan consumes the other; INDEX lists both as depending on nothing. |
| **X4** | **Undeclared dependency P5 → P4.** P5 T5 S4: place the pledge card "**after the adult-class selection (P4)**". P5 T7 S2 E2E: "*see the pledge ask after the adult-class selection*". INDEX lists P5 as depending on P1 + P3 only. Compounded by G8 - the thing P5 orders itself against is never built. |
| **X5** | **P4's spec §5 item is implemented in P2.** The adult-study-class spec's roster-confirmation `fid` bug is P2 T1. The INDEX's source-spec-to-plan mapping never shows the adult-study-class spec touching P2, so cutting P2 would silently drop an adult-study-class deliverable. |
| **X6** | **P6 is missing from both cut lists.** "What is cuttable" enumerates P5, P4, P3, P1; "Never cut" names P1's cross-family edit, P2's two defect fixes, and the cutover. P6 - which the INDEX itself calls **cutover-blocking** 40 lines earlier - appears in neither. Also **P0 is asserted "already written and current"**, which G3 disproves. |

---

## Answer to the specific questions asked

**Does P6 fully cover launch-batch §1.9b and §1.9c?**
**Yes, on the substance** - and the two "already works, no code needed" claims in its self-review are correct. Confirmed complete: the dormancy predicate with the literal-`"NULL"` trap encoded as a test (T3), the `locationDefaulted` parser signal (T1), the additive nullable schema field with the "absence must not gate all 867 families" test (T2/T4), the gate extension, the centre selector, the flag-clear-on-save, the `--csv-out` auditability, and the ~299/~568 dry-run tripwire. The bulk path inherits the flag correctly because `migrate-legacy-families.ts` writes through `lazyMigrateLegacyFamily()`.
**Two things missing:** the §1.9c "bonus" work queue (A-1.9c6, low), and **the mobile API changelog entry (P11g)** - P6 changes a shared-domain doc schema and a `/api/setu/family` request shape with no changelog step, which every other plan includes.

**Same class of gap elsewhere?** Yes, three:
- **G8** (adult-class success-page ask) is the exact analogue: a placement the spec names as primary, implemented by no plan, with a *sibling plan already building on top of it*.
- **G9** (pledge form) is worse: a plan's own E2E drives a UI no task creates.
- **G2** (guest→teacher E2E) is the same failure mode as the original 1.9b/1.9c miss - a self-review asserting coverage that the steps do not deliver.

**Do the INDEX dependency claims hold?**
P4→P1 and P5→P1+P3 are correct. **Three real consumptions are unlisted:** P1↔P2 (X3), P5→P4 (X4), and P4's spec item living in P2 (X5). Plus P1's own §11 verification trap can only be exercised from P4 (P10g).

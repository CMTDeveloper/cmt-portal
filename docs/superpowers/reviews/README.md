# Plan reviews - Aug 3 2026 launch batch

Seven independent reviews of the Aug-3 launch plans, run 2026-07-25 against the
codebase at `main` @ `b1395e0`. Each reviewer took one plan (or the cross-plan
coverage question), verified every `file:line` claim against real code, and
wrote its findings here.

**Verdict: the plans are NOT executable as written.**

| Report | Critical | Major | Minor |
|---|---|---|---|
| `2026-07-25-review-p1.md` | **7** | 14 | 7 |
| `2026-07-25-review-p2.md` | 2 | 9 | 6 |
| `2026-07-25-review-p3.md` | 3 | 7 | 6 |
| `2026-07-25-review-p4.md` | 3 | 8 | 7 |
| `2026-07-25-review-p5.md` | 2 | 10 | 14 |
| `2026-07-25-review-p6.md` | 2 | 7 | 7 |
| `2026-07-25-review-coverage.md` | 12 uncovered · 11 partial · 6 INDEX defects | | |
| `2026-07-25-review-p1v2-authz.md` | 2 | 9 | 7 |
| `2026-07-25-review-p1v2-exec.md` | 6 | 14 | 11 |
| `2026-07-25-review-p2v2.md` | 1 | 16 | 14 |
| `2026-07-25-review-p3v2.md` | 1 | 9 | 10 |
| `2026-07-25-review-p4v2.md` | 2 | 15 | 8 |
| `2026-07-25-review-p5v2.md` | 2 | 9 | 10 |
| `2026-07-25-review-p6v2.md` | 2 | 6 | 8 |

**All six plans have been rebuilt and re-reviewed.** Each `pN` report reviewed the original
plan; each `pNv2` report reviewed the rebuild. Every finding is folded into the v2 plans -
read the reports for the reasoning, not as an open to-do list. **Do not implement any v1
file**; each is marked superseded in place.

**The pattern, now with n=6: every single rebuild introduced a new defect that only the
second review caught.** In each case it was a confident claim about scope, defaults, or
what does or does not exist, made about code that had already been "verified" once:

| Rebuild | The defect the rebuild itself introduced |
|---|---|
| P1 v2 | Widened `Capability` but not `RESURRECTABLE_SEVAK_CAPS` - a privilege-retention hole its own Task 2 made reachable |
| P2 v2 | Called a **program-scoped** fid set "level-scoped, 20-40", reintroducing the exact fan-out its own Global Constraints forbid |
| P3 v2 | Created two same-named callables and omitted which to use - the natural import bypasses the allowlist and mails real families from a test run |
| P4 v2 | Proposed a pathname-keyed layout exemption: the precise pattern its own R1 forbids, and the outage `family/layout.tsx:23-32` records |
| P5 v2 | **Would have taken the live door app down on launch Sunday** - see below |
| P6 v2 | Depended on a parser field (`locationDefaulted`) that does not exist and no task created, leaving the feature inert again |

**Budget for the second pass. It is not optional, and it has never come back empty.**

## The finding that outranks everything else

**P5 v2 C1 - a deny-all `firestore.rules` deployed to prod `715b8` breaks the door app.**

The plan asserted, including *inside the rules file it told you to ship*, that "nothing
legitimate uses the client SDK for data". True of this repo - and false of the database.
`/Users/dineshmatta/projects/chinmaya-family-check-in/app/lib/firebase/config.ts:26` is
`getFirestore(app)` (the **client** SDK) against `chinmaya-setu-715b8`, reading and writing
`family-check-ins` and `guest-families` from `'use client'` pages - the collections the
cutover runbook marks **DO NOT TOUCH**.

A rules deploy *replaces* the ruleset. Blast radius: kiosk check-in, family self check-in,
the teacher check-in screen, the teacher report, guest check-in - on the path CLAUDE.md
calls the current production entry point. Neither repo tracks a rules file, so there is no
rollback artifact.

It was answerable from the filesystem in ninety seconds, and the plan framed it as a
formality. **UAT deny-all is correct and safe; prod needs the deployed ruleset exported as
a baseline first, then two targeted denies added on top.**

## The three findings that outrank the rest

**1. Sentry had no repo-defined privacy posture (P5 CRITICAL-1). ✅ FIXED 2026-07-25 —
and the finding as written was overstated.**
The monthly-pledge spec listed "never sent to Sentry" as a control; it was an assertion,
never an implementation, and no `beforeSend` scrubber existed anywhere in the repo. That
part was real and is now closed by `apps/portal/src/lib/sentry/scrub-event.ts`, wired into
all three init sites with 13 unit tests.

But the mechanism the review named was wrong. It quoted the `@default` JSDoc in
`datacollection.d.ts`, which documents the permissive `DEFAULTS` constant rather than the
value that actually applies when `dataCollection` is absent. Reading
`resolveDataCollectionOptions.js` shows the restrictive branch was in force:
**request bodies were never being captured**, and `stackFrameVariables` was inert because
`localVariablesIntegration` no-ops without `includeLocalVariables`. The review's own
suggested fix — a *partial* `dataCollection` object — would have **widened** cookie, header
and query-param collection, because passing the object at all flips every omitted field to
the permissive defaults. See the correction box at the top of P5 CRITICAL-1.

**Lesson worth more than the fix: verify quoted SDK defaults in `node_modules` before acting
on them.** Two of the three headline findings turned on a misread of code the reviewer had
open (see finding 3).

**2. Route access needs THREE gates, not one (P1 C1-C3).**
`canAccessRoute` is only the first. `app/admin/layout.tsx:56` and
`app/welcome/layout.tsx:75` render "Access denied" for the wrong role, and
`api/admin/{programs,offerings,levels}/route.ts` each re-check `isAdmin` in-handler.
The coordinator role as planned would have reached **nothing** - all six API grants
and both page grants were dead on arrival.

**3. A bug in the spec does not exist (P1 C7).**
`welcome/family/[fid]/members/[mid]/page.tsx:73` gates `MemberGradeEditor` on
`admin &&`, so welcome-team never sees it. The "live 403 bug" recorded in
launch-batch spec §2.2 step 6 and built into P1 Task 8 is not real. Remove it from
both.

## How to use these

Work from the report, not from the plan it reviews - several plans cite file paths
that do not exist, and two build on premises that are false. Every finding carries
the plan section, the claim, the verified truth with a citation, and a concrete fix.

Recommended order: implement from the **v2** plans only. P2 v2 Tasks 1-2 are two live
production defects and are the cheapest real wins in the batch. P5 v2 Task 1 (UAT rules)
is independent of the pledge feature and should ship regardless of whether P5 does.

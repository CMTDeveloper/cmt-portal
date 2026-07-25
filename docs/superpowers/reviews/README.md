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

## The three findings that outrank the rest

**1. Sentry would publish the bank details (P5 CRITICAL-1).**
`apps/portal/src/sentry.server.config.ts` has its `dataCollection` block commented
out, no `beforeSend` scrubber exists anywhere in the repo, and `@sentry/nextjs` v10
defaults capture request bodies **and** stack-frame locals. One unhandled error in
`POST /api/pledges` sends plaintext bank/transit/institution/account numbers to a
third-party SaaS, permanently. The monthly-pledge spec listed "never sent to Sentry"
as a control; it was an assertion, never an implementation. `SECURITY_REVIEW_2026-07-22.md:712-735`
had already flagged this file as an open finding.

**Fix this before ANY route that accepts sensitive input ships.** It is independent of
the launch batch and closes an existing audit finding.

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

Recommended order: fix Sentry, correct the specs, then re-plan P1 alone against the
three-gate model and have it reviewed before writing anything else.

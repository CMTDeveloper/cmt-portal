---
name: verifying-setu-changes-in-uat
description: Runs the deployed-UAT verification loop for a Setu (cmt-portal) change — seed a realistic multi-instance fixture, run the Playwright `setu` project against cmt-setu.vercel.app, and clear OTP rate-limits when sign-in repros trip them. Use before declaring ANY Setu feature or fix done; green unit tests are not enough (they mock the cache, router, redirects, and Firestore index enforcement where real bugs live).
---

# Verifying Setu changes in UAT

Green `pnpm test` proves the code is internally consistent — NOT that the feature
works. The integration layer (Next `use cache`, router/redirect gates, Firestore
index enforcement) is invisible to jsdom + fake-firestore. Two prod bugs shipped
green this way (stuck-"Saving…"; seva 500). Always finish a Setu change by walking
it against **deployed UAT** (`https://cmt-setu.vercel.app`, backed by
`chinmaya-setu-uat` Firestore).

## Non-negotiables
- All DB writes/seeds target **`chinmaya-setu-uat` ONLY**. Never prod `715b8`.
- Auth in specs is **password sign-in**, never OTP (one seeded UAT user; password
  from `.env.local`).
- The fixture must be **realistic and multi-instance** — N≥2 of anything plural
  (members, enrollments, opportunities), config switched **on**, data present. The
  single-member / null-config fixture is the trap (see CLAUDE.md "Test the N=2 case").
- A user-facing route with **no E2E is untested** — add one before shipping.

## Workflow
```
- [ ] 1. Seed a realistic UAT fixture (idempotent, _test-tagged, UAT-guarded)
- [ ] 2. Run the spec against deployed UAT
- [ ] 3. If 429: clear the OTP rate-limit, re-run
- [ ] 4. Read failures as PRODUCT vs HARNESS; fix the right one
- [ ] 5. Update the cutover runbook §14 if a UAT DB op happened
```

**1. Seed.** Reuse/extend a `seed:*` script (see `apps/portal/scripts/seed-*.ts`).
Each must hard-refuse unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'`,
tag docs `_test:true`, and be re-runnable (resets state). The spec's `beforeAll`
should re-seed so it's repeatable.
```bash
pnpm --filter @cmt/portal seed:profile-completion-family   # example
```

**2. Run vs deployed UAT.** The `setu` Playwright project (`testMatch e2e/setu/**`)
runs the dependency `auth.setup` first, then your spec.
```bash
PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
  pnpm --filter @cmt/portal exec playwright test e2e/setu/<area>/<spec>.spec.ts --project=setu
```
Just deployed? The Vercel swap busts the `use cache` layer; confirm the new build
is live first (the `/sign-in` `age:` header resets to ~0 on deploy).

**3. Rate-limit (429).** password-sign-in shares the OTP limiter (5 / 15 min per
contact). Repeated repros trip it. Clear it instead of waiting:
```bash
pnpm --filter @cmt/portal clear:otp-rate-limit <email>
```
Specs should detect 429 and fail with an explicit "environmental, not a product
bug" message rather than a confusing assertion failure.

**4. Triage failures.** A Playwright failure is PRODUCT or HARNESS — decide which:
- **Product:** the deployed page genuinely misbehaves. Reproduce with
  `reproducing-setu-bugs-in-uat`, fix the code, redeploy, re-verify.
- **Harness:** flaky filler/locator. Common causes seen here:
  - acting before the client data-fetch resolves (the page shows a loading state
    with zero rows) → `await expect(firstRow).toBeVisible()` before interacting;
  - a live `.first()` locator that **shifts** when a row unmounts mid-fill → pin
    interactions to a stable `data-testid` (`page.locator('[data-testid="..."]')`).

**5. Runbook.** Any UAT DB op (seed of real-shaped data, index, backfill, new
collection/field) gets a dated `docs/runbooks/production-cutover-checklist.md` §14
entry in the same change.

## Soft-nav caveat
Client-navigation bugs (redirect loops, stuck states) only reproduce under a SOFT
nav (a `<Link>`/`router.push`), not `page.goto` (a hard load). To catch them, sign
in via the API, set the `__session` cookie, then click the link and count
`page.on('framenavigated')` main-frame hits.

## Related
- `auditing-firestore-indexes` — run it on any change touching a Firestore query.
- `reproducing-setu-bugs-in-uat` — root-cause a reported failure before fixing.

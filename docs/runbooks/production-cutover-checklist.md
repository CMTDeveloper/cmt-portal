# Production Cutover Checklist — Firebase (UAT → Prod)

> **Audience:** CMT Developer + AI agents. This is the authoritative runbook for moving the Setu portal from UAT Firebase (`chinmaya-setu-uat`) to production, **without breaking the standalone `chinmaya-family-check-in` app that shares the prod project**. Read the Golden Rules before doing anything.
>
> **Last updated:** 2026-06-07. Keep this current as new collections/scripts/flags land.

---

## 0. Golden rules (read every time)

1. **PROD project `chinmaya-setu-715b8` is SHARED** with the still-live standalone `chinmaya-family-check-in` kiosk app. It has its **own Firestore collections AND its own composite indexes** in 715b8. We must be purely additive.
2. **NEVER `firebase deploy --only firestore:indexes ... --force`** against `chinmaya-setu-715b8`. `--force` deletes indexes not present in *our* `firestore.indexes.json` → it would delete the standalone app's indexes and break the prod kiosk. Always deploy **without** `--force`; the CLI will warn "the following indexes are defined in your project but are not present in your firestore.indexes.json" — **leave them; do not delete.**
3. **Never touch the door-app collections** in 715b8: `family-check-ins`, `guest-families`, and the legacy RTDB `/roster`. The portal reads these **read-only** via the MASTER service account. No writes, ever.
4. **Scripts are UAT-guarded.** Every ops script refuses to run unless `PORTAL_FIREBASE_PROJECT_ID === 'chinmaya-setu-uat'`, *unless* you pass `--allow-prod`. Running against prod is a deliberate, explicit act — you must set the prod project AND pass `--allow-prod`.
5. **No `.firebaserc`** in this repo → **always pass `--project <id>` explicitly** to every `firebase` command. Never rely on a default project.
6. **`NEXT_PUBLIC_*` env vars are sensitive-by-default on Vercel Production.** Add them with `--no-sensitive` or `vercel env pull` reads them back blank and the client bundle silently gets `undefined`. (See §9.)
7. **The two apps run in parallel** until the kiosk cutover (`NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true`). Until then, do NOT retire the standalone deployments and do NOT remove their data/indexes.

---

## 1. ⚠️ DECISION TO CONFIRM FIRST — what *is* the prod Setu Firestore?

Everything below depends on this. **Confirm before any prod write.**

- **Documented assumption (per `CLAUDE.md` B2 note):** the production Setu Firestore **is `chinmaya-setu-715b8`** — the same project as MASTER and the standalone app. The portal's Setu collections (families, offerings, levels, enrollments, …) get written **into 715b8 alongside** the door app's collections. They have distinct names, so it's additive — but the index + collection rules in §0 are non-negotiable.
- **Implication if 715b8 (shared):** `PORTAL_FIREBASE_PROJECT_ID` flips from `chinmaya-setu-uat` → `chinmaya-setu-715b8`, becoming the **same** project as `MASTER_FIREBASE_PROJECT_ID`. Index deploys go to 715b8 **without `--force`**.
- **Alternative (dedicated prod project):** if instead a *separate* prod Setu project is created (e.g. `chinmaya-setu-prod`), then `PORTAL_FIREBASE` points there (portal-only, `--force` safe like UAT) while `MASTER_FIREBASE` stays `715b8` (door + roster, read-only). This is cleaner but is **not** what CLAUDE.md currently says.

> **Action:** CMT Developer confirms which target. The rest of this doc is written for the **715b8-shared** path (the documented default); where the dedicated-project path differs, it's noted inline. Until this is confirmed and the "never write 715b8" directive is consciously lifted, **prod writes remain forbidden** (firm directive, 2026-05-31).

---

## 2. The two Firebase projects

| Role | Project ID | Holds | Portal access |
|---|---|---|---|
| **PORTAL_FIREBASE** (current) | `chinmaya-setu-uat` | All portal Setu Firestore collections + Firebase Auth (OTP users). Portal-only. | Read/write. `--force` index deploys safe. |
| **MASTER_FIREBASE** | `chinmaya-setu-715b8` (PROD) | Legacy RTDB `/roster`; door-app Firestore `family-check-ins`, `guest-families`; **its own composite indexes**. Shared with standalone app. | **Read-only** via MASTER service account. |
| **PORTAL_FIREBASE** (after cutover, 715b8-shared path) | `chinmaya-setu-715b8` | Portal Setu collections written **additively** into the shared prod project. | Read/write portal collections only; never `--force` indexes; never touch door collections. |

**Credentials** (service-account, set per environment):
- `PORTAL_FIREBASE_PROJECT_ID` / `PORTAL_FIREBASE_CLIENT_EMAIL` / `PORTAL_FIREBASE_PRIVATE_KEY`
- `MASTER_FIREBASE_PROJECT_ID` / `MASTER_FIREBASE_CLIENT_EMAIL` / `MASTER_FIREBASE_PRIVATE_KEY` / `MASTER_FIREBASE_DATABASE_URL`
- Public client config: `NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID` / `_API_KEY` / `_AUTH_DOMAIN`

> The MASTER service account must have **Firestore read** permission on 715b8 (already confirmed via `pnpm check:door-access`). Re-confirm in prod.

---

## 3. Collection ownership map (in prod 715b8)

**DO NOT TOUCH — owned by the standalone `chinmaya-family-check-in` app:**
- Firestore: `family-check-ins`, `guest-families` (hyphenated names)
- RTDB: `/roster` (the legacy student roster — source of truth for migration, read-only)
- Plus the standalone app's own Firestore composite indexes (invisible to our file; protected by the never-`--force` rule).

**PORTAL-OWNED — safe to create/write (additive; distinct names):**
`families` (+ subcollections `members`, `enrollments`, `invites`), `contactKeys`, `offerings`, `donationPeriods`, `levels`, `programs`, `donations`, `classCalendarEntries`, `attendanceEvents`, `attendance`, `check_in_events`, `checkIns`, `guest_check_ins`, `seva_opportunities`, `seva_signups`, `achievements`, `verification_codes`, `otp_rate_limit`, `weeklySchedules`, `family_notifications`.

> **Pre-cutover audit:** before the first prod write, run a one-off read against 715b8 to confirm **none** of the portal-owned collection names already exist there (they shouldn't — different naming from the door app). If any unexpectedly exists, STOP and investigate a possible collision before writing.

---

## 4. Pre-cutover prerequisites (do these before any data migration)

- [ ] **§1 decision confirmed** (prod target project) and the 2026-05-31 "never write 715b8" directive consciously lifted for the cutover window.
- [ ] **Service accounts** for the chosen prod `PORTAL_FIREBASE` exist with Firestore + Auth admin; `MASTER_FIREBASE` SA has Firestore read on 715b8.
- [ ] **All env vars set on Vercel Production** (see §9 for the full list). Pay attention to the `NEXT_PUBLIC_*` sensitive gotcha.
- [ ] **AWS SES**: prod `AWS_SES_FROM_EMAIL` identity verified in `AWS_SES_REGION`; out of the SES sandbox (or all recipients verified).
- [ ] **AWS SNS**: `AWS_SNS_REGION` has an **Origination Number** for Canadian (+1) SMS; account out of the SNS sandbox; spend limit raised; no stuck opt-outs. Diagnose with `pnpm --filter @cmt/portal exec tsx scripts/debug-sns-config.ts` and set defaults with `scripts/sns-set-defaults.ts`. (Module-cached SNS client needs a **cold redeploy** when region changes.)
- [ ] **Stripe**: live `STRIPE_API_KEY`, prod `STRIPE_CHECKOUT_URL` (Cloud Run proxy), `STRIPE_USE_TEST_CHECKOUT=false`, `WEBHOOK_API_KEY` set.
- [ ] **`CRON_SECRET`** set (Vercel Cron: daily cache-reset, weekly payment reminders).
- [ ] **Session**: `SESSION_COOKIE_EXPIRES_DAYS` ≤ 14 (Firebase hard cap — never exceed).
- [ ] **`NEXT_PUBLIC_PORTAL_BASE_URL`** = the prod domain (`https://cmt-setu.vercel.app` or the custom domain) — used in invite-email links.
- [ ] **Local `.env.local`** for running migration scripts points `PORTAL_FIREBASE_*` at the prod project and `MASTER_FIREBASE_*` at 715b8.

---

## 5. Firestore index deploy (prod) — the careful way

The repo's `firestore.indexes.json` holds the **portal's** indexes only. Deploy them to prod **additively**:

```bash
# From repo root. NEVER --force. Always explicit --project.
firebase deploy --only firestore:indexes --project chinmaya-setu-715b8
```

- Expect a warning listing indexes "defined in your project but not present in your firestore.indexes.json" — those are the **standalone app's** indexes. **Do NOT delete them.** Answer No / leave them.
- Indexes build asynchronously (minutes). A query against a still-building index throws `FAILED_PRECONDITION: index is currently building`. Wait and retry.
- Portal indexes that must exist before the corresponding feature works in prod:
  - `check_in_events (fid ASC, checkedInAt DESC)` — family dashboard (B2).
  - `enrollments (pid ASC, status ASC)` collectionGroup — teacher roster.
  - `enrollments (oid ASC, status ASC)` collectionGroup — **school-year rollover** discovery.
  - `families (searchKeys CONTAINS, location ASC)` — welcome-team search.
  - `offerings`, `donations`, `levels`, `attendanceEvents`, `classCalendarEntries`, `invites`, `seva_opportunities` composite indexes (all in `firestore.indexes.json`).

> UAT (`chinmaya-setu-uat`) is portal-only, so `--force` there is safe. **715b8 is never `--force`.**

---

## 6. Data migration sequence (prod)

> Run from `apps/portal`. Every command needs `.env.local` pointed at prod and the explicit **`--allow-prod`** flag (scripts refuse non-UAT otherwise). **Dry-run first**, inspect, then real run. These are idempotent (deterministic doc IDs, `set(merge)`), so re-runs are safe.

Order matters — later steps depend on earlier ones:

1. **Seed the program scaffolding** (offerings + levels + calendar). These define the school-year structure the migration enrolls into.
   ```bash
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-donation-periods.ts --allow-prod
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-to-programs.ts --allow-prod      # donationPeriods → offerings
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-bala-vihar-levels.ts --allow-prod
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-bala-vihar-calendar.ts --allow-prod
   ```
2. **Migrate legacy families** from the 715b8 RTDB `/roster` into Setu Firestore (families + members + contactKeys). Dry-run first.
   ```bash
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-legacy-families.ts --dry-run --limit 20 --allow-prod
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-legacy-families.ts --allow-prod   # ~864 families, ~15 min
   ```
3. **Backfill legacy student IDs** onto members (links Setu members ↔ roster rows for attendance/door bridging).
   ```bash
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-legacy-sid.ts --allow-prod
   ```
4. **Backfill current Bala Vihar enrollments** (enrolls currently-registered kids into the 2025-26 offering; writes `pid:oid`; deactivates all-graduated families).
   ```bash
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --dry-run --limit 30 --allow-prod
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --allow-prod
   ```
5. **Grant admin / welcome-team** to the right people (so the admin surfaces are reachable).
   ```bash
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/grant-admin.ts <email-or-phone> --allow-prod
   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/grant-welcome-team.ts <email-or-phone> --allow-prod
   ```
6. **(Annual, later) School-year rollover** — only when promoting to 2026-27. See §7.

> After each step, spot-check with `inspect-setu-family.ts` / `inspect-legacy-roster.ts` / `list-uat-families.ts` (rename mentally to "list families") and `check-uat-migrations.ts`.

---

## 7. School-year rollover (2025-26 → 2026-27) — annual

Two ways: the admin UI at `/admin/school-year` (recommended — guided + preview), or the CLI. CLI:

```bash
# 1. Preview what Step 1 would create (no writes)
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/start-new-year.ts --dry-run --allow-prod
# 2. Create next year's levels + offerings (idempotent; empty teacher slots)
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/start-new-year.ts --allow-prod
# 3. Preview the promotion (no writes) — shows advance/graduate/needs-attention + per-level transitions
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/promote-families.ts --dry-run --allow-prod
# 4. Fix any "needs-grade" kids (names/fids printed), then commit the promotion
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/promote-families.ts --allow-prod
# 5. Re-run the preview → should report ~0 to advance (idempotency proof)
```
Requires the `enrollments (oid, status)` collectionGroup index (deploy via §5 first). Promotion is grade-driven, idempotent, history-preserving (`levelSnapshots`); a family with only missing-grade kids keeps its enrollment active (never stranded).

---

## 8. Feature-flag flip sequence (Vercel Production)

Flags live in `apps/portal/src/lib/flags.ts`, read from `NEXT_PUBLIC_FEATURE_*` env vars. **`NEXT_PUBLIC_*` are statically inlined** — a change requires a **rebuild/redeploy** (an env-only update does nothing until a fresh build). Flip on only after the data migration + index deploy + a UAT-equivalent walkthrough:

| Flag env var | Enables | Flip when |
|---|---|---|
| `NEXT_PUBLIC_FEATURE_SETU_AUTH` | OTP sign-in + `/family/*` | After families migrated + SES/SNS prod-verified |
| `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` | Donation/Stripe flow | After Stripe live + offerings seeded |
| `NEXT_PUBLIC_FEATURE_SETU_TEACHER` | Teacher attendance | After BV enrollments backfilled + roster verified |
| `NEXT_PUBLIC_FEATURE_CHECK_IN*` | Legacy check-in surfaces | Per parallel-run plan |
| `NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK` | **Door cutover** — retires the standalone kiosk | **Last**, only after parallel-run proven. After this, the standalone app + its 715b8 indexes can finally be retired. |

> Release timing: Setu routes are not announced to families until donations + teacher are both proven (per the 2026-05-22 decision). Legacy `/login` + `/check-in/*` stays the production entry point until then.

---

## 9. Environment variables (full prod set)

Source of truth: `turbo.json` `tasks.build.env` (must list every var or Vercel builds strip it from the sandbox). Set all on **Vercel Production**.

**Firebase (server SA):** `PORTAL_FIREBASE_PROJECT_ID`, `PORTAL_FIREBASE_CLIENT_EMAIL`, `PORTAL_FIREBASE_PRIVATE_KEY`, `MASTER_FIREBASE_PROJECT_ID`, `MASTER_FIREBASE_CLIENT_EMAIL`, `MASTER_FIREBASE_PRIVATE_KEY`, `MASTER_FIREBASE_DATABASE_URL`
**Firebase (public client):** `NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY`, `NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN`
**Auth/session:** `TEACHER_PASSPHRASE`, `SESSION_COOKIE_EXPIRES_DAYS` (≤14)
**AWS:** `AWS_SES_REGION`, `AWS_SNS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_FROM_EMAIL`
**Stripe:** `STRIPE_API_KEY`, `STRIPE_CHECKOUT_URL`, `STRIPE_CHECKOUT_URL_TEST`, `STRIPE_USE_TEST_CHECKOUT` (=`false` in prod), `WEBHOOK_API_KEY`
**Setu allowlists / misc:** `SETU_EMAIL_ALLOWLIST`, `SETU_PHONE_ALLOWLIST` (split per channel — clear/empty to allow all in prod, or keep gated during soft-launch), `EVENT_REGISTRATION_RATE_LIMIT_PER_MIN`, `CRON_SECRET`, `NEXT_PUBLIC_PORTAL_BASE_URL`
**Feature flags:** the `NEXT_PUBLIC_FEATURE_*` from §8.

**Vercel CLI gotchas:**
```bash
# NEXT_PUBLIC_* are sensitive-by-default on Production → add with --no-sensitive or they read back blank.
vercel env add NEXT_PUBLIC_FEATURE_SETU_TEACHER production --value "true" --force --yes --no-sensitive
vercel env pull .env.vercel.check   # verify values are present (not masked)
```
Prefer `git push` (empty commit) to trigger a rebuild that picks up changed `NEXT_PUBLIC_*`. **Do NOT** run `vercel deploy --prod` from a stale/wrong-cwd link (creates an orphan project). Vercel project is **cmt-setu** (`prj_hU9MepeAVmjdfCcsao3tWduvdrXC`).

---

## 10. CLI command reference (every script + purpose)

> All are `pnpm --filter @cmt/portal <alias>` which expands to `tsx --env-file=.env.local scripts/<file>.ts`. For PROD, append `--allow-prod` and ensure `.env.local` targets the prod project. ⚠️ = writes data.

| Alias | Purpose | Prod note |
|---|---|---|
| `check:door-access` | Verify MASTER SA can read 715b8 door collections (read-only probe). | Run first — confirms read bridge. |
| `check:migrations` | Audit which migrations have run (counts per collection). | Read-only sanity check. |
| `list:uat-families` | List migrated families (id/name/location). | Read-only; works for prod too. |
| `seed:donation-periods` ⚠️ | Seed legacy `donationPeriods` (pricing tiers per location/year). | `--allow-prod`. Idempotent. |
| `migrate:programs` ⚠️ | Copy `donationPeriods` → `offerings` (the model the app reads). | `--allow-prod`. |
| `seed:bala-vihar-levels` ⚠️ | Seed `levels` (grade bands, curriculum, per location/year). | `--allow-prod`. |
| `seed:bala-vihar-calendar` ⚠️ | Seed `classCalendarEntries` (Sunday class days). | `--allow-prod`. |
| `migrate:legacy-families` ⚠️ | RTDB `/roster` (715b8) → Setu families/members/contactKeys. | `--dry-run` first. ~864 families. |
| `migrate:calendar-ids` ⚠️ | One-off: normalize calendar entry doc IDs. | Only if needed. |
| `backfill:legacy-sid` ⚠️ | Add `legacySid` to members (links to roster rows). | After family migration. |
| `backfill:bv-enrollments` ⚠️ | Enroll current BV kids into 2025-26 offering (`pid:oid`). | `--dry-run` first. |
| `school-year:start` ⚠️ | Clone levels+offerings to next year (rollover Step 1). | `--dry-run` first. §7. |
| `school-year:promote` ⚠️ | Advance grades + re-level + close/create enrollments (Step 2). | `--dry-run`, fix needs-grade, then commit. §7. |
| `grant:admin` ⚠️ | Grant admin role (custom claims) to a contact. | Needs re-login to take effect. |
| `grant:welcome-team` ⚠️ | Grant welcome-team role to a contact. | Needs re-login. |
| `seed:admin` ⚠️ | Seed an initial admin. | First admin bootstrap. |
| `seed:e2e-family` ⚠️ | Seed a `_test:true` E2E fixture family. | **UAT/test only — never prod.** |
| `attendance:report` | Print an attendance report. | Read-only. |
| `refresh:check-ins` ⚠️ | Refresh the portal's door check-in cache. | Per cron/runbook. |
| `wipe:uat-leaks` / `wipe:test-leaks` ⚠️ | Delete `_test:true` leaked fixtures. | **UAT/test only — NEVER prod.** |
| `debug-sns-config.ts` | Dump SNS account state (sandbox/origination/spend/opt-out) per region. | Read-only diagnosis. |
| `debug-phone-lookup.ts` / `inspect-setu-family.ts` / `inspect-legacy-roster.ts` | Read-only inspection helpers. | Safe anywhere. |
| `sns-set-defaults.ts` ⚠️ | Set SNS SMS default attributes. | AWS account change. |

**Non-pnpm commands:**
| Command | Purpose |
|---|---|
| `firebase deploy --only firestore:indexes --project chinmaya-setu-715b8` | Deploy portal indexes to PROD — **NEVER `--force`** (§5). |
| `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` | Deploy to UAT (`--force` safe). |
| `firebase firestore:indexes --project <id>` | List current indexes on a project. |
| `git push` | Triggers Vercel build + the pre-push gate (typecheck/lint/test/build). |
| `vercel env add <NAME> production --value "…" --no-sensitive --force --yes` | Set a prod env var (see §9 gotchas). |

---

## 11. Verification (mock-free — do not skip)

After migration + index deploy + flag flip, walk the **actual user paths** in prod (green tests ≠ shipped working):
- [ ] Sign-in: open `/sign-in`, OTP to a real allowlisted contact, land on `/family`.
- [ ] Family dashboard shows the migrated family + BV enrollment + attendance (test the N=2 case: a family with two kids).
- [ ] Teacher: assign a teacher (re-login), open `/teacher`, a level shows the correct roster count (compare to the standalone check-in app's count for that level).
- [ ] Donation: run a real (small) Stripe live checkout end-to-end; confirm the webhook records the donation.
- [ ] Welcome-team search returns a known family.
- [ ] Rollover (when run): preview matches expectations; commit; re-open a promoted child → new grade/level + journey strip; teacher roster for the new year shows promoted kids; re-run preview → ~0.
- [ ] Confirm the **standalone kiosk app still works** in prod (its collections + indexes untouched).

---

## 12. Rollback / safety

- **Feature flags** are the fastest rollback: set `NEXT_PUBLIC_FEATURE_SETU_* = false` and redeploy → the Setu surfaces disappear; legacy `/login` + `/check-in/*` remain. Data stays intact.
- **Data**: migrations are idempotent and additive; they don't delete door-app data. There is no destructive migration. If a portal collection is wrong, fix-forward with a corrected re-run (deterministic IDs overwrite).
- **Indexes**: if a wrong index was added, remove it from `firestore.indexes.json` and redeploy **without `--force`** (this won't touch the standalone's indexes). Never `--force`.
- **Auth**: bad role grants are reversible (`grant:*` writes custom claims; revoke by re-running with the inverse, or via the admin welcome-team UI).

---

## 13. Quick "first prod cutover" sequence (copy/paste skeleton)

```bash
# 0. Confirm §1; set .env.local to prod (PORTAL=715b8 or dedicated; MASTER=715b8).
pnpm --filter @cmt/portal check:door-access                      # read bridge OK?
firebase deploy --only firestore:indexes --project chinmaya-setu-715b8   # NO --force
# 1. scaffolding
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-donation-periods.ts --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-to-programs.ts --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-bala-vihar-levels.ts --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/seed-bala-vihar-calendar.ts --allow-prod
# 2. families
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-legacy-families.ts --dry-run --limit 20 --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/migrate-legacy-families.ts --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-legacy-sid.ts --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --dry-run --limit 30 --allow-prod
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/backfill-bv-enrollments.ts --allow-prod
# 3. admins
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/grant-admin.ts <you> --allow-prod
# 4. set Vercel prod env vars (§9), flip flags (§8), redeploy, verify (§11).
```

---

*Maintenance: when you add a new ops script, collection, index, env var, or feature flag, update §3, §5, §9, and §10 here in the same PR.*

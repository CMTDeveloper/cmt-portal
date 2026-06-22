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

## 1. Prod target — CONFIRMED: `chinmaya-setu-715b8` (shared)

**Decided 2026-06-07 (CMT Developer):** the production Setu Firestore **is `chinmaya-setu-715b8`** — the same project as MASTER and the standalone door app. The portal's Setu collections (families, offerings, levels, enrollments, …) are written **into 715b8 alongside** the door app's collections. They use distinct names (§3), so writes are **additive** — but the index + collection rules in §0 are non-negotiable.

- `PORTAL_FIREBASE_PROJECT_ID` flips from `chinmaya-setu-uat` → `chinmaya-setu-715b8`, becoming the **same** project as `MASTER_FIREBASE_PROJECT_ID`. (Both credential sets target 715b8 — Firestore for PORTAL, Firestore+RTDB for MASTER.)
- Index deploys go to 715b8 **without `--force`** (§5).
- A dedicated separate prod project was considered and **rejected** in favour of the shared model.

> ⚠️ **Safety gate:** the standing "never write `715b8`" directive (2026-05-31) is **consciously lifted only for the deliberate cutover window** described in this runbook. Outside a planned cutover/migration, day-to-day dev + all automated ops still target `chinmaya-setu-uat`. Treat every `--allow-prod` run as a reviewed, intentional act.

---

## 2. The two Firebase projects

| Role | Project ID | Holds | Portal access |
|---|---|---|---|
| **PORTAL_FIREBASE** (current) | `chinmaya-setu-uat` | All portal Setu Firestore collections + Firebase Auth (OTP users). Portal-only. | Read/write. `--force` index deploys safe. |
| **MASTER_FIREBASE** | `chinmaya-setu-715b8` (PROD) | Legacy RTDB `/roster`; door-app Firestore `family-check-ins`, `guest-families`; **its own composite indexes**. Shared with standalone app. | **Read-only** via MASTER service account. |
| **PORTAL_FIREBASE** (after cutover) | `chinmaya-setu-715b8` | Portal Setu collections written **additively** into the shared prod project. | Read/write portal collections only; never `--force` indexes; never touch door collections. |

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
| `backfill:portal-access` ⚠️ | Gate roster-migrated non-manager adults: set `members.portalAccess:'pending'` on non-primary **adults** of **migrated** (`legacyFid`) families. Registration-added members, personas, managers, children skipped. Idempotent. | `--dry-run` first. UAT-default (hard-refuses non-UAT without `--allow-prod`); for 715b8 run after family migration — behavior change, locks those members out until manager approval. |
| `school-year:start` ⚠️ | Clone levels+offerings to next year (rollover Step 1). | `--dry-run` first. §7. |
| `school-year:promote` ⚠️ | Advance grades + re-level + close/create enrollments (Step 2). | `--dry-run`, fix needs-grade, then commit. §7. |
| `grant:admin` ⚠️ | Grant admin role (custom claims) to a contact. | Needs re-login to take effect. |
| `grant:welcome-team` ⚠️ | Grant welcome-team role to a contact. | Needs re-login. |
| `seed:admin` ⚠️ | Seed an initial admin. | First admin bootstrap. |
| `seed:e2e-family` ⚠️ | Seed a `_test:true` E2E fixture family. | **UAT/test only — never prod.** |
| `seed:test-accounts` ⚠️ | Seed the 8 role-persona test accounts (parents both locations, family-member, 2 location teachers, universal teacher, sevak, admin) for manual testing + role E2E. See `docs/runbooks/test-accounts.md`. | **UAT only — hard-refuses prod (no `--allow-prod`).** Needs `TEST_ACCOUNTS_PASSWORD`. |
| `attendance:report` | Print an attendance report. | Read-only. |
| `refresh:check-ins` ⚠️ | Refresh the portal's door check-in cache. | Per cron/runbook. |
| `wipe:uat-leaks` / `wipe:test-leaks` ⚠️ | Delete `_test:true` leaked fixtures. | **UAT/test only — NEVER prod.** |
| `debug-sns-config.ts` | Dump SNS account state (sandbox/origination/spend/opt-out) per region. | Read-only diagnosis. |
| `debug-phone-lookup.ts` / `inspect-setu-family.ts` / `inspect-legacy-roster.ts` | Read-only inspection helpers. | Safe anywhere. |
| `inspect:brampton-level` | Read-only: reproduce `deriveRoster` for Brampton BV 2025-26 — per-level projected roster sizes + enrolled-grade histogram. Use to validate the teacher view after a backfill/rollover. | UAT-only (refuses other projects). |
| `snapshot:rtdb` | Capture legacy 715b8 RTDB `/roster` + `/families` into gitignored `apps/portal/.rtdb-snapshot/` (one deliberate full download), then set `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` in `.env.local` so ALL local reads resolve from the snapshot — zero RTDB download cost. | Read-only. Re-run to refresh; PII — never commit. |
| `backfill:birth-months` ⚠️ | Populate `members.birthMonth` (1–12) from legacy roster `dob_m` via `legacySid` (snapshot-fed, idempotent). Feeds the prasad assigner. | `--dry-run` first; `--allow-prod` at cutover, after family migration. |
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

## 14. Change log (UAT) — keep this current

> **Rule:** any important UAT DB change (new collection/field, new index + deploy, new ops/migration/seed/backfill script or run, schema change, new env var/flag, corrective write) gets a dated entry here **and** an update to the relevant section above, in the same change. Prod replays this log additively (never `--force`, never touch the door-app collections).

- **2026-06-22** — **Offering date-overlap guard + `teacher-managed` payment source + donation-period donate flow** (merge `096463e`, from `codex/separate-worktree-394a`). **Schema:** `@cmt/shared-domain` `PAYMENT_SOURCES` gains **`teacher-managed`** (offerings whose donation the teacher collects off-portal) — additive, no migration. **Behavior change (admins):** creating/editing an ENABLED offering whose (programKey, location) date window overlaps an existing enabled one is now **rejected `409 offering-date-overlap`** on `POST/PATCH /api/admin/offerings` (was a soft `overlapWarning`); open-ended (null endDate) and location-less offerings are now included in the check. **No new Firestore index** — the existing `offerings:[enabled,location,programKey,startDate]` composite already covers the equality query. **`POST /api/setu/donations/checkout`** returns `422 payment-source-teacher-managed` for teacher-managed enrollments (before any Stripe call); dashboard/donate/enroll hide the in-portal Give button for them. The Bala Vihar donation **acknowledgements** gate shipped but is **DORMANT** (wired off at `app/family/donate/page.tsx` with placeholder copy) — provide final disclaimer text + flip the one-line flag to enable. Mobile contract entry: `MOBILE_API_CHANGELOG.md` `096463e`. **Prod TODO:** none — code-only (no DB op/index/migration); when setting up prod offerings, note overlapping enabled offerings are now hard-rejected.
- **2026-06-22** — **Profile-completion gate + required member-field matrix** (spec `docs/superpowers/specs/2026-06-22-profile-completion-gate-and-registration-fields-design.md`; commit `120c885`). A post-sign-in gate (`app/family/layout.tsx`) now **hard-redirects any family with incomplete required member info to `/family/complete-profile`** before the dashboard (a manager completes the whole family; a plain member only their own record). Enforced everywhere via the single shared matrix `@cmt/shared-domain/setu/member-required-fields`: ALL members need gender (**`Male|Female`** on write — `PreferNotToSay` stays ONLY on the read enum + the 3 internal sentinel-minting paths) + foodAllergies (a "No known allergies" choice writes the `'None'` sentinel); adults need email+phone+≥1 volunteeringSkill; children need schoolGrade+birthMonthYear (`birthMonth` 1-12 derived server-side). Required-ness is enforced at the WRITE routes (`POST/PATCH /api/setu/members`, `POST /api/setu/register`) + the forms — **never** by tightening the read-validated `MemberDocSchema`. New 400 codes `foodAllergies-/contact-/grade-/birthmonth-required` (+ existing `skills-required`). Same-**family** contact reuse now **shares** the contactKey instead of overwriting it (fixed a mis-seating bug: completing a migrated spouse with the manager's own email had re-pointed the manager's sign-in to the spouse). **No schema/index/collection change, no new env var/flag, no migration** — pure read-validation + UI + one new middleware request header (`x-portal-pathname`, so the gate's server component can read the path). Seeds/fixtures (`seed-test-accounts`, `seed-e2e-family`, `seed-join-request-family`, e2e fixtures) updated to write gate-complete members so existing E2E specs aren't redirected; new `seed:profile-completion-family` (UAT-only; `pnpm --filter @cmt/portal seed:profile-completion-family`) provisions a deliberately-incomplete manager for the gate E2E. Mobile contract entry: `MOBILE_API_CHANGELOG.md` `120c885`. **Prod TODO:** none beyond deploying the code — BUT note the visible cutover behavior change: on first sign-in **every already-migrated family (~800) with missing required fields** (most migrated adults lack foodAllergies/skills; some children lack birthMonthYear) is **hard-gated to `/family/complete-profile`** until a manager completes the family. This is intended (owner decision: applies to everyone, no flag), but communicate it before go-live, or pre-seed `foodAllergies:'None'` + derive birthMonth via a backfill to soften the first-sign-in friction.
- **2026-06-22** — **Family-lookup manager/member classification + gated co-manager join-request** (spec `docs/superpowers/specs/2026-06-22-family-lookup-manager-member-join-request-design.md`). **New member field `members.portalAccess`** (`'active'|'pending'`, optional; absent ⇒ active). A non-manager **roster-migrated** adult is `'pending'` = **gated**: blocked from family access on *every* sign-in path (`verify-code`, `password-sign-in`, `magic/[token]` each return a `pendingApproval` signal and mint **no** session) until a manager approves. `lazy-migrate` now writes `'pending'` on non-primary adults; ran new **`backfill:portal-access`** (§10) on UAT → **711 migrated non-manager adults gated** (878 managers / 1063 children / 13 registered-family members skipped; idempotent re-run = 0). **Scoped to migrated families only** (`families.legacyFid` present) **+ adults only** — registration-added members and the test personas keep access. **New collection `families/{fid}/joinRequests/{token}`** + **one collectionGroup index `joinRequests` (`token` ASC)** added to `firestore.indexes.json` and **deployed to UAT** (no `--force`). API: `POST /api/setu/family-lookup` gains **`matchAction: 'sign-in'|'request-to-join'`**; new `POST /api/setu/join-request/send` (open, IP-rate-limited, anti-enum `{ok:true}`, notifies all managers email+SMS), `GET /api/setu/join-request[/[token]]` + `POST .../approve` + `POST .../decline` (manager-only). `approve` promotes the matched member to **co-manager** (atomic txn, `manager:true` + `family.managers` arrayUnion + `portalAccess:'active'`, invite/accept contactKey theft-check). UI: register 3rd branch, `/family` approve panel, `/join-request/[token]` page, sign-in pending state. Mobile contract entry: `MOBILE_API_CHANGELOG.md` `0225cca`. **Prod TODO (cutover order):** deploy the `joinRequests(token)` index to 715b8 (no `--force`) → after family migration, run **`backfill:portal-access --allow-prod`** against 715b8 to gate roster-migrated non-manager adults — **dry-run first** and confirm the scope, this is a behavior change that locks those members out of portal access until their manager approves them. Register-new **step 2** redesign still pending owner spec.
- **2026-06-15** — **Security review fixes (5 findings).** (1) **Registration is now OTP-gated** — `POST /api/setu/register` requires a one-time `registrationGrant` proving the manager's email was just OTP-verified (it previously minted a `family-manager` session for any unverified email = account squatting). **New collection `registrationGrants/{token}`** (`{contactHash, createdAt, expiresAt}`; 20-min TTL; single-use, deleted on consume) — created lazily at runtime, **no index, no seed**. `verify-code` issues the grant on the email-no-family path; the `/register/family` wizard gained an email-code step; the mobile spec was updated (the RN app must thread the grant). (2) Magic-link sign-in URLs build from a trusted canonical base (`NEXT_PUBLIC_PORTAL_BASE_URL` / host allowlist) instead of `x-forwarded-host` (host-header poisoning). (3) Public `family-lookup` returns only `{found, matchedType, matchedValue}` — no family PII. (4) CSV exports neutralize spreadsheet formula injection. (5) `/docs` markdown output is sanitized (new dep `sanitize-html`). Items 2–5 are **code-only** (no DB change). **Prod TODO:** none beyond deploying the code — `registrationGrants` self-creates and needs no index/`--force`; expired grants are deleted on the next consume (optionally add a Firestore TTL policy on `expiresAt` later to sweep abandoned ones).
- **2026-06-10** — **Role-persona test accounts seeded (UAT) + Staff→Sevak rename.** New `seed:test-accounts` (§10) created 8 password sign-in personas (`setu-test-*@chinmayatoronto.org`, shared `TEST_ACCOUNTS_PASSWORD` env — gitignored): Brampton parent family (manager + second-adult family-member + 2 children, active `bv-brampton-2025-26` enrollment **with `pid`**), Scarborough parent family (2 children, `bv-scarborough-2025-26`), 3 parent-teacher families with the **first `teacherAssignments` docs in UAT** (Brampton Level 1; Scarborough Level A; "universal" = all enabled levels), plus standalone auth-claim **welcome-team** and **admin** users. All family docs `_test:true` (the integration suite's cleanup sweep deletes them — re-run the seed after `test:integration`). Docs: `docs/runbooks/test-accounts.md`. New E2E `e2e/setu/test-accounts.spec.ts` (8 persona tests). Also renamed the user-facing word **Staff → Sevak** portal-wide: UI strings, `listStaff()`→`listSevaks()`, `StaffRow`→`SevakRow`, `StaffManager`→`SevakManager`, and the `GET /api/admin/users` response key **`{ staff }`→`{ sevaks }`** (safe now — no mobile/external API consumers yet; the `SevakRow.source` enum value `'staff'` is unchanged, it means "auth-claim grant path"). **Prod TODO:** none — test accounts are UAT-only by design; the rename is code-only.
- **2026-06-11** — **Prasad propose→confirm revision** (spec `docs/superpowers/specs/2026-06-10-prasad-propose-confirm-design.md`; admin-team feedback). Publish now writes `status:'proposed'`; families confirm in place or pick any open Sunday (`POST /api/setu/prasad/confirm`, manager-only via the existing prefix rule); admin assigns stragglers per-row (`assign:true` on the PATCH, transactional) or in bulk (`POST /api/admin/prasad/assign-remaining`, per-doc `lastUpdateTime`-preconditioned — conflicts are skipped and reported). New doc fields `confirmedAt`/`confirmedBy('family'|'admin')`/`proposalNotifiedAt`; statuses now `proposed|assigned|cancelled` ('assigned' still = committed, so pre-revision docs need **no migration**). Publish fires a one-time confirm-request email+SMS per family (chunked ×10; publish route pins `maxDuration=300`) and the daily cron nudges unconfirmed proposals at 7d/2d — both gated by `PRASAD_REMINDER_CRON_ENABLED` + allowlists; the admin screen surfaces disabled/failed sends after publish. **No new indexes** (cron reuses `(status,date)`; bulk assign is equality-only). Seed: proposed fixture on the Scarborough test family (`seed:test-accounts`, plain-set so re-seed resets a confirmed doc back to proposed). New E2E `e2e/setu/prasad-propose.spec.ts` (5 tests). **Operational ritual change:** publish proposals → families confirm over ~2 weeks → admin clicks "Assign all unconfirmed (N)" per location before the season starts. **Prod TODO:** unchanged from the prasad-module entry below.
- **2026-06-10** — **Prasad module shipped** (spec `docs/superpowers/specs/2026-06-10-prasad-module-design.md`). One prasad Sunday per family per school year — auto-assigned by the youngest child's birthday month (engine in `@cmt/shared-domain/setu/prasad-engine`), self-serve family moves (7-day lock, cap-checked transaction), 7d/2d email+SMS reminders, `/admin/prasad` preview→publish, `/family/prasad` + dashboard card, `/welcome/prasad` day-of list. **New collections:** `prasadAssignments` (doc id `{pid}-{fid}`), `prasadConfig/{pid}`. **Two new composite indexes** added to `firestore.indexes.json` and **deployed to UAT**: `prasadAssignments(pid,date)` + `prasadAssignments(status,date)`. **New member field** `members.birthMonth` (1–12); ran `backfill:birth-months` on UAT — **906 children updated** from legacy `dob_m` (snapshot-fed, idempotent re-run = 0). (906 > the spec's "728 current students with `dob_m`" because the backfill matches EVERY migrated child with a `legacySid` — including no-longer-registered kids — not just currently-registered ones; 1,039 were eligible.) **Calendar field** `classCalendarEntries.prasadNeeded` (default true; admin toggle on `/admin/calendar`). **New cron** `/api/cron/send-prasad-reminders` (daily 14:00 UTC, in `vercel.ts`) gated by new env `PRASAD_REMINDER_CRON_ENABLED` (unset = disabled; set "true" in Vercel to go live) + existing `CRON_SECRET`. E2E `e2e/setu/admin/prasad.spec.ts` (10 tests) green vs deployed UAT; seed fixture extended (prasadConfig + one assignment for `CMT-FSWEDU2X`). **Prod TODO (cutover order):** deploy both indexes to 715b8 (no `--force`) → run `backfill:birth-months --allow-prod` after family migration → enter the Scarborough class calendar via `/admin/calendar` → admin publishes **proposals** per location from `/admin/prasad`, then (after the confirm window) bulk-assigns unconfirmed families before the first prasad Sunday → set `PRASAD_REMINDER_CRON_ENABLED=true`. NOTE: `CURRENT_PRASAD_PIDS` (features/setu/prasad/constants.ts) pins the 2025-26 pids — bump to the active year's pids at rollover.
- **2026-06-10** — **RTDB download-cost optimization** (code-only; no DB schema/index/write change). Prod billing showed ~$14.84 of RTDB **download** charges (the legacy layout has no `.indexOn`, so kiosk lookups, the roster migration strip, crons, and migration scripts each downloaded the full `/roster`; the per-family legacy parser re-downloaded it per family — ~867× per script run). Three fixes: (1) `readRtdb()` (`@cmt/firebase-shared/admin/rtdb`) now has a **15-min in-process TTL cache** (live mode) — per-family re-reads and warm-lambda page loads download once; (2) **snapshot mode** — `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` serves every `readRtdb()` from a local JSON snapshot captured once via new `snapshot:rtdb` (§10) and **never falls back to network** (missing file throws); snapshot dir is **gitignored (real family PII — never commit)**; (3) `/welcome/roster` migration strip is now **on-demand** (button) instead of fetch-on-mount. Local dev/scripts/tests now read RTDB **zero times**; Vercel runtime (no snapshot) uses the TTL cache. **Prod TODO:** none — at cutover the portal stops depending on RTDB entirely (kiosk cutover retires it; this optimization is interim cost control).
- **2026-06-09** — Re-ran **`backfill:bv-enrollments`** (full, UAT) to restore a representative teacher roster (UAT had drifted down to 6 active Brampton 2025-26 enrollments). Read prod 715b8 RTDB `/roster` **read-only** (`listAllFamilies()`), lazy-migrated each legacy family, and wrote **active** `bv-brampton-2025-26` / `bv-scarborough-2025-26` enrollments carrying `pid` (the field `deriveRoster` queries on). Result: **512 families enrolled** (357 Brampton / 155 Scarborough), 127 stale enrollments cancelled, 767 `schoolGrade` re-asserts, **0 errors**. Brampton **Level 1** now lists **53** students (was 1); other Brampton levels 39–99 each. Idempotent (deterministic `eid=${fid}-${oid}`, `merge:true`); enrolls only current school-age children (not adults; shishu needs `birthMonthYear` the grade-rows lack → Parents/Shishu stay 0). Verified end-to-end against deployed UAT (`cmt-setu.vercel.app`): password sign-in → `/teacher/levels/brampton-level-1-bv-brampton-2025-26/attendance` renders 53 `att-row`s, no access-denied. Added read-only diagnostic `scripts/inspect-brampton-level.ts` (`pnpm --filter @cmt/portal inspect:brampton-level`, §10). **No schema/index change** — this is a data backfill, not a migration. **Prod TODO:** during cutover, after family migration + level/offering seed, run `backfill:bv-enrollments --allow-prod` against 715b8 (no index needed) to populate teacher rosters; `--dry-run` is NOT a pure preview (it still lazy-migrates families), so dry-run only on a target you intend to migrate.
- **2026-06-09** — Rollover **admin "Set grade"**. New admin-only endpoint `POST /api/admin/school-year/set-grade {fid,mid,schoolGrade}` (covered by the `/api/admin/*` catch-all) that sets one Bala Vihar child's `schoolGrade` (grade restricted to the canonical `GRADE_LADDER`). Surfaced two ways: an inline "Set grade" control on each *need-attention* row of the rollover preview (refreshes the dry-run after save), and an admin-only grade editor on the welcome member detail page (`/welcome/family/[fid]/members/[mid]` — read-only for non-admin welcome-team). Resolves the "no grade set" rollover blocker without a CLI. **No schema change** (`schoolGrade` already exists), **no new index**. UAT writes are normal feature writes (not a migration) — prod replay is code-only.
- **2026-06-09** — Admin-revamp **Phase 4 (Reports hub)**. New `/welcome/reports` hub (welcome-team + admin) with four cards: enrollment headcounts, attendance summary, donations summary (**admin-only**), legacy check-in CSV. New read-only API `GET /api/welcome/reports/{enrollment,attendance,donations}` (`?format=json|csv`); `donations` gated to `isAdmin` at BOTH `canAccessRoute` and the handler. **No new Firestore indexes** — aggregations use bulk reads (unfiltered `collectionGroup('enrollments')`, top-level `attendanceEvents` single-field `date` range, top-level `donations`). The legacy `check-ins`/`guests` CSVs reuse the existing `POST /api/check-in/admin/reports/[kind]` (admin-only); the legacy `/check-in/admin/reports` page now `redirect('/welcome/reports')`. **No DB writes** → prod replay is code-only (no migration/index/seed step for this phase). **Prod TODO:** none beyond deploying the code.
- **2026-06-09** — Admin-revamp **Phase 3 (Roster)**. Added two composite indexes to `firestore.indexes.json` and **deployed to UAT** (`firebase deploy --only firestore:indexes --project chinmaya-setu-uat`, no `--force`): (1) collectionGroup `enrollments(programKey ASC, status ASC)` — backs the Roster **program filter** (`collectionGroup('enrollments').where('programKey').where('status','active')` in `features/setu/roster/list-families.ts`); (2) collection `families(location ASC, name ASC)` — backs the **location-filtered** ordered browse (`where('location').orderBy('name')`). Without these, the filtered roster paths throw `FAILED_PRECONDITION` in UAT/prod (unit tests use a fake that ignores indexes, so they stay green — caught only at runtime). New read-only APIs `GET /api/welcome/families` (browse/filter/CSV) + `GET /api/welcome/families/migration-status` (welcome-team + admin). The migration-status endpoint reads the legacy 715b8 RTDB `/roster` **read-only** (via `listAllFamilies()`; `masterRtdb()` exposes no write helpers) and diffs against Setu `families.legacyFid` — never writes 715b8. **Prod TODO:** deploy both indexes to 715b8 (no `--force`) during cutover, before first use of `/welcome/roster` filters.
- **2026-06-08** — Added collectionGroup **field-override** index `members.mid` (COLLECTION_GROUP ASC) to `firestore.indexes.json`; **deployed to UAT** (`firebase deploy --only firestore:indexes --project chinmaya-setu-uat`, no `--force`). Required by the new admin **Users & Roles** screen's `listSevaks()` (named `listStaff()` until the 2026-06-10 Staff→Sevak rename) (`collectionGroup('members').where('mid','==',ref)`) — without it the screen + `GET /api/admin/users` return 500 (`FAILED_PRECONDITION`). The existing teacher reads (`teacher/student-detail.ts`, `teacher/guests.ts`) use the same query and also depend on it. Caught by the new Playwright admin E2E (`e2e/setu/admin/*`). Also extended `scripts/seed-e2e-family.ts` to grant the single E2E test user (`E2E_FAMILY_EMAIL`) **admin** via `roleAssignments/{mid}`, so one UAT user drives family + admin browser tests. **Prod TODO:** deploy the `members.mid` index to 715b8 (no `--force`) during cutover, before first use of `/admin/users`.
- **2026-06-07** — Added collectionGroup index `enrollments(oid ASC, status ASC)` to `firestore.indexes.json`; **deployed to UAT** (`firebase deploy --only firestore:indexes --project chinmaya-setu-uat`, no `--force`). New scripts `school-year:start` / `school-year:promote` (§7, §10). Ran `school-year:start` (created 18 BV 2026-27 levels, idempotent) then `school-year:promote` **committed** the 2025-26→2026-27 rollover in UAT: 512 families, 769 promoted, 23 graduated; 24 Shishu (Pre-K) intentionally left out (handled at registration). Idempotent re-run verified (0 to promote). Enrollment schema gained `levelSnapshots` + `pid` + `'promotion'` enrolledVia; `enrollFamily` now writes `pid:oid`. **Prod TODO:** deploy the new index to 715b8 (no `--force`), then run the same Step 1 + promote sequence during cutover.

---

*Maintenance: when you add a new ops script, collection, index, env var, or feature flag, update §3, §5, §9, §10, and add a §14 Change-log entry in the same PR.*

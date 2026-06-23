# UAT test accounts (role personas)

**What this is:** eight ready-made sign-in accounts on the test site, one for
each kind of portal user. Use them to try things out by hand without touching
any real family's data. (They also power our automated role-based tests.)

These accounts exist **only on the test site (UAT), never on the live site**.
The setup tool refuses to create them anywhere else, and re-creating them is
safe to run again — ask the tech team if they ever need refreshing.

All eight accounts share **one password**. The tech team shares it out-of-band
(e.g. the sevak WhatsApp group) — it is never written down in the repo. When a
testing round ends, the tech team changes it.

## The accounts

| Persona | Email | Role(s) | What you see after signing in |
|---|---|---|---|
| Parent, Brampton | `setu-test-parent-brampton@chinmayatoronto.org` | family-manager | "Test Family Brampton" — 2 children (Grade 1, Grade 4), enrolled in Bala Vihar Brampton 2025–26. Full family dashboard: edit members, enroll, donate, prasad. |
| Family member | `setu-test-member-brampton@chinmayatoronto.org` | family-member | The same Brampton family, but as the second adult who is NOT the manager — you can view things, but manager-only actions (adding/editing members, sending invites) are off-limits. |
| Parent, Scarborough | `setu-test-parent-scarborough@chinmayatoronto.org` | family-manager | "Test Family Scarborough" — 2 children (Grade 1, Grade 3), enrolled in Bala Vihar Scarborough 2025–26. |
| Teacher, Brampton | `setu-test-teacher-brampton@chinmayatoronto.org` | family-manager + teacher | The Teacher page (/teacher) shows **Brampton Level 1** (the real 53-student roster). |
| Teacher, Scarborough | `setu-test-teacher-scarborough@chinmayatoronto.org` | family-manager + teacher | The Teacher page (/teacher) shows **Scarborough Level A**. |
| Universal teacher | `setu-test-teacher-universal@chinmayatoronto.org` | family-manager + teacher | The Teacher page (/teacher) shows **every enabled level** — both locations, both school years. There's nothing special about this account; it has simply been assigned as a teacher of every level. |
| Sevak (welcome team) | `setu-test-sevak@chinmayatoronto.org` | welcome-team (standalone, no family) | Lands on the Welcome area (/welcome) — roster, family search, reports, prasad day-of list. No admin access. |
| Admin | `setu-test-admin@chinmayatoronto.org` | admin (standalone, no family) | Lands on the Admin area (/admin) — every admin screen (admin also gets everything welcome-team and teachers get). |

The two teacher families have no children and no enrollments on purpose —
their family dashboard looks empty. These accounts exist for the Teacher page.

## How to sign in

1. Go straight to **https://cmt-setu.vercel.app/sign-in**. Type the address
   directly — don't start from a /welcome or /admin link. (Those links show a
   sevak/admin version of the sign-in page that hides the password option.
   Don't worry about landing in the wrong place: after sign-in you're taken to
   the right dashboard automatically.)
2. Click **"Have a password? Sign in faster →"**.
3. Type the persona's email and the shared password.
4. You land on that persona's home: the family dashboard (/family), the
   Welcome area (/welcome), or the Admin area (/admin).

**Teachers:** after landing on the family dashboard (/family), click the
**Sevak → Teacher** link in the sidebar (or go to /teacher).

**Use the password only.** Signing in with an emailed/texted code does NOT
work for these accounts — the mailboxes don't exist, so the code never
arrives.

## Things to watch out for

- ⚠️ **The shared password is effectively an ADMIN credential.** The
  `setu-test-admin` account can reach every admin screen — including granting
  and removing roles — on the test site, which holds real migrated family
  personal information. Share the password only with people who should have
  that level of access, and ask the tech team to change it when a testing
  round ends.
- **These test families get wiped from time to time.** A periodic automated
  test sweep deletes the seeded test families. If your test family has
  vanished, ask the tech team to re-create the accounts (safe to run again).
  Your sign-in itself survives the wipe — but the re-created family is a
  brand-new family behind the scenes.
- After a wipe and re-create, leftover "ghost" teacher entries can linger in
  **Level management** (/admin/levels). They match no real person, so they're
  harmless — but they do pile up each time. If the clutter bothers anyone:
  open **Level management** (/admin/levels), find the leftover teacher entry,
  and untick every level for it.
- **Sign-in attempts are limited: 5 tries per email every 15 minutes.** A few
  wrong-password attempts plus a couple of automated test runs in the same
  window can lock that persona out (you'll see an error). Just wait out the
  15 minutes and try again.
- **School-year rollover:** these accounts are built around the 2025–26 school
  year (the Bala Vihar programs and level names above). After each yearly
  rollover the tech team has to update them. ⚠️ Until that update happens,
  re-creating the accounts will cancel any other active Bala Vihar enrollment
  on these test families — including one the rollover itself just created.
- These accounts live ONLY on the test site. Nothing here is part of the
  go-live plan for the real site; if the real site ever needs demo accounts,
  that's a separate decision (the setup tool flat-out refuses to create them
  there).
- The Brampton/Scarborough families use fake `+1519555-02xx` phone numbers —
  text messages to them are blocked and never actually send.

## Notes for developers

- **Seeding:** the accounts are seeded (idempotently) by
  `pnpm --filter @cmt/portal seed:test-accounts`. UAT (`chinmaya-setu-uat`)
  only — the script refuses any other project and has **no** `--allow-prod`
  escape hatch.
- **Password:** all eight accounts share `TEST_ACCOUNTS_PASSWORD` in
  `apps/portal/.env.local` (gitignored). Rotate by changing the value and
  re-running the seed.
- **OTP:** OTP sign-in fails because the mailboxes don't exist, and UAT's
  `SETU_EMAIL_ALLOWLIST` routes unknown recipients to the mock sender.
- **Universal teacher:** there is no universal-teacher concept in code — that
  account is simply assigned to all levels via `teacherAssignments`.
- **E2E usage:** `apps/portal/e2e/setu/test-accounts.spec.ts` exercises every
  persona via `POST /api/setu/auth/password-sign-in` with fresh request
  contexts. It self-skips unless `TEST_ACCOUNTS_PASSWORD` is set in
  `apps/portal/.env.local`. The fixed emails live in
  `apps/portal/e2e/_helpers.ts` (`TEST_ACCOUNT_EMAILS`) for future role-based
  specs.
- **The integration suite wipes these families.**
  `pnpm --filter @cmt/portal test:integration` runs `cleanupTestData()`, a
  global `_test:true` sweep that deletes the seeded families (same caveat as
  the `seed:e2e-family` fixture). Re-run `seed:test-accounts` afterwards. Auth
  users, `teacherAssignments`, and auth-claim grants survive the sweep; the
  re-seed re-points them at the recreated member ids (a wiped family gets a
  NEW fid on re-seed).
- **Orphan teacher refs:** after a wipe + re-seed, the OLD mids linger in
  `levels.teacherRefs` and as orphan `teacherAssignments/{oldMid}` docs — they
  match no member, so they're functionally harmless, but they accumulate per
  wipe+reseed cycle. Prune an orphan with `assignTeacher(oldMid, [])` via the
  `/admin/levels` UI (untick everything for that ref).
- **Rate limiter:** password sign-in shares the OTP limiter — 5 attempts per
  email per 15 minutes; exceeding it returns a 429 for that persona.
- **Rollover pins:** the seed pins the `bv-*-2025-26` offerings and level
  names, and `e2e/setu/test-accounts.spec.ts` pins the matching levelId
  constants. Bump those test pins at rollover; prasad itself now follows the
  app-managed current school year.
  Note the seed's single-BV invariant cancels any OTHER active BV enrollment —
  including one a rollover created for the new year — until the pins are
  bumped.
- **SMS:** the fake `+1519555-02xx` numbers are blocked by
  `SETU_PHONE_ALLOWLIST` (mock sender).

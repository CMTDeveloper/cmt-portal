# UAT test accounts (role personas)

Eight password sign-in accounts covering every portal role, for manual testing
by the team and for role-based Playwright E2E. Seeded (idempotently) by:

```bash
pnpm --filter @cmt/portal seed:test-accounts
```

UAT (`chinmaya-setu-uat`) only — the script refuses any other project and has
**no** `--allow-prod` escape hatch. All eight accounts share one password:
`TEST_ACCOUNTS_PASSWORD` in `apps/portal/.env.local` (gitignored — share with
the team out-of-band, e.g. the sevak WhatsApp group; rotate by changing the
value and re-running the seed).

## The accounts

| Persona | Email | Role(s) | What they see |
|---|---|---|---|
| Parent, Brampton | `setu-test-parent-brampton@chinmayatoronto.org` | family-manager | "Test Family Brampton" — 2 children (Grade 1, Grade 4) with an active `bv-brampton-2025-26` enrollment. Full family dashboard, member edit, enroll, donate, prasad. |
| Family member | `setu-test-member-brampton@chinmayatoronto.org` | family-member | Same family as above, but as the non-manager second adult — read access, no manager-only actions (member CRUD, invites). |
| Parent, Scarborough | `setu-test-parent-scarborough@chinmayatoronto.org` | family-manager | "Test Family Scarborough" — 2 children (Grade 1, Grade 3), active `bv-scarborough-2025-26` enrollment. |
| Teacher, Brampton | `setu-test-teacher-brampton@chinmayatoronto.org` | family-manager + teacher | `/teacher` shows **Brampton Level 1** (the 53-student backfilled roster). |
| Teacher, Scarborough | `setu-test-teacher-scarborough@chinmayatoronto.org` | family-manager + teacher | `/teacher` shows **Scarborough Level A**. |
| Universal teacher | `setu-test-teacher-universal@chinmayatoronto.org` | family-manager + teacher | `/teacher` shows **every enabled level** (both locations, both school years). There is no universal-teacher concept in code — this account is simply assigned to all levels via `teacherAssignments`. |
| Sevak (welcome team) | `setu-test-sevak@chinmayatoronto.org` | welcome-team (standalone, no family) | Lands on `/welcome` — roster, family search, reports, prasad day-of list. No admin access. |
| Admin | `setu-test-admin@chinmayatoronto.org` | admin (standalone, no family) | Lands on `/admin` — all admin surfaces (admin inherits welcome-team + teacher). |

The two teacher families have no children/enrollments — their family dashboard
is intentionally sparse; the persona exists for the `/teacher` view.

## How testers sign in

1. Go to **https://cmt-setu.vercel.app/sign-in** directly (not via a
   `/welcome` or `/admin` deep link — the sevak/admin sign-in variant of the
   page hides the password toggle; the role-based redirect after sign-in takes
   you to the right dashboard anyway).
2. Click **"Have a password? Sign in faster →"**.
3. Enter the persona email + the shared password.
4. You land on the persona's dashboard (`/family`, `/welcome`, or `/admin`).

Teachers: after landing on `/family`, use the **Sevak → Teacher** sidebar link
(or go to `/teacher`).

OTP sign-in does NOT work for these accounts — the mailboxes don't exist (and
UAT's `SETU_EMAIL_ALLOWLIST` routes unknown recipients to the mock sender).
Password only.

## E2E usage

`apps/portal/e2e/setu/test-accounts.spec.ts` exercises every persona via
`POST /api/setu/auth/password-sign-in` with fresh request contexts. It
self-skips unless `TEST_ACCOUNTS_PASSWORD` is set in `apps/portal/.env.local`.
The fixed emails live in `apps/portal/e2e/_helpers.ts` (`TEST_ACCOUNT_EMAILS`)
for future role-based specs.

## Caveats

- **The shared password is effectively an ADMIN credential.** The
  `setu-test-admin` account reaches every `/admin/*` surface (including role
  grant/revoke) on deployed UAT, which holds real migrated family PII. Share
  the password only with people who should have that access, and rotate it
  (edit `.env.local`, re-run the seed) when testing rounds end.
- **The integration suite wipes these families.** `pnpm --filter @cmt/portal
  test:integration` runs `cleanupTestData()`, a global `_test:true` sweep that
  deletes the seeded families (same caveat as the `seed:e2e-family` fixture).
  Re-run `seed:test-accounts` afterwards. Auth users, `teacherAssignments`,
  and auth-claim grants survive the sweep; the re-seed re-points them at the
  recreated member ids (a wiped family gets a NEW fid on re-seed).
- After a wipe + re-seed, the OLD mids linger in `levels.teacherRefs` and as
  orphan `teacherAssignments/{oldMid}` docs — they match no member, so they're
  functionally harmless, but they accumulate per wipe+reseed cycle. Prune an
  orphan with `assignTeacher(oldMid, [])` via the `/admin/levels` UI (untick
  everything for that ref) if the clutter bothers anyone.
- **Rate limiter:** password sign-in shares the OTP limiter — **5 attempts per
  email per 15 minutes**. A tester fumbling the password plus a couple of
  local E2E re-runs in the same window can trip a 429 for that persona; wait
  out the window.
- **School-year rollover:** the seed pins the `bv-*-2025-26` offerings and
  level names, and `e2e/setu/test-accounts.spec.ts` pins the matching levelId
  constants. Bump both at rollover (same ritual as `CURRENT_PRASAD_PIDS`).
  Note the seed's single-BV invariant cancels any OTHER active BV enrollment —
  including one a rollover created for the new year — until the pins are
  bumped.
- These accounts live ONLY in UAT. Nothing here is part of the prod cutover;
  if prod ever needs demo accounts, decide that separately (the seed script
  hard-refuses prod).
- The Brampton/Scarborough fixtures use fake `+1519555-02xx` phone numbers —
  SMS to them is blocked by `SETU_PHONE_ALLOWLIST` (mock sender).

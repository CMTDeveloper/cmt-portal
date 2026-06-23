---
name: reproducing-setu-bugs-in-uat
description: Read-only diagnostic loop for root-causing a reported cmt-portal/Setu bug against real UAT data BEFORE changing code. Use when a Setu page errors, a value looks wrong, or a tester reports a failure — reproduce the actual server query/error or inspect the real family/claims/config, cite the evidence, and never guess the cause.
---

# Reproducing Setu bugs in UAT

Standing rule for this project: answers must be accurate and code-backed, never
assumptions. Before proposing a fix, reproduce the failure against real
`chinmaya-setu-uat` data and read the ACTUAL error — don't pattern-match a cause.
This is read-only; it doesn't mutate anything.

## Workflow
```
- [ ] 1. Read the failing route/page + the helper it calls
- [ ] 2. Reproduce the exact server call against UAT (capture the real error)
- [ ] 3. Inspect the real data behind it (family / member / claims / config)
- [ ] 4. State the root cause with file:line + the captured error
```

**1. Read the path.** Open the page/route and the server helper it awaits. Note
every external call (Firestore query, cache read, auth helper) — the throw is
almost always one of those, not the React render.

**2. Reproduce the server call.** Run the real helper against UAT with a throwaway
tsx script and `--env-file=.env.local` (which points at `chinmaya-setu-uat`):
```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local /tmp/repro.ts <args>
```
In the script, import and call the actual server helper (e.g.
`getFamilySevaView(fid)`), wrap it in try/catch, and print `err.message` + any
`err.code`. This surfaces the real cause verbatim — e.g.
`9 FAILED_PRECONDITION: The query requires an index …` (→ `auditing-firestore-indexes`).

**3. Inspect the data.** Read the docs behind the failure (never live RTDB — use
the snapshot):
```bash
pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/inspect-setu-family.ts --fid <FID>
```
For auth issues, print a user's custom claims (`role`, `extraRoles`, `fid`, `mid`)
with `portalAuth().getUserByEmail(email)` — claim shape drives most gate bugs. For
config-gated features, read the config doc (e.g. `app_config/seva_requirement`) —
the bug may only exist once a value is set.

**4. Conclude.** State the root cause with the file:line and the captured error
string. Distinguish a PRODUCT bug from a HARNESS/data artifact. If it's a
client-navigation bug (loop, stuck state), reproduce a SOFT nav (sign in via the
API, set `__session`, click the `<Link>`, count `framenavigated` hits) — a
`page.goto` hard load won't reproduce it.

## Guardrails
- Read-only. Don't write to UAT while diagnosing (seeds/backfills are a separate,
  deliberate step). Never touch prod `715b8`.
- Never read the legacy RTDB live — `RTDB_SNAPSHOT_DIR=.rtdb-snapshot` serves
  reads from the local snapshot ($1/GB download otherwise).
- Be sparing with `password-sign-in` repros — they share the 5-per-15-min OTP
  limiter; clear it with `pnpm --filter @cmt/portal clear:otp-rate-limit <email>`
  if it trips.
- Delete throwaway `/tmp` repro scripts when done.

## Then fix
Once the cause is proven, fix the code, and verify end-to-end with
`verifying-setu-changes-in-uat` before declaring done.

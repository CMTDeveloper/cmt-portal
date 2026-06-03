# Setu Playwright E2E

Browser-level regression net for the Setu family/admin flows. On-demand only
(NOT in the pre-push gate). Auth bypasses OTP via the password-sign-in route.

## One-time setup
1. `.env.local` must have UAT creds (`PORTAL_FIREBASE_*`, `NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY`),
   the Setu feature flags (`NEXT_PUBLIC_FEATURE_SETU_AUTH=true`, `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=true`),
   plus `E2E_FAMILY_EMAIL` and `E2E_FAMILY_PASSWORD`.
2. Seed the test family (UAT, idempotent): `pnpm --filter @cmt/portal seed:e2e-family`

## Run
- All: `pnpm test:e2e` (root) — auto-starts `next dev` on :3001 via the `dev:e2e` script.
- **Against the deployed UAT app (recommended — proven green):**
  `PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app pnpm test:e2e`
  (the deployed portal is backed by the same UAT Firestore the seed writes to;
  setting `PLAYWRIGHT_BASE_URL` skips the local dev server entirely.)
- One project: `pnpm --filter @cmt/portal exec playwright test --project=setu dashboard`
- Report on failure: `pnpm --filter @cmt/portal exec playwright show-report`

All 7 specs (setup + dashboard×2 + enroll-wording×2 + programs + unauth) are
verified green against `https://cmt-setu.vercel.app`.

## Known local-dev caveat (`/family` hang under `next dev`)
At the time of writing, the **`/family` dashboard hangs (~120s, `RangeError:
Maximum call stack size exceeded` in framework frames) under local `next dev`**,
so the two `dashboard.spec.ts` tests fail locally but PASS against the deployed
app. This is an environment artifact, not a product bug — the dashboard's data
and view-model are clean (verified) and `/family/programs` + `/family/enroll/*`
render fine locally. Likely causes: a local Next version-skew (dev logs warn that
`unstable_cacheTag`/`cacheLife` are now stable) and a workspace-root misdetection
(a stray `pnpm-lock.yaml` above the repo). Until the local env is fixed, run the
suite against the deployed URL above. `/family` renders correctly in production.

## Layout
- `auth.setup.ts` — logs in once via password-sign-in, saves `e2e/.auth/family.json` (gitignored).
- `setu/*.spec.ts` — authenticated read/render specs (dashboard, enroll wording, programs).
- `unauth.spec.ts` — redirect spec (no storageState).
- `legacy/*.spec.ts` — stale Slice-B check-in specs (kept, skip-guarded).

v1 is read/render-only — no DB mutations, no payment completion. The seeded family
is tagged `_test:true`; the vitest server-integration suite's cleanup sweep can remove
it, so re-run the seed before a Playwright run if the integration suite ran against UAT.
The vitest server-integration suite is the separate `pnpm --filter @cmt/portal test:integration`.

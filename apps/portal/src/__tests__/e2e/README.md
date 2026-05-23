# E2E Integration Suite

This suite hits **real UAT Firestore** (`chinmaya-setu-uat`). It is not the unit test suite — do not run it in CI via the pre-push hook.

## What this suite does

Five flagship tests exercise the full server-side path through route handlers → Firestore admin SDK:

| File | Routes covered |
|---|---|
| `register.e2e.test.ts` | `POST /api/setu/register` |
| `members-crud.e2e.test.ts` | `POST /api/setu/members`, `PATCH /api/setu/members/[mid]`, `DELETE /api/setu/members/[mid]` |
| `invite-flow.e2e.test.ts` | `POST /api/setu/invite/send`, `POST /api/setu/invite/accept` |
| `lazy-migrate.e2e.test.ts` | `lazyMigrateLegacyFamily()` server function (Firestore write path; RTDB is mocked) |
| `welcome-search.e2e.test.ts` | `GET /api/setu/family/search` |

After each test file runs, `cleanupTestData()` removes all Firestore documents tagged `_test: true` and all contactKey docs tagged `_test: true`. Cleanup is idempotent — running it twice does not error.

## How to run

```bash
pnpm --filter @cmt/portal test:e2e
```

## Required environment

`.env.local` must contain the UAT Firebase service account credentials:

```
PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat
PORTAL_FIREBASE_CLIENT_EMAIL=...
PORTAL_FIREBASE_PRIVATE_KEY=...
NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY=...
NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat
```

If any of these are missing, every test file will `describe.skip(...)` with a clear message rather than fail.

## Cleanup tags

- Every test family doc: `_test: true` on the Firestore document
- Every test contactKey doc: `_test: true` on the Firestore document
- Cleanup queries `families where _test == true` and `contactKeys where _test == true`

## AWS SES

`resolveSender` is mocked in every e2e test file. No real emails are sent during test runs.

## RTDB

`lazy-migrate.e2e.test.ts` mocks `findFamilyById` so no RTDB reads occur. This is intentional — `MASTER_FIREBASE_*` points at the production RTDB and we cannot safely write test rows there.

## When to run

- On-demand before releases
- NOT in the pre-push hook (unit + integration tests only run there)
- NOT in CI by default (add `pnpm test:e2e` to a separate workflow if needed)

# Cache Components Upgrade Verification
**Date:** 2026-05-23  
**Verifier:** cache-verifier agent  
**Verdict: FAIL** — 3 blocking issues must be patched before this can ship.

---

## Check Results

### Check 1 — Pre-push suite (typecheck / lint / test / build)

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | **FAIL** | 5 TS errors (see below) |
| `pnpm lint` | PASS | 7 warnings (pre-existing, not introduced here) |
| `pnpm test` | PASS | 742 tests, all passing (same count as baseline) |
| `pnpm --filter @cmt/portal build` | **FAIL** | 91 build errors (see below) |

**Typecheck errors — all 5 are the same root cause:**

In Next.js 16 the `revalidateTag` signature changed to require a second argument:
```ts
revalidateTag(tag: string, profile: string | CacheLifeConfig): undefined
```
All 5 call sites pass only the tag. Affected files:
- `src/app/api/setu/invite/accept/route.ts:181`
- `src/app/api/setu/invite/send/route.ts:103`
- `src/app/api/setu/members/[mid]/route.ts:206`
- `src/app/api/setu/members/[mid]/route.ts:286`
- `src/app/api/setu/members/route.ts:169`

**Fix required:** Add a `profile` second argument to every `revalidateTag` call. Based on the `cacheLife` profiles defined in `next.config.ts`, the correct value is `'family'`:
```ts
revalidateTag(`family-${fid}`, 'family');
```

**Build errors — 91 errors, all the same root cause:**

Next.js 16 with `cacheComponents: true` forbids `export const dynamic = 'force-dynamic'` in route handlers. The build fails with:
> Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.

This affects **every** API route that uses `force-dynamic` — approximately 91 routes across the entire app (check-in, auth, setu, cron, etc.). These `force-dynamic` declarations were pre-existing from Slice B and were not touched by tasks #1/#2. Enabling `cacheComponents: true` globally breaks them all.

The `cacheComponents` flag should either:
1. Stay in `next.config.ts` but all `force-dynamic` exports must be removed (safe because `'use cache'` functions are already opt-in), OR
2. Be scoped differently — but Next.js 16 does not support per-route opt-in for `cacheComponents`

**Additionally noted in the build output:**
- `experimental.cacheComponents`, `experimental.cacheLife`, `experimental.typedRoutes` should be moved to **top-level** config keys — Next.js 16 emits warnings that they have moved out of `experimental`. The current `next.config.ts` has them under `experimental: { ... }` which is wrong for Next.js 16.
- Correct structure:
  ```ts
  const config: NextConfig = {
    reactStrictMode: true,
    typedRoutes: true,
    cacheComponents: true,
    cacheLife: { family: {...}, welcomeSearch: {...} },
    transpilePackages: [...],
  };
  ```

---

### Check 2 — `next.config.ts` structure

| Item | Result | Notes |
|---|---|---|
| `cacheComponents: true` present | PASS (partial) | Present but under `experimental` — Next.js 16 warns it should be top-level |
| `cacheLife` includes `family` profile | PASS | `stale:60, revalidate:60, expire:3600` |
| `cacheLife` includes `welcomeSearch` profile | PASS | `stale:30, revalidate:30, expire:600` |

**Issue:** All three keys (`cacheComponents`, `cacheLife`, `typedRoutes`) are nested under `experimental` but Next.js 16 has promoted them to top-level. This generates warnings in both build and dev output.

---

### Check 3 — `get-current-family.ts`

**PASS.** File at `src/features/setu/members/get-current-family.ts`:
- Wrapped in `cache(...)` from React for request-scoped deduplication of the session/cookie read
- Calls `getFamilyByFid(fid)` as a separate function for the cached Firestore read
- `cookies()` is called inside `getCurrentFamily` (not inside the `'use cache'` function) — correct boundary

---

### Check 4 — `get-family-by-fid.ts`

**PASS.** File at `src/features/setu/members/get-family-by-fid.ts`:
- First line of function body is `'use cache'`
- `cacheLife('family')` called immediately after
- `cacheTag(\`family-${fid}\`)` called immediately after
- Function does NOT read `cookies()`, `headers()`, or `searchParams()` — reads only Firestore

---

### Check 5 — `updateTag` / `revalidateTag` on all 4 mutation routes

| Route | Has `revalidateTag(\`family-\${fid}\`)` | Result |
|---|---|---|
| `POST /api/setu/members` | Yes — line 169 | PASS |
| `PATCH /api/setu/members/[mid]` | Yes — line 206 | PASS |
| `DELETE /api/setu/members/[mid]` | Yes — line 286 | PASS |
| `POST /api/setu/invite/accept` | Yes — line 181 | PASS |

Note: `POST /api/setu/invite/send` also calls `revalidateTag` (line 103) — this is bonus coverage, not required by spec.

All 4 required routes call `revalidateTag` after successful write. The tag format `family-${fid}` matches `cacheTag(\`family-${fid}\`)` in `get-family-by-fid.ts`.

The issue is only the missing second argument (see Check 1 typecheck failures).

---

### Check 6 — Build output

**FAIL** — Build failed with 91 errors before producing route output. Therefore:
- Cannot confirm `/family/*` routes appear as dynamic (`ƒ`) in build output
- Cannot confirm absence of `'use cache'` misuse warnings (none observed before the build error, but build did not complete)

**Positive signals observed before build abort:**
- `▲ Next.js 16.2.3 (Turbopack)`
- `Cache Components enabled` — printed in build header
- `✓ cacheComponents` — listed under active experiments

---

### Check 7 — Dev server smoke test

Not attempted — build is broken. A dev server run would be unreliable while 91 build errors exist.

---

## Test Count

| | Count |
|---|---|
| Baseline (per task spec) | 742 |
| Current | 742 |
| Delta | 0 (no regression, no new tests for cache layer) |

---

## Summary of Blocking Issues

### Issue 1 — BLOCKER: `revalidateTag` missing second argument (5 errors)
**Severity:** Blocks typecheck (pre-push hook will abort push)  
**Fix:** Add `'family'` as second argument to all 5 `revalidateTag` calls  
**Files:** `members/route.ts`, `members/[mid]/route.ts`, `invite/accept/route.ts`, `invite/send/route.ts`

### Issue 2 — BLOCKER: `cacheComponents: true` incompatible with `force-dynamic` (91 build errors)
**Severity:** Blocks build entirely  
**Fix:** Remove `export const dynamic = 'force-dynamic'` from all ~91 API route handlers, OR reconsider whether `cacheComponents: true` should be enabled globally at this stage. The `force-dynamic` declarations were intentional in Slice B to ensure mutation routes always re-execute. With `cacheComponents`, the `'use cache'` directive in `get-family-by-fid.ts` already handles caching explicitly — the `force-dynamic` guards on mutation routes are now in conflict with the global flag.  
**Recommended approach:** Remove `force-dynamic` from all routes — they are redundant now that caching is opt-in via `'use cache'`.

### Issue 3 — WARNING: `experimental.*` keys should be top-level in Next.js 16
**Severity:** Warning only (does not block build/push), but should be fixed alongside Issue 2  
**Fix:** Move `cacheComponents`, `cacheLife`, `typedRoutes` out of `experimental: {}` to top-level in `next.config.ts`

---

## Recommendations

1. Team-lead should assign a patch task to fix Issues 1 and 2 together (they are in the same files).
2. Issue 3 (`next.config.ts` structure) should be fixed in the same patch as Issue 2 since both touch `next.config.ts`.
3. After patch: re-run full pre-push suite + spot-check build output for `/family/*` route symbols.
4. No new tests are needed for the cache layer itself — the 742 existing tests cover the mutation routes and their responses. A future task could add a test that asserts `revalidateTag` is called with correct arguments on successful mutation.

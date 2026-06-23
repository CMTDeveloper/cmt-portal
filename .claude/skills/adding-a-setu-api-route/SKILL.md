---
name: adding-a-setu-api-route
description: Checklist for adding or changing a `/api/setu/*` (or `/api/admin/*`, `/api/welcome/*`) route in cmt-portal. Use when creating a new Setu API endpoint or changing an existing one's request/response shape, auth, or error codes — covers the middleware auth gates, role checks, Zod validation, mobile contract changelog, and the test/verify gates that are easy to miss.
---

# Adding a Setu API route

The `/api/setu/*` surface is consumed by the web app AND hand-mirrored by the React
Native app (`chinmaya-setu-mobile`), and it sits behind a two-layer middleware
gate. Several disciplines here are not enforced by the type system, so missing one
ships a 401/500 that unit tests don't catch.

## Checklist
```
- [ ] 1. canAccessRoute rule (every /api/setu path needs one)
- [ ] 2. PUBLIC_ROUTES entry IF the endpoint is reachable unauthenticated
- [ ] 3. Header-based auth (cookie AND Bearer) via readSessionFromHeaders
- [ ] 4. Role checks via helpers (isAdmin/isWelcomeTeam/isSetuManager/…), never ===
- [ ] 5. Zod validate the BODY at the write route; do NOT tighten read doc schemas
- [ ] 6. ISO-string JSON + shared @cmt/shared-domain schemas (mobile-consumable)
- [ ] 7. MOBILE_API_CHANGELOG entry on ANY shape/error-code change
- [ ] 8. Tests in the SAME commit; run the FULL vitest suite before pushing
```

**1. canAccessRoute.** The middleware blocks before the handler runs. The
`/api/setu/` catch-all is **manager-only** — a new path that other roles must reach
needs an explicit rule in `packages/shared-domain/src/auth/can-access-route.ts`,
or family-member / fresh-OTP callers get denied. (Method-aware: `GET` vs
`POST/PATCH/DELETE` can differ.)

**2. Public routes.** The `isPublicRoute` gate runs **first** and 401s an
unauthenticated caller before `canAccessRoute` is even consulted. A truly public
endpoint (token links, lookups) needs BOTH a `canAccessRoute` rule AND a
`PUBLIC_ROUTES` entry in `packages/shared-domain/src/auth/public-routes.ts`. A
`canAccessRoute` rule alone is not enough — this is only caught by a live
walkthrough, not unit tests.

**3. Auth from headers.** Use `readSessionFromHeaders(req)` (works for cookie AND
Bearer/mobile callers — middleware forwards verified claims as `x-portal-*`
headers). The cookie-only `getCurrentFamily()` silently 401s valid Bearer
requests; use `getSessionFamily(req)` in route handlers instead.

**4. Roles via helpers.** Multi-role claims (primary `role` + `extraRoles`) +
admin→welcome-team inheritance mean `claims.role === 'admin'` silently misses
cases. Always use `isAdmin` / `isWelcomeTeam` / `isSetuManager` / `isSetuFamily`
/ `isTeacher` from `@cmt/shared-domain`.

**5. Zod.** Validate the request body with `.strict()` at write routes. NEVER add
`.min(1)` / tighten a doc schema that validates on READ — it breaks every existing
doc. Enforce required-ness at the write route + the form, via the shared matrix
helpers (e.g. `member-required-fields`), not the read schema.

**6. Shape.** Return ISO strings (never raw Timestamps/Dates); reuse
`@cmt/shared-domain` schemas so web + mobile agree.

**7. Mobile changelog.** Any change to a `/api/setu/**` request/response shape,
error code, or required field — or a shared-domain schema those routes use —
appends a dated, SHA-keyed entry to `apps/portal/docs/MOBILE_API_CHANGELOG.md`
(state what changed + what the mobile must do). UI/copy-only changes don't need one.

**8. Tests.** Branching logic (role gates, multiple paths) ships with its
assertions in the same commit. Integration tests live in
`src/app/api/setu/__tests__` + `src/features/**/__tests__`, separate from per-route
tests — run the **full** `pnpm test` before pushing (targeted globs miss them and
the pre-push hook fails late). Then verify with `verifying-setu-changes-in-uat`.

## Common Firestore caveat
If the route adds a compound query, run `auditing-firestore-indexes` — fake-firestore
won't catch a missing composite index.

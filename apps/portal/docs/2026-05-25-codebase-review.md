# Codebase review — 2026-05-25

**Reviewer:** Cursor agent (read-only audit)  
**Scope:** Full monorepo — Slice 2 Setu auth/family API, legacy check-in, shared packages, middleware, tests, Firestore indexes  
**Baseline (initial audit):** `pnpm typecheck` PASS · `pnpm lint` PASS · `pnpm test` PASS (789 tests, 111 suites)  
**Baseline (re-verification 2026-05-25):** `pnpm test` PASS (755 tests, 109 suites)  
**Fix commits:** `98a360d` (B1/B2/H1) · `b2b29dd` (H2/H3/L2) · `267839b` (M4/M5/L1/L3)  
**Prior audits:** `2026-05-23-portal-flow-audit.md`, slice-2a through slice-2e reviews, `2026-05-23-fix-batch-verification.md`

Severity: **B** = Blocker · **H** = High · **M** = Medium · **L** = Low · **Praise** = Good pattern

---

## Re-verification summary (2026-05-25)

**Verdict: All blockers and high-severity items from this review are closed.** Claude Code landed three commits addressing every item in the recommended fix order except doc-only follow-ups.

| ID | Issue | Status | Evidence |
|---|---|---|---|
| B1 | Register join GET → 405 | ✅ Fixed | `register/page.tsx` → `/sign-in?email=…` |
| B2 | `family/join` not public | ✅ N/A | Route deleted (`98a360d`) |
| H1 | `family/join` takeover vector | ✅ Fixed | Route + `family-join.ts` deleted |
| H2 | New user stuck on OTP screen | ✅ Fixed | Bordered “Didn’t get a code?” card + register CTA (`b2b29dd`) |
| H3 | `secure: true` breaks localhost | ✅ Fixed | `NODE_ENV === 'production'` on all session cookies |
| M2 | E2E dedupe gap | ✅ Fixed | `registration-dedupe.e2e.test.ts` added |
| M4 | Stale `AGENTS.md` | ✅ Fixed | Pointer to `CLAUDE.md` |
| M5 | Orphan Slice C index | ✅ Fixed | Removed from `firestore.indexes.json` |
| L1 | Double semicolon | ✅ Fixed | `invite/accept/route.ts` |
| L2 | Welcome search stale flash | ✅ Fixed | `seqRef` guard in `welcome-search.tsx` |
| L3 | `Aarti Patel` fallback | ✅ Fixed | `'Family member'` in `family/page.tsx` |
| M1 | PII in `/register/family` URL | ⚠️ Open | Still passes email+phone as query params |
| M3 | Sample dashboard metrics | ⚠️ Open | Labeled “Sample data”; expected until Slices 3–4 |
| — | Stale `mobile-api-integration.md` | ⚠️ Open | Still documents deleted `/api/setu/family/join` |
| — | Stale `CLAUDE.md` Slice 2b bullet | ⚠️ Open | Still lists `POST /api/setu/family/join` |

**New dedupe flow (verified in code + tests):**

```
/register → family-lookup match → /sign-in?email=… → send-code → verify-code
  → findSetuFamilyByContact → session → /family
```

---

## Executive summary (initial audit — historical)

Slice 2 (Setu auth + family CRUD + invite + welcome search) is **architecturally sound and well-tested**. Auth middleware, method-aware `canAccessRoute`, Firestore transactions, and session cookie patterns are consistently applied. Most blockers from the 2026-05-23 flow audit have been fixed (public registration APIs, invite accept session refresh, sign-out, dynamic sidebar identity, `ContactVerifiedBanner`).

~~**Two registration-dedupe issues remain open…**~~ **Closed in `98a360d`.** The register match panel now redirects to OTP sign-in; `/api/setu/family/join` was deleted entirely rather than hardened.

---

## Health dashboard

| Check | Status | Notes |
|---|---|---|
| Typecheck | ✅ Pass | All 7 workspace packages |
| Lint | ✅ Pass | Feature boundaries enforced |
| Unit tests | ✅ 789 pass | 111 files |
| E2E suite | ⚠️ On-demand | 5 files; no coverage for register dedupe / family-lookup |
| Firestore indexes declared | ✅ | `searchKeys`, `invites` token + email/acceptedAt |
| Index deploy to prod | ⚠️ Manual | Must run without `--force` on `chinmaya-setu-715b8` |
| AGENTS.md accuracy | ❌ Stale | Still says Slice B in progress, references removed Slice C |

---

## Blocker issues

### B1 — Register “Join family” button navigates with GET to POST-only API

**Files:** `apps/portal/src/app/register/page.tsx:311-317`, `apps/portal/src/app/api/setu/family/join/route.ts`

```tsx
<Link
  href={`/api/setu/family/join?fid=...&email=...&phone=...`}
  className="btn btn--p btn--block"
>
  Join the {match.name} family →
</Link>
```

The join route exports **POST only**. Browser navigation issues GET → **405 Method Not Allowed**. Email and phone leak into URL, history, logs, and Referer headers.

**User symptom:** After dedupe lookup finds a match, clicking “Join” lands on an error page.

**Fix (minimal):** Replace the link with navigation to sign-in, pre-filling contact:

```tsx
<Link href={`/sign-in?email=${encodeURIComponent(email)}`} ...>
  Sign in to join the {match.name} family →
</Link>
```

(`verify-code` already resolves existing Setu families and sets correct claims.)

**Fix (spec-aligned alternative):** Wire a button that `fetch` POSTs to `/api/setu/family/join` — but only after addressing B2 and H1 below.

---

### B2 — `/api/setu/family/join` is not a public route

**Files:** `packages/shared-domain/src/auth/public-routes.ts`, `packages/shared-domain/src/auth/can-access-route.ts:85-87`

`/api/setu/family-lookup` and `/api/setu/register` were correctly added to `PUBLIC_ROUTES` (fixing the May 23 B1/B2 blockers). **`/api/setu/family/join` was not.**

Unauthenticated users on `/register` hit middleware → `canAccessRoute` catch-all requires `isSetuManager || isWelcomeTeam || isAdmin` → **401 JSON** before the handler.

**Fix options (pick one):**

| Option | Action | Trade-off |
|---|---|---|
| A (preferred) | Remove join from register UX; send users to `/sign-in` | No new public endpoint; OTP proves ownership |
| B | Add `/api/setu/family/join` to `PUBLIC_ROUTES` + rate-limit by IP | Must also fix H1 or accept takeover risk |
| C | Require prior OTP session (`role: 'family'`) before join | Middle ground; join becomes session-upgrade not cold-start |

Integration tests call the handler directly (`testApiHandler`) and **bypass middleware**, so this gap is not caught by CI.

---

## High-severity issues

### H1 — `family/join` grants sessions without proving contact ownership

**Files:** `apps/portal/src/app/api/setu/family/join/route.ts`, `apps/portal/src/features/setu/registration/family-join.ts`

The join endpoint accepts `{ fid, contactProof: { type, value } }` and, if the hash exists in `contactKeys` for that `fid`, creates a Firebase user + session cookie. **No OTP or prior verified session is required.**

An attacker who knows (or guesses) a registered email can:

1. `POST /api/setu/family-lookup` (public, IP rate-limited) to discover `fid`
2. `POST /api/setu/family/join` with that email → session as the victim

If B2 is “fixed” by making join public without addressing this, **account takeover becomes trivial**.

**Fix:** Do not expose join as a cold-start public endpoint. For register dedupe, redirect to OTP sign-in. If join must remain, require either:

- A short-lived server-side proof token issued only after successful `verify-code`, or
- An authenticated session whose embedded contact matches `contactProof`

---

### H2 — Sign-in anti-enumeration leaves brand-new users on OTP screen with no code

**Files:** `apps/portal/src/app/api/setu/auth/send-code/route.ts:99-101`, `apps/portal/src/app/sign-in/page.tsx:216`

When `findSetuFamilyByContact` returns null and there is no pending invite / admin grant, send-code returns `{ success: true }` **without sending a code** (correct anti-enumeration). The UI still transitions to the OTP entry screen. The user never receives a code and has no in-flow path to registration.

**Mitigations already shipped:** Pending invite lookup (email) and admin/welcome-team role lookup send codes for those paths.

**Still broken:** Truly new users who start at `/sign-in` instead of `/register`.

**Fix options:**

- After send-code, return an opaque `{ sent: boolean }` flag the UI can use to branch (weak — enables enumeration unless always `true`)
- Better UX: detect “no code will arrive” client-side is impossible without enumeration; instead add copy + CTA on the code screen: “Didn’t get a code? **Register your family** →” linking to `/register`
- Or route new users to `/register` from marketing (`/` already says “Sign in or register”)

---

### H3 — Session cookies always use `secure: true` — breaks local HTTP dev

**Files:** All session-setting routes (`verify-code`, `register`, `join`, `invite/accept`, legacy auth)

```ts
res.cookies.set('__session', session, { httpOnly: true, secure: true, sameSite: 'lax', ... });
```

On `http://localhost` during `next dev`, browsers **do not persist** `Secure` cookies. Local Setu flow testing requires HTTPS proxy or toggling `secure: process.env.NODE_ENV === 'production'`.

**Impact:** Developer friction; not a production bug.

---

## Medium-severity issues

### M1 — PII in URL query params on registration path

**File:** `apps/portal/src/app/register/page.tsx:345`

`/register/family?email=...&phone=...` exposes contact info in the address bar and server access logs. Same class of issue as the join GET link (B1).

**Fix:** Pass contact via `sessionStorage` keyed by a nonce, or require OTP verification before step 2 (spec’s intended long-term shape).

---

### M2 — E2E suite gap: registration dedupe path untested end-to-end

**File:** `apps/portal/src/__tests__/e2e/README.md`

E2E covers register, members CRUD, invite, lazy migrate, welcome search. **No e2e for `family-lookup` → join/sign-in dedupe**, which is exactly where B1/B2/H1 live.

**Fix:** Add `registration-dedupe.e2e.test.ts` exercising lookup match → sign-in (or join once fixed) through middleware-aware requests.

---

### M3 — Dashboard mixes real family data with labeled sample metrics

**File:** `apps/portal/src/app/family/page.tsx`

Real names/member counts from `getCurrentFamily()` sit beside hardcoded attendance/donation/calendar widgets marked “Sample data — real data coming soon”. Acceptable for pre-release prototype, but **remove or gate behind a flag before family announcement** (Slices 3–4).

---

### M4 — `AGENTS.md` is stale relative to `CLAUDE.md`

**File:** `AGENTS.md` (repo root)

- Still lists Slice B as “in progress” (shipped on `main`)
- References Slice C event registration (removed 2026-05-22)
- Missing Slice 2 sub-slice status, Setu release gating, prod Firestore index deploy rules

**Fix:** Sync from `CLAUDE.md` or replace with a pointer to it.

---

### M5 — Orphan Firestore index for removed Slice C

**File:** `firestore.indexes.json:11-18`

```json
{ "collectionGroup": "registrations", ... }
```

Slice C (event registration) was removed from the portal. Index is harmless but confusing; safe to delete on next index deploy to UAT (never `--force` prod).

---

## Low-severity / nits

### L1 — Double semicolon in invite accept route

**File:** `apps/portal/src/app/api/setu/invite/accept/route.ts:3`

```ts
import { revalidateTag } from 'next/cache';;
```

Cosmetic; lint doesn’t flag it.

---

### L2 — Welcome search debounce can flash stale results

**File:** `apps/portal/src/app/welcome/welcome-search.tsx` (see slice-2e-review L3)

In-flight fetches aren’t cancelled or sequence-guarded. Fast typists may see a brief wrong result set.

**Fix:** `AbortController` or monotonic sequence counter.

---

### L3 — `family/page.tsx` fallback name still `'Aarti Patel'`

**File:** `apps/portal/src/app/family/page.tsx:16`

Used only when `flags.setuAuth` is false (prototype mode). Production uses real data. Consider `'Family member'` for consistency with `DesktopSidebar`.

---

### L4 — Prototype-only hardcoded member data remains

**Files:** `apps/portal/src/features/family/data/mock.ts`, flag-off branches in member detail / register family prototype

Expected for `NEXT_PUBLIC_FEATURE_SETU_AUTH=false` dev previews. No production impact when flag is true.

---

### L5 — Invite accept assigns co-manager role — confirm product intent

**Files:** `apps/portal/src/app/api/setu/invite/accept/route.ts:132,188-189`

Invitees are created with `manager: true` and session role `family-manager`. Matches spec §7 (“typically the spouse” co-manager). Document clearly in UI so managers know invites grant manager privileges.

---

## Fixed since 2026-05-23 flow audit (verified)

| ID | Issue | Status |
|---|---|---|
| B1 (old) | `family-lookup` not public | ✅ Fixed in `public-routes.ts:27` |
| B2 (old) | `register` not public | ✅ Fixed in `public-routes.ts:28` |
| B3 | Invite accept stale session | ✅ Accept route sets claims + `__session` cookie |
| H2 (old) | Invite accept no sign-in redirect | ✅ `invite-accept-client.tsx` redirects on `no-session` |
| H3 (old) | No sign-out in Setu UI | ✅ `SignOutButton` in layout + mobile nav |
| H4 (old) | Hardcoded “Aarti Patel” sidebar | ✅ `DesktopSidebar` takes `displayName` / `subtitle` |
| M3 (old) | Register ignores `contact=verified` | ✅ `ContactVerifiedBanner` component |
| L1 (old) | Raw 409 error on add member | ✅ Human-readable message in `members/new/page.tsx` |
| L2 (old) | Blank edit page when member missing | ✅ Explicit “Member not found” UI |

Also fixed from slice-2b review:

- `joinFamily` idempotency when contactKey already has a member doc
- `registerFamily` checks all additional-member contactKeys inside transaction
- `generateFid()` uses `randomBytes` (CMT- prefix)
- Firestore indexes for `searchKeys`, `invites` collection group

---

## Architecture & security — things done well

1. **Method-aware middleware.** `canAccessRoute` distinguishes GET vs POST/PATCH/DELETE on `/api/setu/members*`, allows invite accept/GET for any signed-in role, and default-denies unknown Setu paths to manager/welcome/admin.

2. **Defense in depth on welcome-team detail.** `welcome/family/[fid]/page.tsx` re-verifies role from session cookie before reading Firestore.

3. **Atomic contactKey lifecycle.** PATCH and DELETE member routes manage `contactKeys` inside transactions; registration refuses pre-existing keys.

4. **Anti-enumeration on OTP send.** send-code and family-lookup return generic success on misses; rate limiting by contact hash / IP.

5. **Feature boundary discipline.** No cross-imports between `features/check-in` and `features/setu`; shared logic in `@cmt/shared-domain`.

6. **Test depth.** 789 unit tests including middleware integration, canAccessRoute matrix, registration integration, invite send/accept integration. Pre-push hook runs typecheck + lint + test + build.

7. **Mobile API surface.** `mode=mobile` on auth/register/join/accept + CORS via `MOBILE_CORS_ORIGINS` documented in `mobile-api-integration.md`.

8. **Multi-role support.** `extraRoles` forwarded through middleware; search route and verify-code preserve admin/welcome-team grants.

---

## Recommended fix order for Claude Code

| Priority | Task | Status |
|---|---|---|
| 1 | Replace register join `<Link>` with sign-in redirect | ✅ `98a360d` |
| 2 | “Didn’t get a code?” card on sign-in OTP screen | ✅ `b2b29dd` |
| 3 | Deprecate `/api/setu/family/join` (deleted, not gated) | ✅ `98a360d` |
| 4 | E2E for registration dedupe | ✅ `98a360d` |
| 5 | Sync `AGENTS.md` | ✅ `267839b` |
| 6 | `secure` cookie env toggle for local dev | ✅ `b2b29dd` |
| 7 | Welcome search stale-result guard | ✅ `b2b29dd` |

### Remaining doc/hygiene (optional)

| Task | Files |
|---|---|
| Remove `family/join` from `mobile-api-integration.md` | `apps/portal/docs/mobile-api-integration.md` |
| Update Slice 2b bullet in `CLAUDE.md` (dedupe via sign-in, not join) | `CLAUDE.md` |
| Add `registration-dedupe.e2e.test.ts` to e2e README table | `__tests__/e2e/README.md` |
| Pass contact to `/register/family` via sessionStorage instead of query params (M1) | `register/page.tsx`, `register/family/page.tsx` |

---

## Operational reminders (from CLAUDE.md)

- **Do not announce Setu to real families** until Slices 3 (donations) and 4 (teacher/attendance) ship; legacy `/login` + `/check-in/*` remains production entry.
- **Firestore index deploy:** UAT forced deploy OK; prod (`chinmaya-setu-715b8`) never `--force`.
- **UAT migration script:** `pnpm --filter @cmt/portal exec tsx scripts/migrate-legacy-families.ts` (~864 families, ~15 min full run).
- **E2E before release:** `pnpm --filter @cmt/portal test:e2e` against `chinmaya-setu-uat`.

---

## Reference documents

| Document | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-22-slice-2-setu-auth-family-api-design.md` | Slice 2 spec (source of truth) |
| `apps/portal/docs/2026-05-23-portal-flow-audit.md` | Prior cross-flow audit (many items now fixed) |
| `apps/portal/docs/slice-2{a,b,c,d,e}-review.md` | Sub-slice reviews with historical context |
| `apps/portal/docs/mobile-api-integration.md` | Mobile bearer + `mode=mobile` contract |
| `CLAUDE.md` | Current roadmap and operational rules |

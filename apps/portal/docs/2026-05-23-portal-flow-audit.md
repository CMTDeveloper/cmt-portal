# Cross-screen logical flow audit — 2026-05-23

Auditor: flow-auditor (code-reviewer, READ-ONLY)
Scope: 7 end-to-end user flows traced through actual code paths.

Severity: **B** = Blocker, **H** = High, **M** = Medium, **L** = Low, **Praise** = Good pattern.

---

## Flow 1: Brand-new user sign-up

### B1 — `/api/setu/family-lookup` is not a public route — registration lookup broken for new users

**Files:** `packages/shared-domain/src/auth/public-routes.ts`, `apps/portal/src/app/register/page.tsx:163`

The `/register` page is public and loads fine. But when the user fills email + phone, `RegisterReal` calls `fetch('/api/setu/family-lookup', ...)` (line 163). This endpoint is NOT listed in `PUBLIC_ROUTES` (public-routes.ts) and is not handled by any specific `canAccessRoute` rule for unauthenticated users. The middleware denies with 401 before the request reaches the route handler.

**User-observable symptom:** On `/register`, filling in both fields triggers a toast "Lookup failed. Please try again." The user cannot proceed to find or create a family. The entire registration flow is dead on arrival.

### B2 — `/api/setu/register` is not a public route — family creation broken for new users

**Files:** `packages/shared-domain/src/auth/public-routes.ts`, `apps/portal/src/app/register/family/page.tsx:205`

Even if B1 were fixed, the same problem blocks `/api/setu/register`. The `RegisterFamilyReal` component calls `fetch('/api/setu/register', ...)`. This endpoint falls through to the `canAccessRoute` catch-all (line 81 of can-access-route.ts) which requires `isSetuManager || isWelcomeTeam || isAdmin`. An unauthenticated user gets 401.

**User-observable symptom:** On `/register/family`, clicking "Create family & continue" shows a toast error. The user cannot register.

**Fix:** Add `/api/setu/family-lookup` and `/api/setu/register` to `PUBLIC_ROUTES` in `packages/shared-domain/src/auth/public-routes.ts`. Both routes have their own rate-limiting and input validation.

### M1 — Register page "Join the family" link uses a GET to `/api/setu/family/join`

**File:** `apps/portal/src/app/register/page.tsx:289`

When a lookup finds a match, the "Join the {name} family" button is a `<Link href={/api/setu/family/join?fid=...&email=...&phone=...}>`. This issues a GET request to an API route. The join route may not have a GET handler (only POST), and even if it does, passing email and phone as query params is a security concern (they appear in browser history, server logs, and referrer headers).

**User-observable symptom:** Clicking "Join" either navigates to a 405/404 error page, or leaks PII in URLs.

### M2 — Register form carries email/phone via query params to `/register/family`

**File:** `apps/portal/src/app/register/page.tsx:316`

The "Continue to family details" link passes email and phone as query params: `/register/family?email=...&phone=...`. This is visible in the address bar, browser history, and server logs. The data is later sent again in the POST body to `/api/setu/register`.

**User-observable symptom:** PII in the URL bar. Minor — the data is the user's own contact info and the pages are public, but it's a hygiene issue.

### Praise — Register family form handles server errors well

**File:** `apps/portal/src/app/register/family/page.tsx:226-234`

The `handleSubmit` function properly handles both field-level errors (from `body.fields`) and general errors, with toast fallback. The duplicate-contact 409 is handled correctly in the API route.

---

## Flow 2: Existing user sign-in

### H1 — Silent no-op when contact not found — user stuck on "Enter your code" forever

**Files:** `apps/portal/src/app/api/setu/auth/send-code/route.ts:53-54`, `apps/portal/src/app/sign-in/page.tsx:188-189`

When the contact is NOT found in any family (source === null), the send-code route returns `{ success: true }` status 200 **without sending any code** (anti-enumeration). The sign-in UI transitions to `pageState: 'code'` showing "Enter your code" with an OTP input. The user will never receive a code and is stuck.

The UI text says "New to Setu? Use the same form — if we don't find an account we'll walk you through registering your family." But the code does NOT walk them through anything. There is no path from the code screen to registration.

The user CAN click "Use a different address" to go back, or "Re-send code" (which also silently succeeds). But they will never understand why no code arrives.

**User-observable symptom:** "Check your inbox" shown, no code ever arrives. User is confused and stuck.

**Note:** The verify-code route (line 48-49) does handle the source===null case by redirecting to `/register?contact=verified`. But the user can never reach verify-code because they never received a code.

### M3 — Verify-code for no-family redirects to `/register?contact=verified` but register page doesn't read this param

**File:** `apps/portal/src/app/api/setu/auth/verify-code/route.ts:49`, `apps/portal/src/app/register/page.tsx`

If a user somehow did verify a code with source===null, verify-code returns `{ redirectTo: '/register?contact=verified' }` with no session cookie. The register page does NOT read the `contact=verified` param — it renders the standard lookup form. There is no verified/pre-authenticated state.

### Praise — Rate limiting and anti-enumeration are correct

**Files:** send-code route rate limiting, family-lookup route rate limiting

Both routes correctly implement rate limiting. The send-code route's 200 on no-match is correct anti-enumeration. The UX problem is upstream in the UI, not the API.

### Praise — Lazy migration wiring is correct

**File:** `apps/portal/src/app/api/setu/auth/verify-code/route.ts:82-98`

The legacy-to-Setu lazy migration fires correctly on sign-in, re-looks up the contact, and sets proper claims.

---

## Flow 3: Add-member flow

### L1 — Error message for 409 contact-conflict shows raw error code

**File:** `apps/portal/src/app/family/members/new/page.tsx:66`

When the POST to `/api/setu/members` returns 409 with `{ error: 'contact-already-registered', field: 'email' }`, the page displays the raw error string "contact-already-registered" to the user. It should be a human-readable message.

### Praise — Add-member flow works end-to-end

The add-member form correctly POSTs to `/api/setu/members`, handles the response, and redirects to `/family/members` on success. The form disables during submission. The API route has proper contactKey theft prevention.

---

## Flow 4: Edit-member flow

### Praise — Manager toggle correctly gated

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:53-55`

The manager toggle only shows when `isEditingOther` (a manager editing a different member). Self-editing does not show the toggle, matching the `canAccessRoute` PATCH rules.

### L2 — Edit page renders nothing when member not found

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:181-183`

When the member is not found in the family data, the page renders `null` (blank white screen) instead of a "member not found" message or redirect. The comment says "notFound() not available in client components" — but a fallback UI would be better than a blank page.

### L3 — Error handling on fetch failure in edit page

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:93-96`

If `getCurrentFamilyClient()` throws, the catch block just sets `loading = false`. The page then hits the "member not found" case and renders null. A visible error message would be better.

---

## Flow 5: Invite flow

### B3 — Invite accept does NOT refresh session claims — user locked out of `/family` after accepting

**Files:** `apps/portal/src/app/api/setu/invite/accept/route.ts:174-177`, `apps/portal/src/app/invite/[token]/invite-accept-client.tsx:24`

This is the most critical cross-slice boundary bug. The full sequence:

1. Invitee signs in via `/sign-in` → `verify-code` sets session claims `{ role: 'family' }` (no fid/mid, since they have no family yet).
2. Invitee navigates to `/invite/{token}` → clicks "Accept & join".
3. Accept route creates the member doc in Firestore and returns `{ mid, fid }` — but does NOT update the session cookie or Firebase Auth custom claims.
4. `InviteAcceptClient` redirects to `/family` via `window.location.href = '/family'`.
5. Middleware checks `canAccessRoute('/family')` → requires `isSetuFamily` → needs `role: 'family-manager'` or `'family-member'`. The cookie still has `role: 'family'`. **Access denied.**
6. User is redirected to `/sign-in?error=unauthorized`.
7. Even signing in again does NOT fix it: the verify-code route calls `findSetuFamilyByContact` which now finds the Setu family (accept wrote the contactKey), so it sets correct claims. But this is a confusing UX — the user must sign in AGAIN immediately after accepting an invite.

The accept route's own comment at line 174 says: "Session claims are now stale. A dedicated session-refresh endpoint is a follow-up for Slice 2e+."

**User-observable symptom:** Immediately after accepting an invite, user sees an "unauthorized" error and must sign in again. On second sign-in, they finally reach `/family`.

**Fix:** The accept route must update Firebase Auth custom claims and issue a fresh `__session` cookie in the response (same pattern as `/api/setu/register/route.ts` lines 88-123).

### H2 — No automatic redirect to `/sign-in` when unauthenticated invitee clicks Accept

**File:** `apps/portal/src/app/invite/[token]/invite-accept-client.tsx:19-21`

When accept returns 401 (`no-session`), the client shows a toast "Please sign in first using the email this invite was sent to." but does NOT redirect to `/sign-in`. The user must manually navigate there, sign in, then navigate BACK to the invite link. There is no `from=` param or state preservation.

**User-observable symptom:** Unauthenticated user sees a toast error. They must remember the invite URL or find the email again after signing in.

**Fix:** On `no-session` error, redirect to `/sign-in?from=/invite/{token}`. The middleware already passes `from=` to `/sign-in` for page-level 401s, so the pattern exists.

---

## Flow 6: Welcome-team flow

### Praise — Defense-in-depth role check is correct

**File:** `apps/portal/src/app/welcome/family/[fid]/page.tsx:20-38`

The Server Component re-verifies the welcome-team role from the session cookie before reading any family data. This is the correct defense-in-depth pattern. Renders "Access denied" if role doesn't match.

### L4 — Welcome-team sidebar "Pending" and "Donation periods" are not clearly labeled as coming-soon

**File:** `apps/portal/src/features/family/components/atoms.tsx:240-244`

The `WELCOME_NAV_ITEMS` array marks "Pending" and "Donation periods" with `disabled: true`, which renders them with `opacity: 0.5` and a small "Soon" label. This is a reasonable pattern. However, the "Soon" label is 10px uppercase — it might be easy to miss. Consider making these more visibly disabled.

---

## Flow 7: Sign-out / session expiry

### H3 — No sign-out button anywhere in the Setu family UI

**Files:** `apps/portal/src/features/family/components/atoms.tsx:246-289`, `apps/portal/src/app/family/page.tsx`

The DesktopSidebar has a user card at the bottom (lines 278-286) but NO sign-out option. The mobile bottom nav has a "Me" tab but it's a no-op button (no onClick, no href). There is NO sign-out mechanism in the entire `/family/*` UI.

The signout API exists at `POST /api/setu/auth/signout` and correctly clears the cookie, but no UI element calls it.

Sign-out buttons exist only in the legacy check-in pages (`/check-in/admin`, `/check-in/teacher`, `/check-in/family`).

**User-observable symptom:** A user who signs in to the family portal has no way to sign out. They must wait for the session cookie to expire (default: 5 days) or manually clear cookies.

### H4 — Sidebar user card is hardcoded to "Aarti Patel"

**File:** `apps/portal/src/features/family/components/atoms.tsx:280-284`

The user card at the bottom of the DesktopSidebar is hardcoded: `SetuAvatar name="Aarti Patel"`, `"Aarti Patel"`, `"Patel · FID 4421"`. This should display the actual signed-in user's name and family.

**User-observable symptom:** Every user sees "Aarti Patel" in the sidebar.

### Praise — Middleware session-expiry redirects work correctly

**File:** `apps/portal/src/middleware.ts:44-57`

When a session expires or is invalid, the `deny` function redirects to `/sign-in` (for `/family/*` routes) or `/login` (for legacy routes) with `from=` and `error=` params. This handles session expiry cleanly.

---

## Cross-cutting: Stub buttons and no-op elements

### M4 — Multiple no-op buttons that look functional

| Element | File | Line | Symptom |
|---|---|---|---|
| "Invited by someone? Use your link" | `app/page.tsx` | 53 | `<button>` with no handler |
| "Open class" on family dashboard | `app/family/page.tsx` | 69 | `<button>` with no handler |
| "View all" upcoming events | `app/family/page.tsx` | 89 | `<button>` with no handler |
| "Me" mobile nav tab | `app/family/page.tsx` | 139-141 | `<button>` with no handler |
| "Search" desktop header button | `app/family/page.tsx` | 157 | `<button>` with no handler |
| "Give $500" on donate page | `app/family/donate/page.tsx` | 124, 162 | `<button>` with no handler |
| "Remove from family" on member detail | `app/family/members/[mid]/page.tsx` | 82, 141 | `<button>` with no handler |

These are visual prototypes for features not yet wired (Slices 3-4). They look interactive but do nothing on click. Users will tap them expecting a result.

### M5 — Desktop homepage nav links point to `#`

**File:** `apps/portal/src/app/page.tsx:38-40`

"About", "Events", "Contact" all link to `href="#"`. Users clicking them scroll to the top and nothing happens.

### M6 — Hardcoded metrics on family dashboard

**File:** `apps/portal/src/app/family/page.tsx`

The dashboard shows hardcoded data: "92% attendance", "$500 donation pending", specific calendar dates (Jun 14/21/28), "Enrolled" status. These are visual prototypes. With real `getCurrentFamily()` data feeding the name/members, the mix of real and fake data could confuse users.

---

## Summary table

| ID | Severity | Flow | Issue |
|---|---|---|---|
| B1 | **Blocker** | Sign-up | `/api/setu/family-lookup` not public — registration lookup broken |
| B2 | **Blocker** | Sign-up | `/api/setu/register` not public — family creation broken |
| B3 | **Blocker** | Invite | Accept does not refresh session claims — user locked out after accepting |
| H1 | High | Sign-in | Silent no-op when contact not found — user stuck on OTP screen |
| H2 | High | Invite | No redirect to sign-in for unauthenticated invitee |
| H3 | High | Sign-out | No sign-out button anywhere in the Setu family UI |
| H4 | High | Dashboard | Sidebar user card hardcoded to "Aarti Patel" |
| M1 | Medium | Sign-up | Join-family link uses GET to API route with PII in URL |
| M2 | Medium | Sign-up | Email/phone in query params to register/family |
| M3 | Medium | Sign-in | verify-code redirects to `/register?contact=verified` but register page ignores the param |
| M4 | Medium | Cross-cutting | 7 no-op buttons that look functional |
| M5 | Medium | Landing | Desktop nav links point to `#` |
| M6 | Medium | Dashboard | Hardcoded metrics mixed with real data |
| L1 | Low | Add member | Raw error code shown for 409 contact-conflict |
| L2 | Low | Edit member | Blank page when member not found |
| L3 | Low | Edit member | Silent catch on fetch failure |
| L4 | Low | Welcome | "Soon" labels hard to notice |

---

## Top 3 actionable items

1. **Add `/api/setu/family-lookup` and `/api/setu/register` to `PUBLIC_ROUTES`** (B1, B2). Without this, the entire new-user registration flow is non-functional. Both routes already have rate-limiting and validation.

2. **Add session-refresh to the invite-accept route** (B3). After creating the member doc, update Firebase Auth custom claims and issue a fresh `__session` cookie in the response. The pattern already exists in `/api/setu/register/route.ts`.

3. **Add a sign-out button to the DesktopSidebar and mobile nav** (H3). Wire it to `POST /api/setu/auth/signout`. The signout API exists and works correctly.

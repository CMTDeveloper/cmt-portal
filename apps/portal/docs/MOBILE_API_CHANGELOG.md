# Mobile API contract changelog

The Chinmaya Setu **mobile app** (`chinmaya-setu-mobile`) mirrors this portal's
`/api/setu/*` request/response shapes **by hand** in `src/api/schemas/*.ts`
(+ the fetch calls in `src/api/*.ts`). It does **not** import `@cmt/shared-domain`.
So whenever a `/api/setu/**` route — or a `@cmt/shared-domain` schema it depends
on — changes its response/request shape, error codes, or required fields, the
mobile mirror must be updated to match or it silently drifts.

**This file is the contract handshake between the two repos.** The portal session
appends an entry here on every contract-affecting change; the mobile session's
`contract-sync` cron reads new entries (keyed by the portal commit SHA), updates
`src/api/schemas/*` + `src/api/*.ts`, runs its gate, and commits.

**Format:** newest first. Each entry cites the **portal commit SHA** so the mobile
cron can match it against `git log <watermark>..origin/main`. Keep entries small
and action-oriented: *what changed* + *what the mobile must do*.

**Mobile baseline:** the app was last built against portal commit **`e230061`**
(mobile API prerequisites — Bearer auth + the dashboard/donations endpoints).
Everything below is the backlog of contract changes since then.

---

## `0225cca` · 2026-06-22 · family-lookup classification + join-request flow
- **POST `/api/setu/family-lookup`** — the found response will gain **`matchAction: 'sign-in' | 'request-to-join'`** alongside the existing `{ found, matchedType, matchedValue }`. `'sign-in'` = the matched contact is a manager or active member (sign in as today); `'request-to-join'` = a roster-origin non-manager member whose access is gated until a manager approves.
  - **Mobile:** add `matchAction` to the family-lookup response schema in `src/api/schemas/auth.ts`; on `'request-to-join'` show a "send a request to your manager" CTA instead of the sign-in CTA.
- **POST `/api/setu/auth/verify-code`** — for a `portalAccess: 'pending'` member the response will carry a **`pendingApproval: true`** signal (+ `fid`, `matchedMid`) and grant **no** family-member claims; the user must wait for manager approval. Managers and active/absent members are unchanged.
  - **Mobile:** handle `pendingApproval` in the verify-code response — surface "access pending your manager's approval" and offer to (re)send the join request rather than landing in the family home.
- **New `POST /api/setu/join-request/send`** (open + IP rate-limited), **`GET /api/setu/join-request/[token]`** (manager-only), **`POST /api/setu/join-request/approve`** and **`POST /api/setu/join-request/decline`** (manager-only) — the member→manager join-request flow. `send` writes a pending request and notifies managers; `approve` promotes the matched member to co-manager.
  - **Mobile:** add the four endpoints + their request/response schemas (mirror the invite flow shapes) once they ship.

## `1d469cf` · 2026-06-21 · #12 invite existing-member guard
- **POST `/api/setu/invite/send`** — now returns **`409 { error: 'already-member' }`** when the invited email already belongs to a family member (primary email or `altEmails`). Previously only `201` / `family-not-found`.
  - **Mobile:** handle the 409 `already-member` case in the invite flow ("already a member of your family"). `src/api/auth.ts:148` already documents it — just verify it's wired in the UI. No response-schema change.

## `73ebdb9` · 2026-06-21 · #10 adult volunteering-skills required
- **POST `/api/setu/members`** and **PATCH `/api/setu/members/[mid]`** — for `type === 'Adult'`, `volunteeringSkills` must contain **≥ 1** item, else **`400 { error: 'skills-required' }`**. Children are never required. PATCH enforces only when `volunteeringSkills` is present in the body.
  - **Mobile:** in the add/edit-member flow require an adult to pick at least one skill before submit, and handle the `skills-required` 400. (The skill *options* list also changed to 11 new values, served by the volunteering-skills options endpoint — no shape change.)

## `a75613d` · 2026-06-21 · #3 dashboard attendance removed
- **GET `/api/setu/dashboard`** — the **`attendance`** sub-object is **removed** from the response. Family-level attendance is no longer a dashboard concept; per-child attendance remains only on the child profile (`/api/setu/members/[mid]/profile`, unchanged).
  - **Mobile:** remove `attendance` (the `attendanceSchema` usage) from `src/api/schemas/dashboard.ts` and any home-screen UI that reads it. ⚠️ Already drifting — `src/api/schemas/dashboard.ts:~55` still declares it.

## `6abbcb9` · 2026-06-21 · security: OTP-gate registration
- **POST `/api/setu/auth/send-code`** — accepts optional **`purpose: 'signin' | 'register'`**. For a brand-new email the client MUST send `purpose:'register'` to receive a code (the sign-in path returns a silent `200` with no code for unknown contacts).
- **POST `/api/setu/auth/verify-code`** — on the no-family (email) path the response now includes a **`registrationGrant`** token.
- **POST `/api/setu/register`** — request body now **requires `registrationGrant`** (the token from verify-code). Missing → `400`; invalid/expired → **`403 { error: 'registration-unverified' }`**.
  - **Mobile:** registration flow must be: send-code `{ purpose: 'register' }` → verify-code returns `registrationGrant` → pass it in the `/register` body. Update `src/api/auth.ts` (register call + verify-code handling) and `src/api/schemas/auth.ts`.

## `1c7f2f1` · 2026-06-21 · security: family-lookup PII trim
- **POST `/api/setu/family-lookup`** — the `match` field is trimmed to **`{ found: true, matchedType: 'email' | 'phone', matchedValue: string } | null`** (no family/member PII). Response is still `{ match }`.
  - **Mobile:** update the family-lookup response schema in `src/api/schemas/auth.ts` to the trimmed `match` shape (it already treats `match: null` as "no family").

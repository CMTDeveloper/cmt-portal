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

## `120c885` · 2026-06-22 · profile-completion gate + required member-field matrix
A per-type "required member info" matrix is now enforced at every member write. The mobile add/edit-member + registration forms must capture + validate the same fields and handle the new 400 codes, or members it creates will be incomplete.
- **Matrix:** ALL members → `gender` (now **`Male|Female` only** on write — `PreferNotToSay` is rejected by the write enums), `foodAllergies` (non-empty; offer a "No known allergies" choice that sends the sentinel **`'None'`**). ADULTS → `email` + `phone` + `volunteeringSkills` (≥ 1). CHILDREN → `schoolGrade` + `birthMonthYear` (`'YYYY-MM'`). `birthMonth` (1-12) is now **derived server-side** from `birthMonthYear` — the client need not send it (it's still honoured when `birthMonthYear` is absent).
- **POST `/api/setu/members`** + **PATCH `/api/setu/members/[mid]`** — new `400 { error }` codes: **`foodAllergies-required`**, **`contact-required`** (an adult missing email or phone), **`grade-required`**, **`birthmonth-required`** (plus the existing `skills-required`). The write-side `gender` enum is now `['Male','Female']`. PATCH enforces a rule **only when the patch touches that field (or changes `type`)**, so a partial patch of a still-incomplete legacy member is not blocked. Same-**family** contact reuse now **shares** the existing contactKey (no overwrite); cross-family reuse still returns `409 { error: 'contact-already-registered', field }`.
  - **Mobile:** in add/edit-member, require gender (Male/Female) + foodAllergies (with a "No known allergies" → `'None'` affordance) for everyone; email+phone+≥1 skill for adults; schoolGrade + a month/year picker (→ `'YYYY-MM'`) for children. Block submit until satisfied; map the new 400 codes to friendly copy. Remove any `PreferNotToSay` option from capture forms.
- **POST `/api/setu/register`** — the body's `manager` object now accepts **and requires** `foodAllergies` + `volunteeringSkills` (≥ 1); `additionalMembers[]` now accepts `foodAllergies`, `volunteeringSkills`, `schoolGrade`, `birthMonthYear`, `email`, `phone`, with `gender` `Male|Female`. Same per-type 400 codes as above, with the response adding **`member: 'manager' | <index>`** to point at the offender. An adult **may reuse the manager's email/phone** (same-family reuse is accepted, not a `duplicate-contact`).
  - **Mobile:** the registration flow must capture the manager's foodAllergies + skills and each added member's per-type required fields, and handle the per-type 400s (`member` tells you which row).
- **Post-sign-in gate (web only):** the portal now hard-redirects an incomplete family to `/family/complete-profile` before the dashboard. The mobile app has no such route, but its home should prompt completion when `GET /api/setu/family` / `GET /api/setu/dashboard` shows members missing the matrix fields. **No response-shape change** to those read endpoints.

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

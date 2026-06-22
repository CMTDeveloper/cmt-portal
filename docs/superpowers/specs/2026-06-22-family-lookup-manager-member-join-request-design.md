# Family lookup: manager/member classification + gated co-manager join-request — Design

**Date:** 2026-06-22
**Status:** Approved (owner sign-off 2026-06-22), ready to plan + build.
**Owner decisions captured below.** Supersedes the single-bucket "any match → sign in" lookup.

## Context

On the registration "Let's find your family" screen (`/register`), the lookup
(`POST /api/setu/family-lookup` → `lookupFamilyByContactList`) currently hashes each
entered contact and checks only `contactKeys/{hash}.exists`, returning a flat
`{found, matchedType, matchedValue}`. **Every** hit renders the same
"This contact is already registered → Sign in to access my family" panel — manager
and non-manager member collapse to one outcome.

The legacy RTDB roster has three email fields per family: `pemail` (the family
**manager's** email), `email` (a **non-manager member's** email), and `emergency_email`
(an emergency contact). Migration (`lazy-migrate.ts:158-179`) already encodes the first
two — `pemail` → the manager member's mid, each adult's own `email` → that adult's mid —
so manager-vs-member is derivable from the matched `contactKey`'s `mid` + the member's
`manager` flag / `families/{fid}.managers[]`. `emergency_email` is **never parsed,
hashed, or written as a contactKey**, so it already cannot match (requirement satisfied by
omission today).

### The pivotal fact (drives the scope)

Migration writes a signable `contactKey` for **every** adult's email, so a non-manager
member can OTP-sign-in and access the family **today, with no approval**. The owner's
intent — *"then only that person will be part of that family"* after the manager accepts —
requires **blocking** that auto-access. This is therefore an access-control change touching
the sign-in/claims path, not just a lookup-UI change.

## Owner decisions

1. **Differentiate on the lookup screen, no OTP-verify before the request is sent.** The
   lookup shows three outcomes; a non-manager match sends the join request without the
   requester proving email ownership first. (Final access still requires OTP ownership at
   sign-in — see Security.)
2. **Manager approves via email link + an in-app `/family` pending-requests panel.**
3. **Approved joiners become co-managers** (`manager:true`, added to `family.managers`,
   role `family-manager`) — same shape as the existing invite/accept path.
4. **Lookup matches migrated Setu families only.** RTDB is being frozen (school year over;
   the portal owns all new registrations), so the full RTDB→Setu migration is a
   **prerequisite** — every legacy family must be migrated to be findable.
5. **Gate non-manager access** until a manager approves (the full access-control change).

## Goals / Non-goals

**Goals:** classify a lookup match as sign-in vs request-to-join vs register; block
non-manager (roster-origin) members from family access until approved; a member→manager
join-request flow with manager approval that promotes the matched member to co-manager;
keep emergency contacts unmatchable (now explicitly + tested).

**Non-goals (this slice):** the register-new step-2 field redesign (owner to spec
separately — the no-match branch is unchanged); any change to the manager (`pemail`)
sign-in path; retiring the invite flow.

## Design

### A. Data model

- **Member doc** (`packages/shared-domain/src/setu/schemas/member.ts`): add
  `portalAccess?: 'active' | 'pending'`. **Optional; absent ⇒ active** (so every existing
  member doc still validates on read — never tighten a read-validated doc schema). Only the
  migration path sets `pending`.
- **New `joinRequests` subcollection** `families/{fid}/joinRequests/{token}`:
  `{ token, fid, matchedMid, requesterEmail, requesterPhone?, requesterName?,
  status: 'pending'|'approved'|'declined', createdAt, expiresAt }`. New Zod schema
  `JoinRequestDocSchema` in shared-domain. `token = crypto.randomBytes(24).toString('base64url')`.
  TTL via `SETU_INVITE_TTL_DAYS` (reuse; rename-agnostic).
- **New `joinRequests` collectionGroup index** in `firestore.indexes.json`
  (`token` ASC, plus `status`+`createdAt` for the manager list). **Deploy to UAT only —
  never `--force` against prod 715b8.**
- **Lookup result type** (`registration/family-lookup.ts`): replace the flat result with
  `{ found: true, matchedType, matchedValue, matchAction: 'sign-in' | 'request-to-join' } | null`.

### B. The sign-in gate

`build-session-claims` / `find-family-by-contact`: when a matched contact resolves to a
member with `portalAccess === 'pending'`, **do not grant family claims**. The verify-code
response carries a `pendingApproval: true` (+ fid/matchedMid) signal so the sign-in UI can
show *"access pending your manager's approval"* and offer to (re)send the join request.
Managers and `portalAccess: active|absent` members are unaffected.

### C. Lookup classification

`lookupFamilyByContactList` reads the matched `contactKeys/{hash}` **body** (`fid`,`mid`),
loads the member, and returns:
- member is a manager **or** `portalAccess` active/absent → `matchAction: 'sign-in'`;
- member `portalAccess: 'pending'` → `matchAction: 'request-to-join'`;
- no contactKey hit → `null` (register).
It still returns **no family name/email** — only the action bit + the echoed matched contact
(anti-enumeration posture preserved; the marginal disclosure is one action bit on a contact
the caller already supplied). Emergency emails never produce a contactKey → `null` → an
explicit guard + regression test pin "emergency never matches."

`/api/setu/family-lookup` response gains `matchAction`. **Mobile-mirrored → append a
`MOBILE_API_CHANGELOG.md` entry.**

`/register` (`page.tsx`) renders a third branch on `matchAction === 'request-to-join'`: the
**"we found your family — send a request to your manager"** panel with a "Send request" CTA
(POSTs `join-request/send`). Desktop + mobile branches share `formContent`.

### D. Join-request flow

New routes under `apps/portal/src/app/api/setu/join-request/` (each needs an explicit
`canAccessRoute` rule — the `/api/setu/` catch-all is manager-only):
- `POST .../send` — **open + IP rate-limited** (requester may have no session; per decision 1
  no OTP first). Resolves `fid`+`matchedMid` from the contact's contactKey, asserts the
  matched member is `portalAccess: 'pending'` (else 409 `already-active`/`already-manager`),
  rejects a duplicate open request (409 `already-requested`), writes the pending
  `joinRequests/{token}`, and **notifies all `family.managers` by email + SMS** via
  `resolveSender` + a cloned SES template (`setu-join-request-email.ts`).
- `GET .../[token]` — manager-only; returns request metadata for the approve page.
- `POST .../approve` — manager-only, `claims.fid === request.fid`. Atomic txn (mirrors
  `invite/accept` incl. the contactKey theft check): promote the **existing matched member** —
  `manager:true`, `arrayUnion(matchedMid)` into `family.managers`, `portalAccess: 'active'`;
  mark request `approved`. Does **not** mint the requester's session (they sign in later).
- `POST .../decline` — manager-only; mark `declined`.

Manager surface: a **pending-requests panel on `/family`** (list open requests, approve/deny)
+ the emailed link → `/join-request/[token]` approve page mirroring `/invite/[token]`.
Desktop + mobile.

### E. Migration + backfill

- `lazy-migrate.ts` (and therefore the bulk `migrate-legacy-families.ts`): set
  `portalAccess: 'pending'` on every migrated **non-primary** adult member; the primary
  (`pemail`) manager and any synthetic manager are `active` (absent).
- **One-time UAT backfill script** (`scripts/`, pnpm alias, `tsx --env-file=.env.local`):
  set `portalAccess: 'pending'` on already-migrated non-manager members. Idempotent.
- **Verify full UAT migration coverage** before relying on Setu-only lookup; run the full
  RTDB→Setu migration if incomplete (UAT only, ~15 min). Update the cutover runbook.
- **One-time UAT read** confirming no contactKey was ever written from an emergency field
  (code says impossible; verify, don't assume).

## Security

- Anti-enumeration: lookup discloses only a single action bit about a contact the caller
  supplied; no family PII returned. The manager's contact is used **server-side** to notify,
  never returned to the requester.
- Two gates for a pending member: **manager approval** + **OTP ownership of the email at
  sign-in** (Setu OTP inherently enforces the latter). The join request alone grants nothing.
- `canAccessRoute`: `send` open+rate-limited; `[token]`/`approve`/`decline` manager-only
  (`isSetuManager` + fid match). Last-manager guard is irrelevant (approval only **adds** a
  manager).
- Dedupe: 409 on already-active/already-manager and on a duplicate open request.

## Testing

- Unit tests in the same commits (lookup classification incl. emergency-never-matches; the
  sign-in gate for pending vs active; each join-request route incl. dedupe/theft/auth;
  migration sets pending only for non-primary adults).
- **Playwright E2E** (per-feature requirement) against deployed UAT: pemail→sign-in ·
  member-email→request→manager-approve→co-manager sign-in · emergency→register · cleanup.
- Full vitest suite (incl. the separate integration dirs) before each push; pre-push gate.

## Rollout

Solo-dev main-only, UAT-only DB ops, no `--force` on prod indexes. Deploy the `joinRequests`
index to UAT. Mobile changelog entry for the lookup shape change + the verify-code
`pendingApproval` signal + the new join-request endpoints. Update the production-cutover
runbook (migration coverage + the new collection/index + backfill).

## Deferred / open

- Register-new **step 2** fields — owner to spec separately.
- Whether welcome-team/admin may approve on a manager's behalf (front-desk) — deferred;
  manager-only for v1.
- SMS to Canadian managers carries the `ca-central-1`/origination caveat; email is the
  primary channel, SMS best-effort.

# Family lookup classification + gated co-manager join-request - Implementation Plan

> **For agentic workers:** execute task-by-task with a separate review pass after each. TDD:
> failing test → implement → green → commit. Spec: `docs/superpowers/specs/2026-06-22-family-lookup-manager-member-join-request-design.md`.

**Goal:** classify a registration lookup as sign-in / request-to-join / register; gate
non-manager (roster-origin) members out of family access until a manager approves; a
member→manager join-request flow that promotes the matched member to co-manager.

**Tech:** Next.js 16, Firestore (Admin SDK), Zod shared-domain schemas, AWS SES/SNS via
`resolveSender`, Playwright E2E. `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` on.

**Execution shape:** Task 0 (verify, read-only) → Tasks 1-2 **foundation, sequential**
(claims all shared files) → Tasks 3-7 **parallel** (disjoint file-sets, all import foundation)
→ Tasks 8-9 integration/E2E/data-ops. Owner does final UAT browser walk + announce.

---

## Task 0 - UAT prerequisite verification (read-only, no schema change)

**Files:** `apps/portal/scripts/verify-migration-and-keys.ts` (temp, may be deleted after).
- Count legacy RTDB families (from snapshot) vs migrated Setu families (`families` collection
  in UAT). Report coverage %.
- Query a sample of UAT `contactKeys` and assert none trace to an emergency field (cross-check
  each `contactKey.mid`→member; emergency contacts live in `emergencyContacts`, never indexed).
- Output: whether a full RTDB→Setu migration run is still needed (Task 9), and confirmation
  that no emergency contactKey cleanup is required.
- **UAT only** (`PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat`). Never touch prod 715b8.

---

## Task 1 - Foundation: shared-domain schemas + types (sequential, FIRST)

**Files:**
- Modify `packages/shared-domain/src/setu/schemas/member.ts`: add
  `portalAccess: z.enum(['active','pending']).optional()`. **Optional - absent ⇒ active.** Do
  NOT make required; this validates on read. Add a one-line comment explaining the default.
- Create `packages/shared-domain/src/setu/schemas/join-request.ts`: `JoinRequestDocSchema` =
  `{ token, fid, matchedMid, requesterEmail, requesterPhone?, requesterName?,
  status: z.enum(['pending','approved','declined']), createdAt, expiresAt }` + exported type.
- Modify `packages/shared-domain/src/setu/registration` lookup result type / wherever
  `LookupResult` is defined (`apps/portal/src/features/setu/registration/family-lookup.ts:10-17`):
  add `matchAction: 'sign-in' | 'request-to-join'` to the found shape.
- Export the new schema from the shared-domain setu index.

**Tests (same commit):** schema parse round-trips; a member doc WITHOUT `portalAccess` still
parses (the read-validation guard); `JoinRequestDocSchema` rejects a bad status.

---

## Task 2 - Foundation: shared infra (sequential, claims canAccessRoute + index + changelog)

**Files:**
- `packages/shared-domain/src/auth/can-access-route.ts`: add explicit rules -
  `POST /api/setu/join-request/send` → open (any/none role; relies on IP rate-limit in the
  handler); `GET /api/setu/join-request/[token]`, `POST .../approve`, `POST .../decline` →
  `isSetuManager` (+ admin/welcome-team only if later desired - manager-only for v1). Mirror
  the existing invite rules at `:109-122`. Method-aware.
- `firestore.indexes.json`: add the `joinRequests` collectionGroup index(es): `token` ASC;
  and `status` + `createdAt DESC` for the manager list. **UAT-deploy only (Task 9).**
- `apps/portal/docs/MOBILE_API_CHANGELOG.md`: append the dated, SHA-keyed entry (finalize SHA
  in Task 9) describing: `family-lookup` gains `matchAction`; `verify-code` gains
  `pendingApproval`; the four new `join-request` endpoints.

**Tests:** `can-access-route` unit cases for each new path × role (manager allowed, family
denied on approve, none allowed on send, etc.) - added in the same commit.

---

## Task 3 - Lookup classification (parallel; files: registration/family-lookup + route)

**Files:** `apps/portal/src/features/setu/registration/family-lookup.ts`,
`apps/portal/src/app/api/setu/family-lookup/route.ts`,
`.../family-lookup/__tests__/route.test.ts`.
- TDD: test that a manager-email hit → `matchAction:'sign-in'`; a `portalAccess:'pending'`
  member hit → `matchAction:'request-to-join'`; an emergency email (never a contactKey) → `null`;
  no hit → `null`.
- Implement: in `lookupFamilyByContactList`, read the contactKey doc **body** (`fid`,`mid`),
  load the member, classify (manager or active/absent → sign-in; pending → request-to-join).
  Stay PII-free (return only `matchAction` + echoed contact). Add an explicit comment + test
  pinning "emergency contacts are never indexed → never matched."
- Update the route's response to include `matchAction`; fix `route.test.ts` PII assertions to
  the new shape.

---

## Task 4 - Sign-in gate (parallel; files: find-family-by-contact + build-session-claims + verify-code)

**Files:** `apps/portal/src/features/setu/auth/find-family-by-contact.ts`,
`apps/portal/src/features/setu/auth/build-session-claims.ts`,
`apps/portal/src/app/api/setu/auth/verify-code/route.ts`, + tests.
- TDD: a verify-code on a `portalAccess:'pending'` member returns `pendingApproval:true`
  (+ fid, matchedMid) and **no family-member claims**; a manager / active member is unchanged.
- Implement: when the resolved member is `portalAccess:'pending'`, short-circuit claim
  assignment and return the `pendingApproval` signal. Managers and active/absent members
  unaffected. Keep the lazy-migrate-on-legacy-hit path intact (a freshly lazy-migrated
  non-primary adult is `pending`).

---

## Task 5 - Migration sets pending + backfill (parallel; files: lazy-migrate + script)

**Files:** `apps/portal/src/features/setu/registration/lazy-migrate.ts`,
`apps/portal/scripts/backfill-portal-access.ts` (+ pnpm alias in `apps/portal/package.json`),
+ tests.
- TDD: migrating a family with 1 primary + 2 other adults → primary `active`/absent, the two
  others `portalAccess:'pending'`; children unaffected (no contactKey anyway).
- Implement: in `lazy-migrate.ts`, set `portalAccess:'pending'` on every non-primary adult
  member doc.
- Backfill script: idempotent; iterate UAT `members` collectionGroup, set `pending` on members
  that are non-manager (not in `family.managers`) and lack `portalAccess`. `--dry-run`,
  `--allow-prod` guard refusing non-UAT. `tsx --env-file=.env.local`. (Run in Task 9.)

---

## Task 6 - Join-request backend (parallel; files: new join-request routes + helpers + template)

**Files (all new except canAccessRoute already done in Task 2):**
`apps/portal/src/app/api/setu/join-request/{send,approve,decline}/route.ts`,
`apps/portal/src/app/api/setu/join-request/[token]/route.ts`,
`apps/portal/src/features/setu/join-request/{create-request,get-by-token,approve-request,decline-request}.ts`,
`apps/portal/src/lib/aws/templates/setu-join-request-email.ts`, + tests per file.
- TDD per route: `send` writes a pending doc + notifies managers, 409 on already-active /
  already-manager / duplicate-open-request, IP rate-limited; `[token]` GET manager-only;
  `approve` promotes the matched member (manager:true, `arrayUnion` managers,
  `portalAccess:'active'`), marks approved, contactKey theft check, manager-only + fid match;
  `decline` marks declined, manager-only.
- Reuse patterns: `invite/send` (token + resolveSender), `invite/accept` (atomic txn + theft
  check), `get-invite` (collectionGroup-by-token). Clone the SES template.
- E2E mock note: mock `next/cache` `revalidateTag`; pre-create auth users in fixtures.

---

## Task 7 - UI (parallel; files: register page + family panel + token page + sign-in)

**Files:** `apps/portal/src/app/register/page.tsx` (3rd branch + send-request CTA →
`join-request/send`), the `/family` page (pending-requests panel: list open requests,
approve/deny calling the endpoints), `apps/portal/src/app/join-request/[token]/page.tsx`
(approve page mirroring `/invite/[token]`), `apps/portal/src/app/sign-in/page.tsx`
(pending-approval state on `pendingApproval`). Desktop + mobile (`block md:hidden`) branches;
`.csp` token scoping for any fixed/overlay chrome. Client→server via `-client` fetch wrappers.
- Tests: component tests for the new register branch + the family panel states.

---

## Task 8 - Playwright E2E (after 3-7 integrate green)

**Files:** `apps/portal/e2e/setu/registration/join-request.spec.ts`.
- Flows vs deployed UAT: pemail→sign-in CTA; non-manager member-email→request-to-join panel→
  send→(seed manager session)→approve→ the promoted member can OTP/password sign-in as a
  family-manager; emergency email→register; decline path. Seed + clean up `_test:true`.

---

## Task 9 - UAT data ops + finalize (after all green, before owner walk)

- Verify full UAT migration coverage (Task 0 result); if incomplete, run
  `migrate-legacy-families.ts` for UAT (~15 min, UAT only).
- Run `backfill-portal-access.ts` against UAT (idempotent).
- Deploy the `joinRequests` index to UAT (`firebase deploy --only firestore:indexes
  --project chinmaya-setu-uat`). **Never `--force`; never prod.**
- Finalize the `MOBILE_API_CHANGELOG.md` entry with the real SHAs.
- Update `docs/runbooks/production-cutover-checklist.md` (new collection + index + backfill +
  the access-gate behavior change) with a dated change-log entry.

---

## Self-review checklist
- member `portalAccess` is **optional** (never tighten a read-validated doc schema). ✓
- every new `/api/setu/join-request/*` path has a `canAccessRoute` rule. ✓
- emergency never matches - explicit guard + regression test. ✓
- N=2 case: a family with two pending non-manager members + two managers exercised. ✓
- mobile changelog entry for every `/api/setu/**` shape change. ✓
- UAT-only DB/index ops; no `--force`; no prod. ✓

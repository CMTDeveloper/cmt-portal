# Slice 2b Code Review

**Reviewer:** worker-3
**Date:** 2026-05-22
**Scope:** Slice 2b — Family registration (schemas, data layer, API routes, frontend rewire, M4 resend fix)
**Baseline:** `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS (464 tests, 86 suites)

## Verdict

Approve with follow-ups

The implementation is solid: transactional duplicate prevention in `registerFamily` is correct, the contactKey dedup pattern is applied consistently, rate-limiting in family-lookup is correct, and the frontend rewire is complete. Two issues are worth tracking as follow-ups (non-blockers now, but load-bearing if Slice 2c extends these paths).

---

## Critical issues

None.

---

## High-severity issues

### H1. `joinFamily` computes member seq from collection size read INSIDE the transaction — but this is safe

Initially flagged as a race: `membersSnap.size` read inside `db.runTransaction`. On closer inspection, the Firestore SDK collection reads inside a transaction ARE included in the optimistic-lock set — if another transaction commits a write to `families/{fid}/members` between this read and commit, the transaction retries. So the `mid` sequence is safe.

**However:** `joinFamily` (line 54-74 in `family-join.ts`) always writes a NEW member document regardless of whether the contact key's `mid` already refers to an existing member. The `existingMid` (line 51) is read but only used to determine `isManager` — the function never checks if a member doc for `existingMid` already exists, and unconditionally writes a new doc at `${fid}-${zeroPad(memberCount + 1)}`. A repeat call to `joinFamily` with the same contact proof will create a duplicate member doc.

**Impact:** If the `/api/setu/family/join` route is called twice (network retry, double-submit), the family ends up with two member docs for the same contact key, with the second `contactKeys` write overwriting the `mid` pointer to the new doc. The old member doc orphans.

**Fix:** Before writing, check if a member doc already exists for `existingMid` (read `db.collection('families').doc(fid).collection('members').doc(existingMid)` inside the transaction). If it exists, return early with `{ fid, mid: existingMid, isManager }` — idempotent join.

### H2. Missing Firestore indexes for Setu collections

**File:** `firestore.indexes.json`

The current index file only has indexes for `check_in_events` (Slice B2) and `registrations` (Slice C). Three new queries from Slice 2b are unindexed:

1. **`lazy-migrate.ts` line 34:** `db.collection('families').where('legacyFid', '==', legacyFid).limit(1)` — requires a single-field index on `families.legacyFid` (Firestore auto-indexes single fields by default, so this will work without a composite index entry, but it should be verified on the actual Firebase project).

2. **`family-lookup.ts`:** The `lookupFamilyByContacts` function uses `contactKeys` lookups by document ID (hash), which are point reads — no index needed.

3. **`lazy-migrate.ts` line 50:** The `searchKeys` array field stored on `families` documents is used for future welcome-team search (not yet queried in Slice 2b). When Slice 2c adds `where('searchKeys', 'array-contains', query)`, it will need a composite index. **Add this now** so the first Slice 2c deploy doesn't fail at runtime.

**Required addition to `firestore.indexes.json`:**
```json
{
  "collectionGroup": "families",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "searchKeys", "mode": "ARRAY_CONTAINS" },
    { "fieldPath": "location", "order": "ASCENDING" }
  ]
}
```

---

## Medium-severity issues

### M1. `generateFid()` uses `Math.random()` — not cryptographically secure

**Files:** `register-family.ts:34-41`, `lazy-migrate.ts:11-18`

`Math.random()` is not suitable for generating identifiers that need unpredictability. A 12-character alphanumeric FID from a 36-char alphabet gives ~62 bits of entropy with `Math.random()` but only ~32 effective bits due to the V8 engine's PRNG seeding (64-bit state). Two rapid deployments of the same Node.js worker could theoretically produce colliding FIDs.

**Fix:** Replace with `randomBytes` from `node:crypto`:
```ts
import { randomBytes } from 'node:crypto';

function generateFid(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
```
This gives true cryptographic randomness. The transaction's idempotency check (`where('legacyFid', '==', legacyFid)` and `contactKeys` existence check) already makes FID collisions non-fatal, but CSPRNG is a low-effort improvement.

### M2. `registerFamily` does not check for duplicate additional-member contacts atomically

**File:** `register-family.ts:131-148`

The transaction checks `emailHash` and `phoneHash` for the manager contact pair (lines 58-67), but does NOT check whether any `additionalMember`'s email/phone is already in `contactKeys` before writing. If an additional member shares a contact with an existing family, the transaction silently overwrites the `contactKeys` doc, reassigning that contact to the new family.

**Impact:** An existing family member could be "stolen" — their contact key now points to the new family, breaking their sign-in.

**Fix:** For each additional member's email and phone, do a `txn.get(db.collection('contactKeys').doc(hash))` before writing, and throw if it exists.

### M3. `register/page.tsx` join link uses query params, not a POST — CSRF consideration

**File:** `apps/portal/src/app/register/page.tsx` (join panel)

The "Join this family" link navigates to `/api/setu/family/join?fid=...&email=...&phone=...`. The API route handler correctly uses POST (and validates the body schema), but if the join action were wired as a GET link, a third-party site could embed that URL and trigger it via `<img src="...">` or `<a href="...">`. The current route.ts correctly requires POST and rejects GETs, but the frontend should confirm this flow uses a `fetch` POST rather than a plain anchor tag.

**Verify:** The join should use `fetch('/api/setu/family/join', { method: 'POST', body: JSON.stringify({fid, contactProof}) })`, not a link navigation. If the current frontend code uses a link tag navigating to the API URL, that will 405.

---

## Low-severity / nits

### L1. `family-join.ts` always creates a NEW member even for returning joiners

Already noted as H1 above. At low traffic this is an inconvenience (duplicate member docs); at higher traffic it's a data corruption risk.

### L2. `lazy-migrate.ts` `location` field hardcoded to `'Brampton'`

**File:** `lazy-migrate.ts:58`

```ts
location: 'Brampton', // default — no location in legacy schema
```

This is defensible given the legacy schema doesn't have location, but the comment says "default" without indicating that a follow-up pass is needed to let the user pick their location after migration. Consider adding a `locationVerified: false` flag to the family doc so welcome-team can surface these for manual cleanup.

### L3. `hash-contact-key.ts` re-implements `normalizeContactForKey` locally

**File:** `apps/portal/src/features/setu/registration/hash-contact-key.ts`

This file imports `normalizeContactForKey` from `@cmt/shared-domain`, which is correct. No issue — just confirming the shared-domain usage is clean.

### L4. `family-lookup.ts` reads contactKeys outside a transaction

**File:** `apps/portal/src/features/setu/registration/family-lookup.ts`

The lookup is read-only (no writes follow from it), so this is intentional and correct. The result is used only to suggest a family to the user — it's not authoritative for registration. No fix needed; noting explicitly that this was reviewed.

### L5. `register/route.ts` returns `{ fid, mid }` but not `redirectTo`

**File:** `apps/portal/src/app/api/setu/register/route.ts`

The frontend defaults to `/family` when `body.redirectTo` is absent, which is correct. The omission is not a bug. But documenting the intended redirect in the API response would make the contract explicit and aid future mobile clients.

---

## Things done well

1. **Transactional duplicate prevention in `registerFamily` is correct.** Both the email and phone `contactKeys` existence checks happen inside `db.runTransaction` with reads before writes — Firestore's optimistic locking guarantees no two concurrent registrations with the same contacts both succeed.

2. **Anti-enumeration in family-lookup.** Rate-limiting is applied BEFORE the lookup result is known and applies to misses as well as hits — no timing or existence leak.

3. **M4 resend fix is clean.** Removing `setPageState('form')` from `handleResend` means the user stays on the OTP screen on resend failure — a materially better UX than the original bounce-to-form.

4. **Frontend debounce pattern is correct.** 400ms debounce with immediate-on-blur covers both the "user is still typing" case and the "user tabbed away" case. The `useRef<ReturnType<typeof setTimeout>>` pattern avoids closure staleness issues.

5. **`useSearchParams()` for email/phone handoff between `/register` and `/register/family`.** Avoids prop-drilling through router state or global store; URLSearchParams is the right primitive for this shallow cross-page handoff.

6. **Field errors surfaced per-field from server.** The `body.fields` pattern in the register route allows the form to highlight exactly which field failed rather than showing a generic banner. Client-side validation as a fast path, server-side as the authority.

7. **`lazyMigrateLegacyFamily` idempotency check is inside the transaction.** The `where('legacyFid', '==', legacyFid).limit(1)` guard prevents double-migration even under concurrent verify-code calls.

8. **`shared-domain` now exports `setu`.** M2 from the Slice 2a review was resolved — `packages/shared-domain/src/index.ts` now re-exports the setu barrel, making `SetuSessionClaimsSchema` available to future mobile consumers.

9. **H2 from Slice 2a review was resolved.** `can-access-route.test.ts` now has comprehensive coverage for `family-manager`, `family-member`, and `welcome-team` roles across the new route patterns.

10. **`verify-code` now calls `lazyMigrateLegacyFamily` for legacy hits.** The Slice 2a follow-up (section "Suggested follow-ups", item 1) is implemented — the verify-code route correctly triggers lazy migration on the first sign-in of a legacy contact.

---

## Suggested follow-ups (not blockers)

1. **Fix H1 (idempotent join).** Before Slice 2c adds member management UI, the join route should be idempotent. A network retry or double-tap on the join button currently creates duplicate member docs.

2. **Fix M2 (additional member contact dedup).** Before any public launch of the registration form, additional member contacts must be checked inside the transaction to prevent contact-key theft.

3. **Add `searchKeys` Firestore index.** Before Slice 2c's welcome-team family search is built, add the `families.searchKeys array-contains` + `location ascending` composite index to `firestore.indexes.json` and deploy to UAT with `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`.

4. **Replace `Math.random()` with `randomBytes` in `generateFid()`.** Low effort, higher correctness. Both occurrences: `register-family.ts` and `lazy-migrate.ts`.

5. **Verify join UI uses a fetch POST, not a link tag.** The API route correctly requires POST; confirm the frontend does not use a plain `<a href="/api/setu/family/join?...">` which would 405.

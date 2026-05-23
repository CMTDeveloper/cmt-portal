# Slice 2d Code Review

**Reviewer:** worker-5 (code-reviewer)
**Date:** 2026-05-23
**Scope:** Slice 2d — Invite flow (POST /api/setu/invite/send, GET /api/setu/invite/[token], POST /api/setu/invite/accept, /invite/[token] page, family/members invite CTA, email template, client wrappers, integration tests)
**Baseline:** `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS (658 tests, 101 suites)

## Verdict
Approve with follow-ups

The implementation is structurally sound and well-organized. Token generation uses `crypto.randomBytes(24)` with base64url encoding. The accept transaction correctly orders all reads before all writes and includes a contactKey theft check. Manager-only enforcement is correctly applied on the send route (role check at line 30), while the accept route correctly requires only authentication (not manager role) since the invitee is becoming a manager. The client-server boundary is clean: `'use client'` components use `-client` fetch wrappers, not server-only functions. One critical issue (missing Firestore collection group index) will cause a runtime crash on both GET and accept. Two high-severity issues warrant attention.

---

## Critical issues

### C1. Missing Firestore collection group index for `invites` — both GET and accept will crash at runtime

**Files:**
- `apps/portal/src/features/setu/invite/get-invite.ts:24-28`
- `apps/portal/src/app/api/setu/invite/accept/route.ts:44-48`
- `firestore.indexes.json` (missing entry)

Both `getInviteByToken()` and the accept route use `db.collectionGroup('invites').where('token', '==', token).limit(1).get()`. This is a collection group query, which requires a Firestore collection group index on the `invites` collection with the `token` field. No such index exists in `firestore.indexes.json`.

Without the index, both queries will fail at runtime with: `"FAILED_PRECONDITION: The query requires an index. You can create it here: ..."`. This blocks the entire invite flow — neither viewing nor accepting an invite will work.

**Impact:** Complete invite flow failure in production and UAT.

**Fix:** Add the collection group index to `firestore.indexes.json`:

```json
{
  "collectionGroup": "invites",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "token", "order": "ASCENDING" }
  ]
}
```

Then deploy indexes. For this slice, deploy to UAT only (`firebase deploy --only firestore:indexes --project chinmaya-setu-uat`). Prod deployment (`--project chinmaya-setu-715b8`) should wait until the invite flow is ready for production — and NEVER pass `--force` against prod (CLAUDE.md rule: prod Firestore is shared with the standalone `chinmaya-family-check-in` app; a forced deploy would delete its indexes).

---

## High-severity issues

### H1. Accept route hardcodes contactKey type as `'email'` — wrong for phone-authenticated invitees

**File:** `apps/portal/src/app/api/setu/invite/accept/route.ts:92,139-144`

```ts
// Line 92:
const emailHash = hashContactKey('email', session.value);
// Lines 139-144:
txn.set(contactKeyRef, {
  contactKey: emailHash,
  type: 'email',
  fid,
  mid: newMid,
});
```

Both the hash computation (line 92) and the contactKey doc write (line 142) hardcode `'email'` as the type, regardless of `session.type`. If the invitee authenticated via phone (OTP to their phone number), the contactKey would be hashed as `hashContactKey('email', '+16471234567')` instead of `hashContactKey('phone', '+16471234567')`, and the doc would be written with `type: 'email'`.

In practice this is currently mitigated by line 76: the invite email is compared against `session.value`, so a phone-authenticated user's phone number would never match the invite email, and the request would be rejected with `email-mismatch`. However, this is an accidental guard, not an intentional one, and will break if phone-based invites are added in a future slice.

**Impact:** Low today (phone invites are implicitly blocked by the email-match check), but the contactKey would be corrupt if the guard were relaxed.

**Fix:** Use `session.type` instead of hardcoding `'email'`:

```ts
const contactHash = hashContactKey(session.type, session.value);
// ...
txn.set(contactKeyRef, {
  contactKey: contactHash,
  type: session.type,
  fid,
  mid: newMid,
});
```

### H2. Send route does not handle `family-not-found` error from transaction — returns 500

**File:** `apps/portal/src/app/api/setu/invite/send/route.ts:55-91`

The transaction throws `new Error('family-not-found')` at line 59 if the family doc doesn't exist, but there's no catch block around the `db.runTransaction()` call. The error propagates to Next.js's global error handler and returns a 500. Compare with the accept route (lines 155-172), which correctly catches and maps specific error messages to HTTP status codes.

**Impact:** If a manager's session references a deleted family (edge case), the send route returns 500 with no useful error message instead of a clear 404.

**Fix:** Wrap the `db.runTransaction()` call in try-catch and map `'family-not-found'` to a 404:

```ts
try {
  await db.runTransaction(async (txn) => { ... });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'family-not-found') {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }
  throw err;
}
```

---

## Medium-severity issues

### M1. Email template interpolates user-controlled strings into HTML without escaping

**File:** `apps/portal/src/lib/aws/templates/setu-invite-email.ts:19`

```ts
<p style="margin: 0"><strong>${inviterName}</strong> has invited you to join the <strong>${familyName}</strong> family on the CMT Setu portal as a <strong>${relation}</strong>.</p>
```

`inviterName`, `familyName`, and `relation` are interpolated directly into the HTML email body without HTML-escaping. While `relation` is validated by `z.string().min(1).max(40)` (no character restriction), a manager could set a relation like `<img src=x onerror=alert(1)>` which would be injected into the email HTML. The `inviterName` and `familyName` come from Firestore docs also written by managers.

Most email clients strip scripts, but some do render injected HTML (images, links). The `acceptUrl` is also unescaped, but it's constructed from a base URL + base64url token, so it's safe by construction.

**Impact:** HTML injection in invite emails. Low severity since email clients are the rendering context (not a browser page), but still a defense-in-depth gap.

**Fix:** Add an `escapeHtml` helper and apply it to all interpolated values in the HTML template:

```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

### M2. Invite token is used as the Firestore document ID — potential length issue

**File:** `apps/portal/src/app/api/setu/invite/send/route.ts:47,79`

```ts
const token = randomBytes(24).toString('base64url'); // 32 chars
const inviteRef = db.collection('families').doc(fid).collection('invites').doc(token);
```

The token (32 base64url characters from 24 random bytes) is used as the Firestore document ID. This is a good design choice — it means lookup by token is a direct document read (O(1)) rather than a query. However, there's an asymmetry: the `getInviteByToken` function and the accept route both use `collectionGroup('invites').where('token', '==', token)` instead of reading the doc directly by its ID (which IS the token).

The collectionGroup query approach works but is more expensive (requires an index, costs more read ops) and is the cause of C1. Since the token IS the document ID, both could simply read `families/{fid}/invites/{token}` directly — but the caller doesn't know the `fid` upfront, which is why the collectionGroup approach is used.

**Impact:** Not a bug, but the redundancy between `token` as doc ID and `token` as a queried field means C1 exists. Noting for context.

### M3. `acceptedByMid` not written in send route — `getInviteByToken` reads it as `undefined`

**File:**
- `apps/portal/src/app/api/setu/invite/send/route.ts:80-90` (writes invite doc without `acceptedByMid`)
- `apps/portal/src/features/setu/invite/get-invite.ts:59`

The send route writes the invite doc with `acceptedAt: null` but does NOT write `acceptedByMid`. The `getInviteByToken` function at line 59 reads `d['acceptedByMid'] as string | null ?? null`, which coalesces `undefined` to `null` correctly. However, the `InviteRecord` type declares `acceptedByMid: string | null`, and the field is absent from the doc rather than explicitly null.

**Impact:** Works correctly due to the `?? null` fallback, but the send route should write `acceptedByMid: null` for consistency with the type and to avoid relying on the `?? null` coercion.

**Fix:** Add `acceptedByMid: null` to the `txn.set()` call in the send route at line 80.

---

## Low-severity / nits

### L1. Integration test asserts `doc.fid === FID` but the send route does not write `fid` to the invite doc

**File:** `apps/portal/src/features/setu/invite/__tests__/integration-send-and-accept.test.ts:289`

```ts
expect(doc.fid).toBe(FID);
```

The `makeInviteDoc()` helper (line 189) adds `fid: FID` to the mock invite doc, but the real send route does not write `fid` as a field — it's derived from the document path (`families/{fid}/invites/{token}`). This test assertion passes because the mock includes the field, but it tests mock behavior, not real behavior.

**Fix:** Remove `fid: FID` from `makeInviteDoc()` and remove the `expect(doc.fid)` assertion, or add a comment that `fid` is a synthetic field for test convenience.

### L2. `getInviteClient` does not URL-encode token when it contains special characters

**File:** `apps/portal/src/features/setu/invite/get-invite-client.ts:11`

```ts
const res = await fetch(`/api/setu/invite/${encodeURIComponent(token)}`, {
```

Actually, `encodeURIComponent` IS used here. This is correct. (No issue.)

### L3. `InviteAcceptClient` component does not show specific error messages for known error codes

**File:** `apps/portal/src/app/invite/[token]/invite-accept-client.tsx:20`

```ts
toast.error(result.error === 'unknown' ? 'Something went wrong. Please try again.' : result.error);
```

When the accept fails with a known error like `'email-mismatch'` or `'contact-already-registered'`, the raw error code is shown to the user as a toast (e.g., "email-mismatch"). These should be mapped to user-friendly messages.

**Fix:** Add a simple error-to-message map:

```ts
const errorMessages: Record<string, string> = {
  'email-mismatch': 'You must sign in with the email address the invite was sent to.',
  'contact-already-registered': 'This email is already registered to another family.',
  'expired': 'This invite has expired. Ask the family manager to send a new one.',
  'already-accepted': 'This invite has already been accepted.',
};
toast.error(errorMessages[result.error] ?? 'Something went wrong. Please try again.');
```

### L4. `canAccessRoute` catch-all gates `/api/setu/invite/accept` behind `isSetuManager` — but the invitee is not yet a manager

**File:** `packages/shared-domain/src/auth/can-access-route.ts:64-68`

```ts
// Setu API — remaining paths (invite, register, etc.): manager + welcome-team + admin
if (pathname.startsWith('/api/setu/')) {
  return isSetuManager(claims) || isWelcomeTeam(claims) || isAdmin(claims);
}
```

The accept route is at `/api/setu/invite/accept`, which falls into this catch-all. An invitee who just signed up via OTP (to accept the invite) will have role `family-member` or even no setu role at all — they won't pass `isSetuManager()`. The accept route does its own auth check via `getCurrentSessionContact()` (which accepts any authenticated user with a role of `family-manager`, `family-member`, or `family`), but middleware would block the request before it reaches the route handler.

This is actually covered by the fact that the accept route uses `getCurrentSessionContact()` which reads from the session cookie directly, and the middleware only runs for pages (not API routes by default in the current setup). But if middleware IS applied to `/api/setu/*` routes, this would be a blocker. Needs verification of how middleware is currently configured.

**Impact:** Depends on middleware scope. If middleware enforces `canAccessRoute` on `/api/setu/invite/accept`, invitees with `family-member` role will get 403 before reaching the accept handler.

### L5. `zeroPad` in accept route only pads to 2 digits

**File:** `apps/portal/src/app/api/setu/invite/accept/route.ts:16-18`

```ts
function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}
```

If a family has 100+ members (unlikely but possible), the mid would be `FAM-100` (no padding needed) but earlier members are `FAM-01` through `FAM-99`. This is consistent with the existing convention from the POST members route, so no action needed — just noting the limit.

---

## Things done well

1. **Token generation is cryptographically secure.** `crypto.randomBytes(24).toString('base64url')` produces 32 characters of cryptographic randomness (192 bits of entropy). No `Math.random()` anywhere in the flow.

2. **TTL is configurable via `SETU_INVITE_TTL_DAYS` env var.** Default 14 days, validated by zod as `z.coerce.number().int().min(1).max(30).default(14)` in `env.ts:53`. `Timestamp.fromDate()` is used correctly (not server-time arithmetic).

3. **Accept transaction discipline is correct.** All reads (invite doc, family doc, members subcollection, contactKey) happen before all writes (member doc, family.managers update, contactKey write, invite acceptedAt update). The invite doc is re-read inside the transaction via `txn.get()` after the initial `collectionGroup` query for consistency.

4. **ContactKey theft prevention is implemented.** The accept route reads `contactKeys/{hash}` inside the transaction (line 94) and throws `contact-conflict` if it belongs to a different family (line 99). This addresses the Slice 2b M2 pattern correctly.

5. **Client-server boundary is clean.** No `'use client'` component imports `next/headers` or `firebase-admin`. The `InviteAcceptClient` component uses `acceptInviteClient()` (a `-client` fetch wrapper), and the `InviteModal` component uses `fetch('/api/setu/invite/send')` directly. The page component (`/invite/[token]/page.tsx`) is a server component that calls `getInviteByToken()` — correct.

6. **GET invite/[token] does not leak sensitive data.** The response only includes `familyName`, `inviterName`, `relation`, and `expiresAt`. It does NOT include `email`, `fid`, `inviterMid`, or `token`. Tests explicitly verify this (route.test.ts:89-92).

7. **Manager-only enforcement on send is correct.** The send route checks `role !== 'family-manager'` at line 30 and returns 403. The accept route correctly does NOT require manager role — it uses `getCurrentSessionContact()` which accepts `family-manager`, `family-member`, or `family` roles.

8. **Email normalization is consistent.** Both the send route (line 44) and the accept route (line 73-74) normalize emails to lowercase with trim.

9. **Error boundary discipline maintained.** `/invite/error.tsx` provides a segment-level error boundary using the shared `ErrorFallback` component.

10. **Feature flag gating is consistent.** All three API routes and the page component check `flags.setuAuth` at the top and return 404 / render prototype when off. Tests verify flag-off behavior for each.

11. **Test coverage is thorough.** 5 test files covering: send route (15 tests), accept route (10 tests), GET invite route (5 tests), client wrappers (7 tests), and integration (13 tests across 9 scenarios including happy path, expired, already-accepted, email mismatch, contactKey conflict, non-manager send denial, tampered token, flag-off, and email normalization).

12. **Invite modal UX is solid.** Proper `aria-modal`, `aria-label`, focus management, disabled state during submission, form reset on success, and network error handling with try-catch.

---

## Suggested follow-ups (not blockers unless noted)

1. **Fix C1 (missing Firestore index) — BLOCKER.** Deploy the `invites` collection group index before the invite flow can work in any environment.

2. **Fix H1 (hardcoded contactKey type).** Use `session.type` instead of `'email'` in the accept route. Low urgency since phone invites are implicitly blocked today, but needed before phone invite support.

3. **Fix H2 (unhandled family-not-found in send).** Add try-catch to the send route's transaction call. Quick fix.

4. **Fix M1 (HTML escaping in email template).** Add `escapeHtml()` for defense-in-depth.

5. **Fix M3 (missing acceptedByMid in send).** Add `acceptedByMid: null` to the invite doc write.

6. **Fix L3 (raw error codes shown to users).** Map error codes to user-friendly messages in `InviteAcceptClient`.

7. **Verify L4 (middleware scope for accept route).** Confirm that middleware does not block `/api/setu/invite/accept` for non-manager users. If it does, add an explicit exception in `canAccessRoute` for the accept path.

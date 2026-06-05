# Multi-Contact Household Dedup — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming) → pending implementation plan
**Origin:** Vaibhav review feedback (2026-06-04): "people have multiple phones and emails — on the 'Let's find your family' screen let them add multiple emails/phone numbers to associate with the found family."

## Goal

Reduce **duplicate family records** by getting more of each household's real-world contacts (emails + phones) on file, so a later lookup with a *different* contact finds the existing family instead of starting a new one. Secondary benefit: a person can be recognized / sign in by any of their contacts.

The user's chosen priority is **dedup coverage** (not sign-in flexibility per se).

## Background — current model

- **`contactKeys/{hash} → { contactKey, type, fid, mid }`** is the source of truth for "which contact resolves to which member/family." `hash = sha256("{type}:{normalizeContactForKey(value)}")` (`hash-contact-key.ts`). The doc stores only the **hash**, not the plaintext contact.
- A member can already own **any number** of contactKeys. `MemberDoc` (`packages/shared-domain/src/setu/schemas/member.ts`) stores a single primary `email` + `phone` (nullable) for display.
- **The lookup already matches on *either* contact.** `lookupFamilyByContacts(email, phone)` (`family-lookup.ts:25`) returns the family if the email hash **or** the phone hash hits. So once a contact is on file, dedup works.
- **Registration already writes a contactKey per member contact.** `registerFamily` (`register-family.ts`) writes contactKeys for the manager (email+phone) and for each additional member that *has* an email/phone, inside one atomic transaction with a **collision check**: if any planned contact already belongs to another family, the whole registration refuses (anti-poisoning), with an error that names the offending contact.

### The smoking gun (why duplicates happen)

On `/register/family` (step 2, "family details"), the UI lets the manager add members but:
- the member rows have **no email/phone inputs**, and
- the submit handler (`src/app/register/family/page.tsx:218`) maps only `{ firstName, lastName, type, gender }` — it **silently drops** email/phone.

So a **spouse added at registration has zero contacts on file.** When the spouse later visits "Let's find your family" and enters *her* email + *her* phone (neither on file), the lookup misses → she creates a duplicate "Matta family." The backend supports member contacts; the registration UI just never captures them.

The register API (`api/setu/register/route.ts`) already accepts `additionalMembers[].email/phone` (optional) and passes them through — so the backend side of Phase A is already done.

## Non-goals

- No rebuild of the contactKey / auth identity model. `uid = sha256Hex(normalizeContactForKey(contact))` stays per-contact; session claims continue to carry `fid/mid/role`.
- Not changing the dedup-refusal semantics (a contact still maps to exactly one family).
- Not building admin/welcome-team contact management (separate surface, out of scope here).
- No international phone support (Canadian-only stays).

## Architecture

### Data model

- **`contactKeys` stays the hashed dedup/lookup index.** New writes gain two fields for audit + security: `source: 'registration' | 'self-verified'` and `verifiedAt: Timestamp | null` (null for manager-asserted registration contacts; set for OTP-verified self-added). Existing docs are untouched and read with safe defaults.
- **`MemberDoc` gains plaintext alternate-contact arrays for display/management:** `altEmails: string[]` and `altPhones: string[]` (both default `[]`). `email`/`phone` remain the **primary** (back-compat; all existing reads unchanged). The plaintext must live here because contactKeys store only hashes — "My contacts" needs the readable values.
  - Invariant: every value in `email`+`altEmails`+`phone`+`altPhones` has a corresponding `contactKey` doc → this member's `mid`. The arrays are the display layer; contactKeys are the resolution layer. Both are written together.
- **Schema updates (don't skip — fields get silently stripped otherwise):** add `altEmails`/`altPhones` (default `[]`) to `MemberDocSchema`, and `source`/`verifiedAt` to the contactKey doc type (`SetuContactKeyDoc` in `find-family-by-contact.ts`) — additive + optional so existing docs parse. `getFamilyByFid`'s manual member mapper also defaults the new arrays.

### Lookup — match across many contacts

Generalize the lookup from one email + one phone to a list:
- `lookupFamilyByContacts(contacts: { type: 'email' | 'phone'; value: string }[]): Promise<FamilySummary | null>` — hash each, read the contactKeys, return the first family hit. Back-compat overload/wrapper keeps the single email+phone call working.
- `POST /api/setu/family-lookup` body becomes `{ emails: string[]; phones: string[] }` (still accepts the legacy `{ email, phone }`). IP rate-limit unchanged (misses still consume quota — anti-enumeration).

## Phase A — capture contacts at registration (the dedup fix)

**Scope:** all members get **optional** Email + Phone fields (adults + children; manager fills what they know; nothing required).

1. `src/app/register/family/page.tsx`: add optional **Email** + **Phone** inputs to each additional-member row (and the draft-member form). Keep the manager's own email/phone from step 1.
2. Fix the submit map (line 218) to include `email`/`phone` for each member (omit when blank, respecting `exactOptionalPropertyTypes`).
3. No backend change needed: `register-family`'s atomic txn already writes a contactKey per member contact + runs the collision check. New contactKey writes set `source: 'registration'`, `verifiedAt: null`.
4. Also populate the new `MemberDoc.altEmails/altPhones` where a member carries more than one (the registration form allows a "+ add another email / phone" per member — optional, YAGNI-bounded to a small cap, e.g. 3 each).

**Effect:** the spouse's email/phone is on file from creation → her later lookup hits → no duplicate. Manager-asserted (no OTP) — identical trust model to today's registration.

## Phase B — find-screen reach + verified add-after-sign-in

### B1 — multi-contact search on the find screen (read-only)

- `src/app/register/page.tsx`: a "+ add another email / phone" affordance under the primary fields. The debounced lookup runs against **all** entered contacts; any hit shows the found family. Purely a wider search — **no writes, no auth** (you're searching, not associating), so no security surface. Catches "my primary isn't on file but my secondary is."

### B2 — "My contacts" (verified add)

A signed-in member can add an email/phone to themselves:
- New surface in family settings (alongside `/family/settings/security`): a **"My contacts"** card/page listing the member's `email/phone` + `altEmails/altPhones`, with an "Add email / phone" action.
- Flow: enter contact → `POST /api/setu/contacts/send-code` (OTP to the *new* contact) → enter code → `POST /api/setu/contacts/verify-code` → on success write `contactKey(source: 'self-verified', verifiedAt: now) → this mid` and append the plaintext to the member's `altEmails/altPhones`.
- **Anti-theft check** (in the verify txn): if the contact's hash already maps to a *different* `mid` (any family), refuse with "already in use — contact admin." Idempotent if it already maps to this member.
- Reuses the existing OTP infra (`send-code`/`verify-code` rate-limit + AWS SES/SNS senders). New routes are added to the `canAccessRoute` allowlist (the `/api/setu/*` catch-all is manager-only by default — both routes must be explicitly opened to any signed-in family role).

### B3 — one-time post-sign-in nudge (covers already-created families)

After a member signs in, show a **dismissible one-time prompt**: "Add the other emails/phones you use so we always recognize you." Links into the B2 add flow. This is the main lever that pulls *existing* families into the wider footprint (their spouse contacts were never captured). Tracked via a per-member flag (e.g. `MemberDoc.contactsNudgeDismissedAt`) so it shows once.

## Security model

- **Phase A:** manager-asserted contacts (no OTP) — unchanged trust; the registration collision check already prevents claiming a contact owned by another family.
- **Phase B:** **OTP per added contact.** Never associate a contact a user hasn't proven they own — that is exactly the account-takeover vector removed when `/api/setu/family/join` was deleted (it accepted an unverified contact). B1 search performs no association, so it needs no proof.
- **One contact ↔ one (fid, mid).** Every write path (registration, add-contact) refuses a contact already owned by a different member, in the same atomic transaction that writes it.
- IP rate-limit on lookup; per-contact OTP rate-limit on add-contact; "That's not me — contact admin" preserved.

## Error handling

- Lookup: invalid/empty contacts ignored; network/429 → existing toast; never reveals *which* contact matched beyond "we found a family."
- Add-contact: invalid OTP → retry; contact-owned-elsewhere → clear "contact admin" message; rate-limited → resetAt surfaced.
- Registration: a member contact owned by another family → the existing named-origin error ("Aarti Patel's email is already registered to another family").

## Testing strategy (TDD, per repo discipline)

- **Phase A:** `register-family` writes a contactKey for each member contact (fixture: a member with 2 emails → 2 contactKeys, `altEmails` length 2 — the **N=2** case); the submit no longer drops contacts (component test); a spouse's phone lookup **hits** after registering the family with her phone.
- **Lookup:** `lookupFamilyByContacts` returns the family when any one of several contacts hits, null when none; legacy single email+phone still works.
- **Phase B:** find-screen searches across multiple entered contacts; `contacts/send-code` + `contacts/verify-code` happy path writes the contactKey + appends the array; theft-check refuses a contact owned by another member/family; the nudge shows once then respects the dismissed flag.
- Firestore index for any new `contactKeys`/member query added; e2e mocks `revalidateTag` per repo convention.

## Sequencing

One spec (this doc) covering A + B. **Implementation Phase A first** — ship the registration dedup fix (highest leverage, no OTP, smallest surface) as its own plan/PR. **Phase B is a clearly-separated follow-up plan** (find-screen multi-search → "My contacts" verified add → post-sign-in nudge). The data-model additions (`source`/`verifiedAt` on contactKeys, `altEmails/altPhones` on MemberDoc) land in Phase A so B builds on a stable shape.

## Out of scope / future

- Admin/welcome-team contact management + a bulk backfill of existing families' missing spouse contacts.
- Merging two families discovered to be duplicates after the fact (a separate "merge families" tool).
- International phone numbers.
- Letting a manager OTP-verify *another* member's contact (the spouse completes their own OTP via B2/B3).

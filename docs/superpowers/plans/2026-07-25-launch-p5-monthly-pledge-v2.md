# P5 v2 - Monthly Pledge (Pre-Authorized Debit)

> # ⛔ FULLY SUPERSEDED 2026-07-26 - IMPLEMENT `2026-07-26-launch-p5-monthly-pledge-v3.md` INSTEAD
>
> **A complete v3 plan now exists and matches the real Stripe contract.** This file is
> kept only as a record of the pre-Stripe design. **Do not implement any task below.**
>
> ---
>
> (original partial-supersession notice follows)
>
> **Vaibhav, 2026-07-26: the portal no longer collects or stores bank details.**
> Monthly PAD is authorised on a **Stripe-hosted page** via CMT's existing Stripe
> service. *"in our setu app, we won't store anything PCI - all done directly in
> Stripe."* The spec has been revised:
> `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`. **Read the
> revision banner there before touching any task below.**
>
> Nothing was lost - **zero pledge code existed** when this landed.
>
> | Task | Fate |
> |---|---|
> | **1** `firestore.rules` deny-all | ✅ **DONE** (Steps 1-3). Steps 4-5 are a **NO-OP** - prod allow rules are additive, so `pledges` was never client-writable. |
> | **2** The crypto module | ❌ **DELETED** - nothing to encrypt |
> | **3** Schemas incl. PAD authorization | ⚠️ **REWRITE** - status-only, no bank fields, `started`/`active`/`cancelled` + `providerRef` |
> | **4** `submitPledge` | ⚠️ **REWRITE** as `startPledge` - forwards to the Stripe proxy, returns a hosted URL |
> | **5** `confirmPledge` / `cancelPledge` | ⚠️ **REWRITE** - activation depends on **O9**; the purge half is deleted |
> | **6** Routes | ⚠️ keep the shape, drop everything secret-related |
> | **7** Three composite indexes | ⚠️ **RE-DERIVE** - fewer queries now |
> | **8** Admin list endpoint | ✅ still wanted, simpler |
> | **8b** The form | ⚠️ **REWRITE** - amount only; **no bank fields at all** |
> | **9** The family card | ✅ still wanted. Path moved to top-level `/donate/success` (P4 Task 8 Step 4); `started` copy must not claim success |
> | **10** The sweep, as a cron | ❌ **DELETED** - nothing to purge. A stale-`started` report is still worth having |
> | **11** Export script + accounting hand-off | ❌ **DELETED** - this was the highest residual risk in the feature |
> | **12** Security tests | ⚠️ **REWRITE** - crypto/purge tests gone; the live risk is now "unverified money counted as real" |
> | **13** Deployed-UAT verification | ✅ still required |
>
> **BLOCKED on O9** - how the portal learns a mandate was really established. Do
> not start Tasks 3-6 until Vaibhav's integration contract lands; the answer
> changes their shape. Tasks will be renumbered in a v3 once it does.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (REVISED 2026-07-26):** A family can pledge a monthly amount and is sent to a **Stripe-hosted** page to authorise the pre-authorized debit. **The portal collects, stores and transmits no bank details whatsoever.** It records status only.

~~*Original goal: a family submits bank details, encrypted at rest, never returned by any route, handed to accounting through one hardened path, destroyed on confirmation.*~~ **Superseded - see the banner below.**

**Architecture (REVISED 2026-07-26):** **One** collection. `pledges/{pid}` holds a status-only record (`started` | `active` | `cancelled`, amount, timestamps, an opaque `providerRef`). The start route forwards a PAD payload to CMT's existing Stripe Cloud Run proxy and returns a hosted URL - the same path the one-time Bala Vihar donation already uses. A deny-all `firestore.rules` (shipped) closes the client-SDK surface.

~~*Original: two collections, `pledge_secrets/{pid}` holding AES-256-GCM ciphertext with no read path, purged by the confirm transaction.*~~ **Deleted.**

**Tech Stack:** Firebase Admin Firestore, Zod, Next.js 16, and the existing Stripe proxy client. **No `node:crypto`, no AES-256-GCM, no Vercel Cron** - all three were deleted with the bank-detail model.

**Supersedes:** `2026-07-25-launch-p5-monthly-pledge.md`, reviewed as REQUEST CHANGES (2 critical, 10 major, 14 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p5.md`.

**Depends on:** P1 v2's `writeAuditLog(txn, db, entry)` and its `can-access-route.ts` edits; P3 v2's `sendManagedEmail`; **P4 v2 Task 8 Step 4 and Task 9** - Task 9's card lives on the donation success page, which P4 moves to a top-level `/donate/success` and whose ordering P4 owns. Ship P5 first and the card renders for nobody in the gated cohort, with no test failing.

---

## Global Constraints

- ~~**The sensitive asset is four bank fields.**~~ **VOID 2026-07-26 - there is no sensitive asset.** The portal never receives a bank field, so every rule that existed to contain them is moot. **The remaining risk is entirely different: unverified money counted as real.** A recurring mandate must never be shown as active on an unverified client claim - see spec §6.2 / O9.
- ~~**`pledge_secrets` has no read path.**~~ **VOID** - the collection does not exist.
- **Pledge routes still get EXPLICIT `canAccessRoute` rules**, outside the welcome-team-granting `/api/setu/*` catch-all. Not because they hold secrets any more, but because a financial write must never inherit its authorization by accident.
- ~~**Never log, never email, never render a bank field.**~~ **Moot, and keep the habit:** Not in an error message, not in a console line, not in a Sentry event. The Sentry side is already enforced in code as of `7902c63` (`apps/portal/src/lib/sentry/scrub-event.ts` pins `httpBodies: []`, `stackFrameVariables: false` and redacts `bank`/`transit`/`institution`/`accountnumber` keys) - that is defense in depth, not permission to relax the first clause.
- **Role checks go in the handler as well as `canAccessRoute`.** Middleware is one gate; every comparable financial route in this repo re-checks (`api/setu/donations/route.ts:19-22`). Use `isAdmin` / `isSetuManager`, never `session.role === 'admin'`.
- **Audit Firestore indexes on every query.** Fake-firestore is index-blind. This plan needs three composite indexes and names them.
- **All Firestore work targets `chinmaya-setu-uat`.** Rules deploys use `firebase deploy --only firestore:rules` - **not** `firestore:indexes`, so the repo's never-`--force`-indexes rule does not apply to them, but confirm the standalone check-in app is Admin-SDK-only before deploying rules to shared prod `715b8`.
- No em dashes. Commit author `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### What shipped already

**Sentry privacy hardening is done** (`7902c63`), closing what the review filed as CRITICAL-1. The review's stated mechanism was wrong - request bodies were never being captured, because `resolveDataCollectionOptions` uses the restrictive branch when `dataCollection` is absent - but the underlying gap (no `beforeSend`, no pinned posture) was real. Do not re-do it; do not relax it.

---


## Task 1: `firestore.rules` deny-all - ships before any pledge code

**This is the only control in the design enforced below the application, and it does not exist.** Verified: there is no `firestore.rules` anywhere in the repo, and `firebase.json` declares only `{"firestore": {"indexes": "firestore.indexes.json"}}`. Meanwhile `getClientFirestore()` is exported and live (`packages/firebase-shared/src/client.ts:42`), the public API key ships in every bundle, and every family holds an authenticated Firebase session.

Spec §8.2 dismisses this as tolerable because the secrets are encrypted. **That reasoning does not survive contact with the asset.** Encryption makes a `pledge_secrets` leak survivable; it does nothing for `pledges`, where open rules would let a family flip their own pledge to `status: 'active'` - precisely the "unverified money counted as real" risk the design claims to have closed.

**Files:** create `firestore.rules`; modify `firebase.json`.

> ## ⛔ A deny-all ruleset must NEVER be deployed to prod `715b8` while the standalone door app lives
>
> An earlier draft of this task shipped a blanket deny-all and instructed a prod deploy after a one-line "confirm the shared-app owner is Admin-SDK-only". **That answer is no, it is checkable from the filesystem in ninety seconds, and the deploy would have taken down the entire door operation on launch Sunday.**
>
> Verified in `/Users/dineshmatta/projects/chinmaya-family-check-in/`:
> - `app/lib/firebase/config.ts:3,26` - `export const db = getFirestore(app)`, the **client** SDK
> - `serviceAccountKey-prod.json:3` - `"project_id": "chinmaya-setu-715b8"`
> - client-SDK access to the exact collections the cutover runbook marks **DO NOT TOUCH** (`production-cutover-checklist.md:52-55`): `family.ts:313` guest check-in write, `:362,370` teacher batch check-in, `:429` family self check-in, `:649` teacher report read, `teacher.ts:64` teacher check-in screen
>
> `firebase deploy --only firestore:rules` **replaces** the project's ruleset. A deny-all there breaks kiosk check-in, family self check-in, the teacher check-in screen, the teacher report and guest check-in - and per CLAUDE.md the legacy `/check-in/*` path is still the production entry point. **Neither repo tracks a rules file**, so there is no rollback artifact: recovery is hand-retyping rules into the console mid-Sunday.
>
> UAT (`chinmaya-setu-uat`) is portal-only and verified safe - `getClientFirestore` / `getClientAuth` / `getClientDatabase` have **zero** call sites in this repo outside their own definitions, and the only `from 'firebase/...'` imports in the monorepo are `packages/firebase-shared/src/client.ts:1-4`.

- [ ] **Step 1: Write the UAT rules - deny-all, correct for a portal-only project**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // chinmaya-setu-uat is portal-only, and the portal reaches Firestore
    // exclusively through the Admin SDK, which bypasses rules. Verified: zero
    // client-SDK call sites in this repo. Deny everything, so a future
    // client-side read fails loudly instead of succeeding silently.
    //
    // NOT SAFE FOR PROD 715b8. That project is shared with the standalone
    // chinmaya-family-check-in app, which reads and writes family-check-ins
    // and guest-families through the CLIENT SDK from 'use client' pages. See
    // Step 4 for the prod path.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Wire it in `firebase.json`**

```json
{ "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" } }
```

- [ ] **Step 3: Deploy to UAT and prove nothing regressed**

```bash
firebase deploy --only firestore:rules --project chinmaya-setu-uat
```

Then run the full E2E. It will pass - nothing reads client-side - but run it, because "nothing reads client-side" is the assumption being tested.

- [ ] **Step 4: Prod - export the deployed ruleset FIRST, then add targeted denies only**

Not a deny-all, and not optional either: the door app works in prod today, which means the deployed ruleset permits authenticated client access to those paths - most likely a blanket `allow read, write: if request.auth != null` or a lingering test-mode `request.time <` clause. Under either, **`pledges` and `pledge_secrets` are client-readable and client-writable in prod on day one**, by any family holding a Firebase session. That is the risk spec §8 claims to have closed.

1. **Export the live ruleset and commit it as the baseline** (`firebase firestore:rules get`, or copy from the console). There is no tracked rules file in either repo; without this there is no rollback artifact and no record of what the door app actually relies on.
2. **Add the two P5 collections as explicit denies on top of that baseline.** Targeted, additive, and it does not touch `family-check-ins` or `guest-families`:
   ```
   match /pledges/{pid}        { allow read, write: if false; }
   match /pledge_secrets/{pid} { allow read, write: if false; }
   ```
3. Deploy to prod only after diffing against the exported baseline, and only with the standalone app's owner confirming the door surface is unchanged. Writing rules **tighter** than the door app's real access pattern is the same outage in a different shape.

- [ ] **Step 5: Gate the prod flag flip on this**

Task 6's `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` must not go true in production until Step 4 lands - not merely until the O4 key backup is confirmed. Until then, `pledges` is client-writable and a family could set their own `status: 'active'`.

- [ ] **Step 6: Runbook §14, and commit**

---

## Task 2: The crypto module

> ### ❌ DELETED 2026-07-26 - DO NOT IMPLEMENT
> **Nothing is encrypted any more.** No `pledge_secrets`, no `PLEDGE_ENCRYPTION_KEY`, no AES-256-GCM, no key rotation or custody. This entire task is void.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**Files:** create `apps/portal/src/features/setu/pledge/crypto.ts` + tests.

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips', () => { /* ... */ });
it('rejects a tampered ciphertext', () => { /* authTag catches it */ });
it('rejects the wrong key', () => { /* ... */ });

it('binds the ciphertext to its pid (AAD)', () => {
  // Without AAD, anyone with Firestore write access moves pledge_secrets/A's
  // payload to pledge_secrets/B and it decrypts cleanly - family B's pledge
  // now carries family A's account number. GCM gives this for free.
  const blob = encryptBankDetails('pid-A', details);
  expect(() => decryptBankDetails('pid-B', blob)).toThrow();
});

it('decrypts a v1 payload after KEY_VERSION becomes 2', () => {
  // Spec 4.3 says keyVersion exists "so a future key rotation can decrypt old
  // records". That is only true if decrypt actually READS it.
});

it('rejects a payload that decrypts but has the wrong shape', () => {
  // GCM guarantees the bytes are authentic, not that they are BankDetails.
  // An unvalidated JSON.parse produces a CSV row with `undefined` in the
  // account column, discovered by accounting, not by us.
});
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

**No `??` fallback on the version lookup - it loses money silently, in two directions.** Bump `KEY_VERSION` to 2 without setting `_V2` and new blobs are stamped `keyVersion: 2` while encrypted with the v1 key; set `_V2` later and every one is permanently undecryptable. Or rotate by replacing `PLEDGE_ENCRYPTION_KEY` - the only variable spec §4.3 and the runbook name - and every existing `keyVersion: 1` blob loses its key. For a `pending` pledge the decrypted export is the **only** path to accounting, so that is the family's money until they resubmit.

```ts
const KEYS: Record<number, string | undefined> = {
  1: process.env.PLEDGE_ENCRYPTION_KEY_V1 ?? process.env.PLEDGE_ENCRYPTION_KEY, // legacy alias, v1 only
  2: process.env.PLEDGE_ENCRYPTION_KEY_V2,
};

function key(version = KEY_VERSION): Buffer {
  const raw = KEYS[version];
  if (!raw) throw new Error(`pledge key v${version} not configured`);
  // length-checked, read per call, never re-exported
}

export function encryptBankDetails(pid: string, details: BankDetails): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(pid, 'utf8'));
  // ... setAuthTag read AFTER final()
}

export function decryptBankDetails(pid: string, blob: EncryptedBlob): BankDetails {
  const decipher = createDecipheriv('aes-256-gcm', key(blob.keyVersion), Buffer.from(blob.iv, 'base64'));
  decipher.setAAD(Buffer.from(pid, 'utf8'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  return BankDetailsSchema.parse(JSON.parse(/* ... */));   // validated, not cast
}
```

Never put `details` in a thrown error message. The function that holds it should be as small as possible.

- [ ] **Step 4: Run and commit**

---

## Task 3: Schemas, including the PAD authorization

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> **No bank fields.** Status-only: `started` | `active` | `cancelled`, plus `monthlyAmount`, timestamps and an opaque `providerRef`. Every PAD-authorization/bank-detail field in this task is void.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**A Canadian pre-authorized debit requires a payor's PAD agreement (Payments Canada Rule H1), and the payor must be able to prove what they agreed to.** v1 collected four bank fields and an amount and stored no agreement, no version, no acceptance timestamp. If a family disputes a debit there is nothing to show, and accounting's processor will very likely ask for it before the first PAD is set up.

The repo already has the right pattern: `app_config/disclaimers` stores versioned content and records acceptance against that version.

**The agreement lives in the non-sensitive `pledges` doc**, so it survives the purge - which is the point. The authorization must outlive the bank details.

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Define `BankDetailsSchema`**

```ts
institutionNumber: z.string().regex(/^\d{3}$/),
transitNumber:     z.string().regex(/^\d{5}$/),
accountNumber:     z.string().regex(/^\d{7,12}$/),   // capped: an uncapped /^\d+$/ lets a
                                                     // client send a megabyte that encrypts
                                                     // fine and then blows the 1MB doc limit
```

**Drop `bankNumber`.** In Canada it is the same three-digit value as the institution number; there is no separate "bank number". Collecting it invites a family to type something else, gives accounting a fourth field to reconcile, and violates data minimization for no benefit. Three fields is the complete set. (Resolves spec open item O7.)

- [ ] **Step 4: Define `SubmitPledgeSchema`, `.strict()`**

`.strict()` so a body-supplied `fid`, `status` or `pid` is a **400**, not silently dropped. Amount is `z.number().int().min(cfg.minMonthlyAmount).max(10_000)` - a bare `z.number()` accepts `Infinity` and non-integers.

- [ ] **Step 5: Add the PAD fields to `PledgeDoc`**

```ts
padAgreementVersion: number;   // from app_config/pledge.padAgreementVersion
padAgreementAcceptedAt: Date;
padAgreementText: string;      // snapshot of exactly what was shown, so a later
                               // config edit cannot rewrite history
```

- [ ] **Step 6: Run and commit**

---

## Task 4: `submitPledge`, with a duplicate guard

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> Becomes **`startPledge`**: validate the amount, write `status:'started'`, forward a PAD payload to CMT's existing Stripe proxy, return the hosted URL. Nothing sensitive is posted or stored. The duplicate guard is still wanted.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**Nothing in v1 rejected a second submission while a pending one existed.** A double-clicked button, a retry on a flaky connection, or a family that "tries again" because verification is manual and slow each mints a new `pledges/{pid}` **and a new `pledge_secrets/{pid}` holding real bank data**. The admin confirms one; the rest sit for 90 days.

- [ ] **Step 1: Write the failing tests** - including the N=2 case: a second submit while pending → **409**, and exactly one live secret.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

```ts
// Inside the transaction, read first.
const existing = await txn.get(
  db.collection('pledges').where('fid', '==', fid).where('status', '==', 'pending').limit(1),
);
if (!existing.empty) throw new Error('pledge-already-pending');   // → 409
```

`pid` is `db.collection('pledges').doc().id`. **Never derive it from a count** - the repo has a data-loss incident from exactly that (`nextMemberMid`, 2026-07-19: count+1 collided on a numbering gap and `txn.set` silently overwrote a real member).

`fid` comes from the **session**, never the body. Reject `padAgreementVersion` mismatches against the current config server-side.

Client-side, disable the submit button on first click - necessary, not sufficient.

- [ ] **Step 4: Run and commit**

---

## Task 5: `confirmPledge` / `cancelPledge`, fail-closed on a purged secret

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> **The purge half is void** - there is no secret to purge, so 'fail-closed on a purged secret' is meaningless. How a pledge becomes `active` is now **spec open item O9** and BLOCKED on Vaibhav's integration contract. The one rule that survives: the client may never write `active`.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


- [ ] **Step 1: Write the failing tests**

```ts
it('confirm flips status, deletes the secret and writes the audit row atomically', async () => { /* ... */ });
it('is idempotent, and does NOT re-send the activation email', async () => {
  // Return { alreadyActive: true } on the no-op path. v1 returned
  // {fid, monthlyAmount, email} unconditionally and the route sent on that.
});
it('REFUSES to confirm a pledge whose secret was swept', async () => {
  // Without this the confirm succeeds on an absent doc (txn.delete is a no-op),
  // the family gets "your monthly gift is active", and no PAD was ever set up
  // because the details were destroyed 60 days earlier.
  await expect(confirmPledge(pid)).rejects.toThrow('pledge-secret-purged');  // → 409
});
```

- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

**`txn.get(pledgeRef)` before writing.** Without that read, Firestore has nothing to detect contention on and concurrent confirms do not serialize.

**Guard the status, not just the sweep flag.** `secretPurgedAt` is written by the Task 10 sweep only. The **cancel** path deletes the secret too, so: admin cancels pledge X, then confirms it - from a stale tab, a re-run of the copy-pasted `pid` from Task 8's list, or two staff on the same queue. `txn.delete` on the absent secret is a no-op, `secretPurgedAt` is unset, status flips to `active`, the audit row looks clean, and the family is told their monthly gift is active for a PAD that can never exist. Same end state MAJOR-5 was written to close, re-entered through the cancel door.

```ts
if (data.status === 'cancelled') throw new Error('pledge-cancelled');       // → 409
if (data.status === 'active')    return { alreadyActive: true };
if (data.secretPurgedAt)         throw new Error('pledge-secret-purged');   // → 409
```

And make `cancelPledge` set `secretPurgedAt` as well, so the invariant is "no secret ⇒ `secretPurgedAt` is set", enforced in one place. Add the confirm-after-cancel case to Step 1.

Use P1's `writeAuditLog(txn, db, entry)` so the status flip, the secret delete and the audit row commit together or not at all.

- [ ] **Step 4: Run and commit**

---

## Task 6: Routes - handler checks, feature flag, kill switch

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> Keep the shape - explicit `canAccessRoute` rules outside the welcome-team-granting `/api/setu/*` catch-all, in-handler role checks, flag + kill switch. Drop everything secret-related. Route names change with Task 4.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


- [ ] **Step 1: Add `flags.setuPledge`, default OFF**

```ts
setuPledge: process.env.NEXT_PUBLIC_FEATURE_SETU_PLEDGE === 'true',
```

Literal `process.env` access per the file's own warning, and add the var to `turbo.json`'s build `env` array. **The most sensitive feature in the system had no flag.** Discipline 5 is non-negotiable, and every comparable feature has one. Ship with it off; flip it after the O4 key backup is confirmed.

- [ ] **Step 2: Wire `app_config/pledge.enabled`** - the admin-editable kill switch spec §4.4 designed and no v1 task read. Two different levers: the env flag is deploy-level, `enabled` is same-day.

```ts
if (!flags.setuPledge) return NextResponse.json({ error: 'not-found' }, { status: 404 });
const cfg = await getPledgeConfig();
if (!cfg.enabled) return NextResponse.json({ error: 'pledges-closed' }, { status: 403 });
```

- [ ] **Step 3: Write the failing route tests**, then implement with **handler-level role checks**:

```ts
// POST /api/pledges
if (!session || !isSetuManager(session) || !session.fid) return 401;
// POST /api/admin/pledges/[pid]/confirm
if (!session || !isAdmin(session)) return 403;
```

Middleware is one gate. Without the second, a single edit to `can-access-route.ts` silently opens a financial endpoint - and the plan's own security test cannot pass, because vitest calls the handler directly and middleware never runs.

- [ ] **Step 4: `canAccessRoute` clauses.** `/api/pledges` above the `/api/setu/` catch-all; `/api/admin/pledges/*` lands on the admin-only `:75` rule with none of the welcome-team exceptions matching.
- [ ] **Step 5: Send the activation email - and handle the two ways it silently never arrives**

P3 v2's signature requires a `fallback`, and **P5 has nothing to put there**: spec §7 says no email copy is hardcoded for this feature, so unlike every other managed name there is no in-code renderer to fall back to. Write `fallback: async () => {}` and P3's "not configured" branch logs at **info** - so if the SES template or its `SES_TEMPLATE_*` var is missing at launch (spec O5 and O8 are both still open, so that is the likely state), **every activation email silently does not send.**

```ts
await sendManagedEmail({
  name: 'pledge-activated',
  to: email,
  data: { familyName, monthlyAmount },
  // No in-code template exists for this email by design (spec 7). Alarm rather
  // than no-op: silent non-delivery of the most important transactional email
  // in the feature is not an acceptable default.
  fallback: async () => { throw new Error('pledge-activated has no SES template configured'); },
});
```

**And catch it.** P3 pins that non-template failures propagate, so an uncaught throw makes confirm return 500. The admin retries, hits Task 5's idempotent path, gets `{ alreadyActive: true }`, and the send is **deliberately skipped** - the email is now unsendable through the product, on a pledge whose bank details are already destroyed. Spec §7.3 requires the opposite: "a failed email must be logged and surfaced, never allowed to undo that."

Wrap the send, return `200 { ok: true, emailSent: false }` on failure, and add `activationEmailSentAt` to `PledgeDoc` so the idempotent path can re-attempt a send it has not yet made. Pin the variable-name contract with a test (spec §7.2 / O5).

Send **outside** the confirm transaction so a template problem cannot roll back an activated pledge.
- [ ] **Step 6: Run and commit**

---

## Task 7: The three composite indexes

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> **RE-DERIVE from the new queries.** The old set was sized for a two-collection model with a purge sweep; `pledge_secrets` and the sweep are both gone, so at least one of the three has no query left to serve. Do not deploy these as written.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


v1 did not mention `firestore.indexes.json` once. Three query shapes need entries, and fake-firestore will pass without them - this is the `/family/seva` 500 pattern exactly.

| Query | Index |
|---|---|
| the family card: `where('fid').orderBy('submittedAt','desc')` | `pledges (fid ASC, submittedAt DESC)` |
| the sweep: `where('status').where('submittedAt','<',cutoff)` | `pledges (status ASC, submittedAt ASC)` |
| the duplicate guard (Task 4): `where('fid').where('status')` | `pledges (fid ASC, status ASC)` |

The first is the same shape as `getDonations`, which documents its index at `get-donations.ts:22-23` with the entry at `firestore.indexes.json:73-80`. Follow that.

- [ ] **Step 1: Add all three entries**
- [ ] **Step 2: Deploy to UAT only** - `--project chinmaya-setu-uat`, never `--force`, never prod
- [ ] **Step 3: Runbook §5 entry, then commit**

---

## Task 8: The admin list endpoint

> ### ✅ STILL WANTED, but read the revision first
> Simpler now - there is nothing sensitive to withhold, so this is an ordinary list. Status values change (`started`, not `pending`).
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**Without it the confirm workflow forces staff into the Firestore console**, one click from `pledge_secrets`, in a console whose audit trail is Google's rather than the app's. The design's entire premise is that no human browses this data; a workflow that supplies no other way to obtain a `pid` guarantees they will, every time.

- [ ] **Step 1: Write the failing tests** - admin-only; returns `PledgeDoc` fields only; never touches `pledge_secrets`.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement** `GET /api/admin/pledges?status=pending` → `[{ pid, fid, familyName, monthlyAmount, submittedAt }]`. About thirty lines, reads only the non-sensitive collection.
- [ ] **Step 4: Run and commit**

---

## Task 8b: The form the family actually types into, and the config behind it

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> **Amount only. No bank fields at all** - no bank number, transit, institution or account input is ever rendered or posted. The `app_config/pledge` half of this task is unchanged.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**Walk the earlier draft task by task and a family can never submit a pledge.** Task 3 was schemas, Task 4 the server function, Task 6 the routes, Task 9 the *card*, Task 11 the export. Spec §6.1 steps 1-2 - "Family opens the pledge form... enters bank number, transit number, institution number, account number" - had **no task**, and the self-review claimed coverage and stopped.

This is the most sensitive input surface in the system, so leaving it unspecified is not a scheduling gap.

- [ ] **Step 1: Input hardening - a checklist, not a preference**

**Browser autofill is a fifth copy of the account number**, outside the encryption, the purge, the rules and the export - synced to the user's browser account. That directly contradicts this plan's own Global Constraint: *when a step trades convenience for one fewer place they can appear, take the trade.*

- `autoComplete="off"` on the form **and** on every bank field (browsers ignore form-level alone)
- `inputMode="numeric"`, `autoCorrect="off"`, `spellCheck={false}`
- never persist to `localStorage` / `sessionStorage` / any form-state devtool
- never put a value in the URL or a query param
- clear the fields on successful submit
- decide `type="password"` vs `type="text"` deliberately and record why

- [ ] **Step 2: Render the PAD agreement and collect the acknowledgement**

Task 3 Step 5 stores `padAgreementVersion` / `padAgreementText` and Task 4 rejects version mismatches server-side - but nothing rendered the agreement or collected consent. Payments Canada Rule H1, which is this plan's own justification for the fields, requires the payor **see and accept** it. Required checkbox, text from `app_config/pledge`, snapshot stored with the pledge.

- [ ] **Step 3: Define `app_config/pledge` - three tasks read it and none defined it**

Task 6 Step 2 reads `cfg.enabled`, Task 3 Step 4 reads `cfg.minMonthlyAmount`, Task 3 Step 5 reads `padAgreementVersion` / `padAgreementText`. Spec §4.4's shape has only `{enabled, minMonthlyAmount, suggestedAmounts}` - no PAD fields - and no task wrote the schema, the default constant or the editor.

Follow the disclaimers pattern: a `PledgeConfigSchema`, a `DEFAULT_PLEDGE_CONFIG` constant (`packages/shared-domain/src/setu/disclaimers.ts:10` is the precedent), and an `/admin/pledge` editor - the no-external-CMS rule means admin-editable copy needs a portal screen.

- [ ] **Step 4: `error.tsx` for the new route segment** (CLAUDE.md discipline 3).
- [ ] **Step 5: Run and commit**

---

## Task 9: The family card

> ### ✅ STILL WANTED, but read the revision first
> Still wanted. Two changes: the success page moved to a top-level **`/donate/success`** (P4 v2 Task 8 Step 4), and the `started` copy **must not claim success** if activation is unverified - see spec §5.1 and O9.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


Spec §5.1's state-driven treatment, on the donation success page **below** the adult-class ask (P4 v2 Task 9 owns the ordering) and on the dashboard.

**`cancelled` returns the card to the ask; `pending` does not.** Combined with Task 5's purge-sets-`cancelled`, a family whose secret was swept gets the ask back rather than sitting on "we're setting up your monthly gift" forever.

- [ ] **Step 1: Write the failing tests**, including N=2: a family with two pledge rows renders the newest, not the first.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**, gated on `flags.setuPledge`
- [ ] **Step 4: Run and commit**

---

## Task 10: The sweep, as a cron

> ### ❌ DELETED 2026-07-26 - DO NOT IMPLEMENT
> **Nothing to purge.** A stale-`started` report is still worth having, but as an operational signal that the hosted flow is failing, not as a data-protection control. Do not build this cron as written.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


v1 made it a manual CLI script run twice-remembered (script + `--commit`), forever. **That is the same human-forgetfulness failure the sweep exists to catch.**

- [ ] **Step 1: Write the failing tests** - deletes secrets older than the window; sets `status: 'cancelled'`, `cancelReason: 'stale-secret-purged'`, `secretPurgedAt`; leaves `active` pledges alone.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement as a Vercel Cron route - all THREE pieces, in one commit**

A cron route needs three things and an earlier draft named one. `public-routes.ts:78-89` is explicit: *"EVERY path declared as a cron in vercel.ts MUST be listed here - a scheduled job whose route is missing here silently 401s."* `canAccessRoute` has no `/api/cron/` clause, so an unlisted cron path hits the default-deny at `:315` and middleware denies at `middleware.ts:97-99` before the handler runs - Vercel sends `Authorization: Bearer ${CRON_SECRET}`, which `verifyPortalIdToken` cannot decode.

**The purge would then never fire, silently, with a green `vercel.ts` entry as evidence that it does - and real bank account numbers would be retained indefinitely.** That is precisely the human-forgetfulness failure this task exists to remove.

And the opposite mistake is worse. `public-routes.ts:91-95`: *"Adding a route here without a self-authenticating handler would expose an unauthenticated endpoint with no enforcement."* An unauthenticated purge route mass-deletes `pledge_secrets` and flips pledges to `cancelled`.

1. Add `'/api/cron/purge-stale-pledge-secrets'` to `PUBLIC_ROUTES`.
2. Copy the timing-safe Bearer check **verbatim** from `app/api/cron/send-prasad-reminders/route.ts:5,17`.
3. Add the `{ path, schedule }` entry to `vercel.ts:4-11`.

Test that the route 401s without the Bearer. Keep a CLI entry point for manual runs, but the cron is the primary.
- [ ] **Step 4: Purge visibly**

```ts
txn.delete(db.collection('pledge_secrets').doc(pid));
txn.update(db.collection('pledges').doc(pid), {
  status: 'cancelled',
  cancelledAt: FieldValue.serverTimestamp(),
  cancelReason: 'stale-secret-purged',
  secretPurgedAt: FieldValue.serverTimestamp(),
});
```

Setting `cancelled` returns the card to the ask, which is the correct family-facing outcome and costs nothing.

- [ ] **Step 5: Build the 14-day stale report** v1 deferred. Without it, "someone will notice" is the control.
- [ ] **Step 6: Run and commit**

---

## Task 11: The export script and the accounting hand-off

> ### ❌ DELETED 2026-07-26 - DO NOT IMPLEMENT
> **Void.** There are no bank details to export, decrypt, transmit or destroy. This task carried what the plan called the highest residual risk in the feature; it no longer exists.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**This is where the data actually leaves, and v1 left it undefined.** Spec §8's proudest row is "Nothing sensitive is ever emailed" - true of the portal, and false of the last mile if the operator then emails the CSV.

- [ ] **Step 1: Harden the file handling**

```ts
// Refuse to write anywhere but an explicit absolute path outside the repo.
// .gitignore has no pattern that would catch a decrypted export, so a default
// ./pledges.csv is one `git add -A` from a shared repo.
if (!path.isAbsolute(out) || out.startsWith(repoRoot)) {
  throw new Error('[pledges] --out must be an absolute path outside the repository');
}
writeFileSync(out, csv, { mode: 0o600 });   // default 0644 is world-readable
// Never print a row. Print only: `wrote N rows to <path>`.
```

Reuse `apps/portal/src/lib/csv.ts`'s `csvCell` so the export inherits the repo's formula-injection neutralization rather than hand-rolling a second encoder. Add `*.pledge-export.csv` and `/pledge-export*` to `.gitignore`.

**Guard the target database, and keep the key out of every file.** The script decrypts, so it needs the **production** key and must read **production** Firestore - against the repo's standing UAT-only directive. Two consequences the file-handling rules do not cover:

- **Target guard, mirroring `migrate-legacy-families.ts`:** refuse to run unless `PORTAL_FIREBASE_PROJECT_ID` is the prod project **and** `--allow-prod` is passed. Without it, an operator with a UAT-pointed `.env.local` gets an empty CSV and concludes there is nothing to hand over.
- **The key never touches a dotfile.** Every other CLI script here runs via a pnpm alias with `tsx --env-file=.env.local`, so the path of least resistance is writing the prod key into a laptop dotfile. Instead: read it from the password manager into the process env **for that one invocation**, prefix the command with a space so zsh skips history, and unset it after. Say this in the runbook, not just here.

Print the `pid` alongside each row so confirm is a copy-paste, never a console browse.

Dry-run by default. (Note: this is the **right** choice but **not** the existing convention - `migrate-legacy-families.ts:31` defaults `dryRun: false`. Do not claim otherwise in the commit; a reviewer checking will find the opposite.)

- [ ] **Step 2: Write O6's answer into the runbook BEFORE launch**

Named recipient. A channel with at-rest encryption and a retention limit - a password-protected archive handed over in person, or the bank's own secure portal. **Not email, not Slack, not Drive.** `shred` / `rm -P` on the local copy immediately after, in the same documented step.

This is the highest-residual-risk part of the feature and it currently has no owner and no words.

- [ ] **Step 3: Run and commit**

---

## Task 12: The security tests that actually test something

> ### ⚠️ REWRITE REQUIRED 2026-07-26 - DO NOT IMPLEMENT AS WRITTEN
> The crypto round-trip, purge and no-read-path tests are void with the data they protected. **The live risk is now 'unverified money counted as real'** - test that the client cannot write `active`, and that `started` counts as payment nowhere. See spec §10.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


**Two of v1's three headline tests were no-ops.**

- [ ] **Step 1: Two tests that can actually fail - not a route sweep**

v1's test called a `GET_ANY_PLEDGE_ROUTE` helper for a route the plan never builds, so it asserted that a 404 body contains no bank fields: green forever. An earlier draft of v2 replaced it with a `globby` sweep over every route module. **That is the same vacuousness at 135x the cost:** `globby` is not a dependency (spec §9 says no new ones), there are 135 route files of which 28 have dynamic segments that a generic probe cannot invoke, and the overwhelming majority return 400/404/500 to a blind call - a body that 500s trivially contains no bank field. It also cannot catch the regression it exists for, since it will never have the params, roles and fixtures to reach the leaking code path.

**(a) A static assertion over the source tree.** This is the property Global Constraints claims, so pin it directly:

```ts
// Every mention of pledge_secrets in src/ must live in the two places allowed
// to touch it. A new reader fails this loudly.
const hits = grepRepo('pledge_secrets', 'apps/portal/src');
expect(hits.every((f) => f.startsWith('apps/portal/src/features/setu/pledge/'))).toBe(true);
```

Plus a rule that `pledge_secrets` docs never carry a `date` or `classId` field - see below.

**(b) The targeted fixture-driven assertions** spec §10.2 names: `getCurrentFamily`, `GET /api/setu/family`, `GET /api/setu/dashboard`, `GET /api/welcome/families`, the roster CSV, the reports CSVs - each seeded with a family holding a pending pledge.

**Correct the safety argument while you are here.** An earlier draft said "every `collectionGroup()` in the repo targets only `donations`/`enrollments`/`invites`/`members`". That is wrong twice: `joinRequests` is a fifth literal (`features/setu/join-request/{get-by-token,approve-request,decline-request}.ts`), and **two call sites take the collection-group name from a variable, one straight off the query string** - `api/check-in/teacher/report/route.ts:14,23` does `collectionGroup(url.searchParams.get('classId'))`, and `api/check-in/teacher/uninformed/route.ts:21` does `collectionGroup(c.classId)`.

A collection-group query matches **top-level** collections with that id too, so the isolation argument in spec §4.2 rule 3 does not hold against one. Not exploitable today - the route is teacher-gated and the query adds `.where('classId','==',...).orderBy('date','desc')`, which no `pledge_secrets` doc can satisfy - but the stated reason for safety was false, and the safety is one added field away from evaporating. Add an AST or regex check that no `collectionGroup` argument is a non-literal. `listCollections()` genuinely is never called.

- [ ] **Step 2: Fix the cross-family test, which asserted the wrong thing**

v1 set the *session* fid to `CMT-OTHER` and asserted the write used `CMT-OTHER` - which would pass on an implementation that reads fid from the body.

```ts
const res = await POST_SUBMIT(
  { ...VALID, fid: 'CMT-OTHER' },            // body attempts another family
  { ...MANAGER, 'x-portal-fid': 'CMT-A' },   // session says CMT-A
);
expect(res.status).toBe(400);                 // .strict() rejects the extra key
```

- [ ] **Step 3: Match the status code to the layer.** Middleware denies with **401** (`middleware.ts:165`); only the Task 6 handler check produces **403**. Pick the layer the test exercises and assert that code.
- [ ] **Step 4: Run and commit**

---

## Task 13: Verify against deployed UAT

> ### ✅ STILL WANTED, but read the revision first
> Still required, against the new flow. Needs a Stripe **test mode** for PAD (spec O9) so UAT never moves real money.
> Portal no longer collects or stores bank details; PAD is authorised on a Stripe-hosted page. See the spec's revision banner: `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md`.


- [ ] **Step 1: Set a SEPARATE UAT encryption key.** `PLEDGE_ENCRYPTION_KEY` is spec'd Production-only (§4.3), so submit throws on `cmt-setu.vercel.app` without one. **Never reuse the prod key** - UAT data has looser handling. Use `vercel env add --value` (stdin is silently ignored for agents) and verify with `vercel env pull`.
- [ ] **Step 2: Add both collections to both cleanup sweeps.** `src/__tests__/e2e/helpers/firestore.ts`'s `cleanupTestData()` and `scripts/wipe-uat-leaks.ts` know nothing about `pledges` / `pledge_secrets`, so the E2E would leave real-shaped secrets in UAT indefinitely. Mark E2E docs `_test: true`.
- [ ] **Step 3: Walk the flow** - submit, admin list, confirm, the activation email, the card states, the duplicate 409, and the purged-secret 409.
- [ ] **Step 4: Assert spec §10.7 - a pending pledge counts as payment nowhere.** Seed one, then assert the payment chip, `/welcome/roster` status, enrollment confirmation and the enrollment report are **byte-identical** to the no-pledge baseline. True by construction today; v1 claimed it and tested nothing.
- [ ] **Step 5: Confirm `MOBILE_CORS_ORIGINS` is unset in Production.** `middleware.ts:25-37` applies `access-control-allow-credentials: true` to every `/api/*` path including `/api/pledges`; a stale `http://localhost:8081` left in prod would let a page on that origin submit bank details with the family's cookies. Add it to the runbook launch checks.
- [ ] **Step 6: Runbook** - the new collections (§3), three indexes (§5), the cron, the export script (§10), `NEXT_PUBLIC_FEATURE_SETU_PLEDGE`, `PLEDGE_ENCRYPTION_KEY`, the O4 key-backup confirmation, and a dated §14 entry.
- [ ] **Step 7: Commit**

---

## Self-review

> ⚠️ **STALE 2026-07-26.** This section maps the plan to the PRE-revision spec - it
> credits crypto, AAD, key rotation, the purge and the export script, none of which
> will be built. It is retained only as a record of what the plan once claimed to
> cover. **Do not use it as a coverage checklist.** The current coverage list is
> spec §10.

**Spec coverage.** §4.3 crypto → Task 2, with rotation and AAD now real rather than asserted. §4.4 kill switch → Task 6 Step 2. §5.1 card states → Task 9. §8 threat model → Tasks 1, 11, 12, with the database and hand-off surfaces it omitted now covered. §10.1-10.7 verification → Tasks 12 and 13, including §10.7 which v1 claimed and did not test. O6 hand-off → Task 11 Step 2. O7 field list → Task 3 Step 3 (`bankNumber` dropped).

**Every review finding addressed:** CRITICAL-1 → already shipped (`7902c63`). CRITICAL-2 → Task 1. MAJOR-1 → Task 6 Step 3. MAJOR-2 → Task 7. MAJOR-3 → Task 6 Steps 1-2. MAJOR-4 → Task 10 Step 3. MAJOR-5 → Tasks 5 and 10 Step 4. MAJOR-6 → Task 4. MAJOR-7 → Task 12. MAJOR-8 → Task 8. MAJOR-9 → Task 11. MAJOR-10 → Task 3 Step 5. Minors 1-14 → Tasks 2 (1, 2, 4), 3 (5, 6, 7, 8), 4 (9), 5 (11), 13 (3, 10, 12, 13), 11 (14a).

## Review history

Reviewed once after the first draft (`docs/superpowers/reviews/2026-07-25-review-p5v2.md`): 2 critical, 9 major, 10 minor. **The first critical is the worst error in this whole rebuild series.**

1. **Task 1 would have taken the live door app down on launch Sunday.** The draft shipped a blanket deny-all ruleset and instructed a prod deploy after a one-line "confirm the shared-app owner is Admin-SDK-only", written as a formality. The answer is **no**, and it was checkable from the filesystem in ninety seconds: `/Users/dineshmatta/projects/chinmaya-family-check-in/app/lib/firebase/config.ts:26` is `getFirestore(app)` - the **client** SDK - against `chinmaya-setu-715b8`, reading and writing `family-check-ins` and `guest-families` from `'use client'` pages. A rules deploy **replaces** the ruleset, so the blast radius was kiosk check-in, family self check-in, the teacher check-in screen, the teacher report and guest check-in - on the path CLAUDE.md calls the current production entry point, with no tracked rules file anywhere to roll back to. The claim was also written *into the rules file itself*, where the next reader would trust it. Now: deny-all for UAT only, and prod gets an exported baseline plus two targeted denies.
2. **Which leaves `pledges` client-writable in prod**, since the door app's client access proves the deployed ruleset permits it. The flag flip is now blocked on the baseline export, not just the key backup.
3. **No task built the form the family types their account number into.** Spec §6.1 steps 1-2 had no owner while the self-review claimed coverage. Added as Task 8b with input hardening (browser autofill is a fifth copy of the account number, outside every control this design has), the PAD agreement render, and `app_config/pledge` - which three tasks read and none defined.
4. **The cron would silently never fire.** `public-routes.ts:78-89` says every cron path must be listed there or it 401s; the draft named only `vercel.ts`. The purge that exists because humans forget would itself have been forgotten, with a green config entry as evidence it worked. Both halves now specified, including the self-authenticating Bearer check - adding the route without it would expose an unauthenticated endpoint that mass-deletes secrets.

Also corrected: the `??` key fallback that makes rotation destroy the only copy of the bank details, in two directions; confirm-after-**cancel** reaching `active` with the secret already gone (MAJOR-5's end state through a different door); an activation email with a required `fallback` P5 has nothing to fill and no error handling, so it silently never sends and then becomes unsendable; a `globby` route sweep that is not a dependency and would have been vacuous at 135 files; a **false** "every collectionGroup targets only four literals" claim (there is a fifth, and two call sites take the name from a **variable**, one off the query string); and an export script with no target guard and no instruction to keep the prod key out of `.env.local`.

**Known risk.** Task 11 Step 2 is still the only step whose output is prose rather than code, and it guards the highest residual risk in the feature: if the accounting hand-off ships as "TBD", the encryption, the purge and the rules are all bypassed by someone attaching a CSV to an email. It needs a named owner and a channel before the flag flips, not after.

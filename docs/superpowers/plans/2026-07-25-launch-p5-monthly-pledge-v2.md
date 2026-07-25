# P5 v2 - Monthly Pledge (Pre-Authorized Debit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family can pledge a monthly amount and submit bank details for a pre-authorized debit. The details are encrypted at rest, never returned by any route, never rendered in any UI, handed to accounting through one hardened path, and destroyed the moment the pledge is confirmed.

**Architecture:** Two collections. `pledges/{pid}` holds the non-sensitive record and the PAD authorization, and survives forever. `pledge_secrets/{pid}` holds only the AES-256-GCM ciphertext, has **no read path in the application**, and is deleted by the same transaction that confirms the pledge. A deny-all `firestore.rules` closes the database surface that the application-level design cannot reach.

**Tech Stack:** `node:crypto` AES-256-GCM, Firebase Admin Firestore, Zod, Next.js 16, Vercel Cron.

**Supersedes:** `2026-07-25-launch-p5-monthly-pledge.md`, reviewed as REQUEST CHANGES (2 critical, 10 major, 14 minor). Review: `docs/superpowers/reviews/2026-07-25-review-p5.md`.

**Depends on:** P1 v2's `writeAuditLog(txn, db, entry)` and its `can-access-route.ts` edits; P3 v2's `sendManagedEmail`.

---

## Global Constraints

- **The sensitive asset is four bank fields.** Every rule below exists because of them. When a step trades convenience for one fewer place they can appear, take the trade.
- **`pledge_secrets` has no read path in the application.** No route, no `collectionGroup()`, no `listCollections()`. Exactly two things read it: `confirmPledge` (to delete) and the export script. Task 12 pins this by enumeration, not assertion.
- **Never log, never email, never render a bank field.** Not in an error message, not in a console line, not in a Sentry event. The Sentry side is already enforced in code as of `7902c63` (`apps/portal/src/lib/sentry/scrub-event.ts` pins `httpBodies: []`, `stackFrameVariables: false` and redacts `bank`/`transit`/`institution`/`accountnumber` keys) - that is defense in depth, not permission to relax the first clause.
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

- [ ] **Step 1: Write the rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // The portal reaches Firestore exclusively through the Admin SDK, which
    // bypasses rules entirely. Nothing legitimate uses the client SDK for data,
    // so deny everything: a future client-side read then fails loudly instead
    // of succeeding silently.
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

- [ ] **Step 4: Check prod for test mode**

A two-minute console check, not a code change: is prod in `allow read, write: if request.time < ...`? That is the failure case that turns this from theoretical to live. Record the answer in the runbook either way.

- [ ] **Step 5: Confirm the shared-app owner**, then deploy to prod `715b8`. Runbook §14 entry.
- [ ] **Step 6: Commit**

---

## Task 2: The crypto module

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

```ts
function key(version = KEY_VERSION): Buffer {
  const raw = process.env[`PLEDGE_ENCRYPTION_KEY_V${version}`] ?? process.env.PLEDGE_ENCRYPTION_KEY;
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

**`txn.get(pledgeRef)` before writing.** Without that read, Firestore has nothing to detect contention on and concurrent confirms do not serialize. v1 never said so.

```ts
if (data.secretPurgedAt) throw new Error('pledge-secret-purged');
```

Use P1's `writeAuditLog(txn, db, entry)` so the status flip, the secret delete and the audit row commit together or not at all.

- [ ] **Step 4: Run and commit**

---

## Task 6: Routes - handler checks, feature flag, kill switch

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
- [ ] **Step 5: Send the activation email** via P3's `sendManagedEmail` with `name: 'pledge-activated'`, **outside** the confirm transaction so a template problem cannot roll back an activated pledge. Skip on the `alreadyActive` path.
- [ ] **Step 6: Run and commit**

---

## Task 7: The three composite indexes

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

**Without it the confirm workflow forces staff into the Firestore console**, one click from `pledge_secrets`, in a console whose audit trail is Google's rather than the app's. The design's entire premise is that no human browses this data; a workflow that supplies no other way to obtain a `pid` guarantees they will, every time.

- [ ] **Step 1: Write the failing tests** - admin-only; returns `PledgeDoc` fields only; never touches `pledge_secrets`.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement** `GET /api/admin/pledges?status=pending` → `[{ pid, fid, familyName, monthlyAmount, submittedAt }]`. About thirty lines, reads only the non-sensitive collection.
- [ ] **Step 4: Run and commit**

---

## Task 9: The family card

Spec §5.1's state-driven treatment, on the donation success page **below** the adult-class ask (P4 v2 Task 9 owns the ordering) and on the dashboard.

**`cancelled` returns the card to the ask; `pending` does not.** Combined with Task 5's purge-sets-`cancelled`, a family whose secret was swept gets the ask back rather than sitting on "we're setting up your monthly gift" forever.

- [ ] **Step 1: Write the failing tests**, including N=2: a family with two pledge rows renders the newest, not the first.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**, gated on `flags.setuPledge`
- [ ] **Step 4: Run and commit**

---

## Task 10: The sweep, as a cron

v1 made it a manual CLI script run twice-remembered (script + `--commit`), forever. **That is the same human-forgetfulness failure the sweep exists to catch.**

- [ ] **Step 1: Write the failing tests** - deletes secrets older than the window; sets `status: 'cancelled'`, `cancelReason: 'stale-secret-purged'`, `secretPurgedAt`; leaves `active` pledges alone.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement as a Vercel Cron route**, declared in `vercel.ts` beside the existing daily crons. Keep a CLI entry point for manual runs, but the cron is the primary.
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

Print the `pid` alongside each row so confirm is a copy-paste, never a console browse.

Dry-run by default. (Note: this is the **right** choice but **not** the existing convention - `migrate-legacy-families.ts:31` defaults `dryRun: false`. Do not claim otherwise in the commit; a reviewer checking will find the opposite.)

- [ ] **Step 2: Write O6's answer into the runbook BEFORE launch**

Named recipient. A channel with at-rest encryption and a retention limit - a password-protected archive handed over in person, or the bank's own secure portal. **Not email, not Slack, not Drive.** `shred` / `rm -P` on the local copy immediately after, in the same documented step.

This is the highest-residual-risk part of the feature and it currently has no owner and no words.

- [ ] **Step 3: Run and commit**

---

## Task 12: The security tests that actually test something

**Two of v1's three headline tests were no-ops.**

- [ ] **Step 1: Make the "no route returns bank details" test enumerate the real surface**

v1 called `GET_ANY_PLEDGE_ROUTE(pid, role)` - but the plan builds **no GET route at all**, so the test asserted that a 404 body contains no bank fields. It passes forever, including after someone adds a leaky route. Spec §10.2 calls this "the most important one here".

```ts
// Enumerate every route module under src/app/api at test time, hit each with
// each role, and assert no response body ever contains a bank field name or
// the seeded account number. A NEW route is then covered automatically.
const routes = await globby('src/app/api/**/route.ts');
```

Plus targeted assertions on the family read paths spec §10.2 names - `getCurrentFamily`, `GET /api/setu/family`, `GET /api/setu/dashboard`, `GET /api/welcome/families`, the roster CSV, the reports CSVs - seeded with a family that has a pending pledge. These are safe by construction today (`pledge_secrets` is top-level; every `collectionGroup()` in the repo targets only `donations`/`enrollments`/`invites`/`members`; `listCollections()` is never called) - but that is a property to **pin**, not assume. It is one careless `collectionGroup('pledge_secrets')` from being false.

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

- [ ] **Step 1: Set a SEPARATE UAT encryption key.** `PLEDGE_ENCRYPTION_KEY` is spec'd Production-only (§4.3), so submit throws on `cmt-setu.vercel.app` without one. **Never reuse the prod key** - UAT data has looser handling. Use `vercel env add --value` (stdin is silently ignored for agents) and verify with `vercel env pull`.
- [ ] **Step 2: Add both collections to both cleanup sweeps.** `src/__tests__/e2e/helpers/firestore.ts`'s `cleanupTestData()` and `scripts/wipe-uat-leaks.ts` know nothing about `pledges` / `pledge_secrets`, so the E2E would leave real-shaped secrets in UAT indefinitely. Mark E2E docs `_test: true`.
- [ ] **Step 3: Walk the flow** - submit, admin list, confirm, the activation email, the card states, the duplicate 409, and the purged-secret 409.
- [ ] **Step 4: Assert spec §10.7 - a pending pledge counts as payment nowhere.** Seed one, then assert the payment chip, `/welcome/roster` status, enrollment confirmation and the enrollment report are **byte-identical** to the no-pledge baseline. True by construction today; v1 claimed it and tested nothing.
- [ ] **Step 5: Confirm `MOBILE_CORS_ORIGINS` is unset in Production.** `middleware.ts:25-37` applies `access-control-allow-credentials: true` to every `/api/*` path including `/api/pledges`; a stale `http://localhost:8081` left in prod would let a page on that origin submit bank details with the family's cookies. Add it to the runbook launch checks.
- [ ] **Step 6: Runbook** - the new collections (§3), three indexes (§5), the cron, the export script (§10), `NEXT_PUBLIC_FEATURE_SETU_PLEDGE`, `PLEDGE_ENCRYPTION_KEY`, the O4 key-backup confirmation, and a dated §14 entry.
- [ ] **Step 7: Commit**

---

## Self-review

**Spec coverage.** §4.3 crypto → Task 2, with rotation and AAD now real rather than asserted. §4.4 kill switch → Task 6 Step 2. §5.1 card states → Task 9. §8 threat model → Tasks 1, 11, 12, with the database and hand-off surfaces it omitted now covered. §10.1-10.7 verification → Tasks 12 and 13, including §10.7 which v1 claimed and did not test. O6 hand-off → Task 11 Step 2. O7 field list → Task 3 Step 3 (`bankNumber` dropped).

**Every review finding addressed:** CRITICAL-1 → already shipped (`7902c63`). CRITICAL-2 → Task 1. MAJOR-1 → Task 6 Step 3. MAJOR-2 → Task 7. MAJOR-3 → Task 6 Steps 1-2. MAJOR-4 → Task 10 Step 3. MAJOR-5 → Tasks 5 and 10 Step 4. MAJOR-6 → Task 4. MAJOR-7 → Task 12. MAJOR-8 → Task 8. MAJOR-9 → Task 11. MAJOR-10 → Task 3 Step 5. Minors 1-14 → Tasks 2 (1, 2, 4), 3 (5, 6, 7, 8), 4 (9), 5 (11), 13 (3, 10, 12, 13), 11 (14a).

**Known risk.** Task 11 Step 2 is the only step whose output is a paragraph of prose rather than code, and it is the step guarding the highest residual risk in the feature. If it ships as "TBD", the encryption, the purge and the deny-all rules are all bypassed by someone attaching a CSV to an email. It needs a named owner before launch, not after.

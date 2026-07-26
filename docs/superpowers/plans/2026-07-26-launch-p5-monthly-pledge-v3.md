# P5 v3 - Monthly Pledge (Stripe-hosted PAD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family opts into a **fixed $51/month** pre-authorized debit, authorised entirely on a **Stripe-hosted page**. The portal stores status only, never a bank detail.

**Architecture:** One collection, `pledges/{pid}`, holding status and opaque provider handles. Four calls to CMT's existing Stripe Cloud Run service (the same one the one-time donation already uses), plus a Vercel Cron reconciler that finishes what the browser could not.

**Tech Stack:** Firebase Admin Firestore, Zod, Next.js 16, Vercel Cron, the existing Stripe proxy client. **No crypto, no key management, no bank fields.**

**Supersedes:** `2026-07-25-launch-p5-monthly-pledge-v2.md` (and its v1). Both are marked DO-NOT-IMPLEMENT. **Spec:** `docs/superpowers/specs/2026-07-25-monthly-pledge-pad-design.md` - read §0 (the integration contract) before anything else.

---

## Global Constraints

- **The portal never sees a bank detail, a card number, or a mandate.** No field, no log, no Sentry event, no email. If a step tempts you to accept one, the step is wrong.
- **SHIP DARK.** `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` defaults **off** and stays off at launch, because `/pad/*` is TEST-mode only. Every task must be safe to merge with the flag off.
- **A pledge gates NOTHING.** It must never affect enrollment, the payment chip, roster status, reports, or the Bala Vihar donation.
- **The client may never write `active`.** Only a server path that has consulted Stripe may.
- **Pledge routes live OUTSIDE `/api/setu/*`** with explicit `canAccessRoute` rules. That catch-all grants welcome-team by default, and a financial write must never inherit authorization by accident.
- **`$51` and the `priceId` change together, in env.** Never split them across env and admin config: an admin editing a displayed amount while the Price still charges $51 would make the portal lie about a recurring debit.
- All Firestore work targets `chinmaya-setu-uat`. No em dashes. Commit author `CMT Developer <developer@chinmayatoronto.org>`. Never `--no-verify`.

### The contract, in one table (spec §0)

| # | Call | Portal does |
|---|---|---|
| 1 | `POST {BASE}/pad/setup-link` | `{customerEmail, customerName, client_reference_id, branding_settings, successUrl, cancelUrl, metadata}` → `{checkoutUrl, sessionId, customerId}` |
| 2 | redirect | browser → Stripe-hosted mandate page |
| 3 | `POST {BASE}/checkout-session-result` | `{sessionId}` → `success` \| `failed` \| `pending` |
| 4 | `POST {BASE}/pad/monthly-subscription` | `{setupSessionId, priceId, idempotencyKey}` → `{subscriptionId, status, customerId, paymentMethodId}` |
| 5 | `POST {BASE}/subscription-result` | `{subscriptionId}` → `success` \| `failed` \| `pending` |

**Settled facts:** `$51/month`; TEST Price **`price_1TxTuwRNUSAfwnFqdXBP8Opi`**; step 4 is **safe to retry** with the same `setupSessionId`; delayed outcomes are reconciled by **cron**, not a webhook; cancellation is **manual by the temple in Stripe** - the portal has no cancel endpoint.

### The two failure modes that drive this design

1. **The orphan mandate.** Step 4 is a *second server call*. If the browser dies between 3 and 4, the mandate exists at Stripe and **no subscription is ever created** - no money moves and the family believes they are giving monthly. Task 6's cron is the only thing that catches this. It is not optional.
2. **Silently wrong amount.** The charge amount lives at Stripe, not here. A wrong `priceId` bills a different amount than the portal displays, monthly, undetectably. Hence O13's verify-before-flip.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/shared-domain/src/setu/schemas/pledge.ts` | `PledgeDocSchema`, status union | 1 |
| `apps/portal/src/lib/flags.ts`, `turbo.json` | `flags.setuPledge`, default off | 1 |
| `apps/portal/src/lib/env.ts` | `STRIPE_API_BASE_URL`, `STRIPE_PLEDGE_PRICE_ID`, `PLEDGE_MONTHLY_AMOUNT_CAD` | 2 |
| `apps/portal/src/features/setu/pledges/stripe-pad-client.ts` | the four calls, one place | 2 |
| `apps/portal/src/features/setu/pledges/start-pledge.ts` | write `started` + get the hosted URL | 3 |
| `apps/portal/src/app/api/pledges/start/route.ts` | family-manager only | 3 |
| `apps/portal/src/app/api/pledges/finalize/route.ts` | steps 3→4→5 after redirect | 4 |
| `apps/portal/src/features/setu/pledges/reconcile-pledges.ts` | the cron's engine (pure-ish, testable) | 6 |
| `apps/portal/src/app/api/cron/reconcile-pledges/route.ts` + `vercel.ts` | schedule | 6 |
| `apps/portal/src/app/api/admin/pledges/[pid]/cancel/route.ts` | bookkeeping-only cancel + `audit_log` | 7 |
| `apps/portal/src/features/family/components/pledge-card.tsx` | the ask + the four states | 5 |
| `apps/portal/src/app/donate/success/page.tsx` | the ask, BELOW the adult-class ask | 5 |

---

## Task 1: Schema, status vocabulary, and the flag

- [ ] **Step 1: Write the failing tests** - `PledgeDocSchema` parses a `started` doc with null handles; rejects an unknown status; `providerRef` fields are nullable+optional.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement**

```ts
export const PLEDGE_STATUSES = ['started', 'active', 'cancelled', 'failed'] as const;

export const PledgeDocSchema = z.object({
  pid: z.string().min(1),
  fid: z.string().min(1),
  monthlyAmountCAD: z.number().int().positive(),   // 51 - snapshotted at start
  status: z.enum(PLEDGE_STATUSES),
  startedAt: z.date(),
  activatedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  startedByMid: z.string().min(1),
  // Opaque Stripe handles. NOT secrets, NOT shown to families - reconciliation only.
  setupSessionId: z.string().nullable().optional(),
  subscriptionId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  lastCheckedAt: z.date().nullable().optional(),
  lastError: z.string().nullable().optional(),
});
```

> **`started`, not `pending`.** It means "we redirected them and do not yet know what happened" - a materially weaker claim, and `pending` overstates it. **Bare `.optional()`, never `.default()`** on the handle fields (doc schemas validate on read).
>
> `monthlyAmountCAD` is **snapshotted at start**, so a later price change never rewrites what an existing pledge says it is.

- [ ] **Step 4: `flags.setuPledge`** in `lib/flags.ts` (literal `process.env.NEXT_PUBLIC_FEATURE_SETU_PLEDGE === 'true'` - helper indirection defeats static inlining) and add it to `turbo.json`'s `env` array or Vercel builds will not see it.
- [ ] **Step 5: Run and commit**

---

## Task 2: The Stripe PAD client - all four calls in one module

- [ ] **Step 1: Write the failing tests** - each call posts to the right path with `x-api-key`; a non-2xx throws a typed error; a missing base URL / price id **fails closed** rather than calling anything.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Env**

`STRIPE_API_BASE_URL` (the Cloud Run host; the existing `STRIPE_CHECKOUT_URL` is that base + `/checkout-link` and stays as-is for the one-time flow), `STRIPE_PLEDGE_PRICE_ID`, `PLEDGE_MONTHLY_AMOUNT_CAD`. All **optional in the schema** so local dev and the flag-off state still boot; the client fails closed at call time.

- [ ] **Step 4: Implement `stripe-pad-client.ts`** with `createPadSetupLink`, `getCheckoutSessionResult`, `createMonthlySubscription`, `getSubscriptionResult`.

> **Every call goes through this module.** A direct `fetch` elsewhere bypasses the fail-closed check and the shared error mapping - the same reason `sendManagedEmail` must go through `resolveSender()`.
>
> **`idempotencyKey` is derived deterministically from the pledge**, e.g. `` `${pid}-${priceId}` ``, so a retry from the cron reuses it rather than minting a new one. Vaibhav confirmed retry is safe; a random key per attempt would throw that away.

- [ ] **Step 5: Run and commit**

---

## Task 3: Start a pledge

- [ ] **Step 1: Write the failing tests** - manager-only; writes `status:'started'` with the snapshotted amount; returns the hosted URL; a second start while one is already `started` or `active` does **not** create a duplicate; nothing sensitive is in the request or the doc.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `startPledge(fid, mid)`** - write the doc, call step 1, store `setupSessionId` + `customerId`, return `checkoutUrl`.
- [ ] **Step 4: `POST /api/pledges/start`** - outside `/api/setu/*`; in-handler `isSetuManager`; `fid` from the **session**, never the body; 404 when `flags.setuPledge` is off.
- [ ] **Step 5: `canAccessRoute` rule** for `/api/pledges/*` - family-manager only. Add it explicitly; do not rely on any prefix.
- [ ] **Step 6: Run and commit**

---

## Task 4: Finalize after the redirect (steps 3 → 4 → 5)

- [ ] **Step 1: Write the failing tests**
  - step 3 `success` → calls step 4 → stores `subscriptionId` → step 5 `success` → `active` + `activatedAt`
  - step 3 `pending` → **stays `started`**, writes `lastCheckedAt`, returns a processing state. **No loop.**
  - step 3 `failed` → `failed`
  - step 5 `pending` → stays `started` with a `subscriptionId` (the cron finishes it)
  - **the client cannot force `active`**: POSTing a fabricated body as a family-manager never activates
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `POST /api/pledges/finalize`** - `{pid}` from the body, `fid` from the session, ownership checked.

> **One pass only** (Vaibhav: do not poll). Step 3 once; if `success`, step 4; then step 5 once for the UI. Anything unresolved is the cron's job, not a retry loop here.

- [ ] **Step 4: Send the activation email on the `started → active` transition ONLY**, via the existing `sendManagedEmail` + the already-registered `pledge-activated` template. **Outside** any transaction: a mail failure must never undo an activation. Idempotent - never re-send for a pledge already `active`.
- [ ] **Step 5: Run and commit**

---

## Task 5: The family surfaces

- [ ] **Step 1: Write the failing tests** - one per state, and the honesty assertions below.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: The card**

| State | Copy |
|---|---|
| none | The ask: "Support the mission with $51 a month" |
| `started` | **Must NOT claim success.** "We're setting up your monthly gift. This can take a few days to confirm." |
| `active` | "You're giving $51 monthly since [date]. Thank you." |
| `failed` / `cancelled` | Back to the ask, with a neutral line |

- [ ] **Step 4: Place it on `/donate/success`, BELOW the adult-class ask**, and on the family dashboard.

> ⚠️ **Depends on P4 v2 Task 8 Step 4**, which moves the success page from `/family/donate/success` to a top-level **`/donate/success`**. Ship this first and the card renders for nobody in the gated cohort, with no test failing. And P4 Task 9 owns the ordering: **adult-class first, pledge second and quieter** - reversing them leads with a money ask straight after a ~$500 payment.

- [ ] **Step 5: Run and commit**

---

## Task 6: The reconciler - the task that makes this correct

**Without this, a family whose browser died between steps 3 and 4 has a live mandate at Stripe, no subscription, and no money moving - permanently, and invisibly.**

- [ ] **Step 1: Write the failing tests**
  - mandate confirmed, no `subscriptionId` → **retries step 4** with the SAME `setupSessionId` and the SAME derived `idempotencyKey`
  - has `subscriptionId`, not active → calls step 5; `success` → `active` + email
  - already `active` → **untouched, and no second email**
  - `cancelled` / `failed` → untouched
  - a Stripe error → records `lastError`, leaves status alone, does not throw the whole run
  - **N=2**: a batch with one orphan and one pending is processed independently; one failure does not abort the other
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `reconcilePledges()`** over pledges in `started`.
- [ ] **Step 4: `GET /api/cron/reconcile-pledges`** + a `vercel.ts` entry. Daily is enough - PAD settles in days, not minutes. Guard it the way the existing crons are.
- [ ] **Step 5: A stale report** - anything `started` beyond ~14 days, surfaced for a human. Not a data-protection control (nothing sensitive is stored); it is the signal that the hosted flow is failing.
- [ ] **Step 6: Run and commit**

---

## Task 7: Admin cancel - bookkeeping ONLY

- [ ] **Step 1: Write the failing tests** - admin-only; sets `cancelled`; writes an `audit_log` row in the same transaction; **does not** call Stripe.
- [ ] **Step 2: Run to verify they fail**
- [ ] **Step 3: Implement `POST /api/admin/pledges/[pid]/cancel`.**

> 🔴 **The temple cancels the actual debit MANUALLY in Stripe** (Vaibhav 2026-07-26). There is no cancel endpoint on the payment service and the portal cannot stop a debit.
>
> **The screen must say so in as many words** - *"This only updates the record. Cancel the actual debit in Stripe."* Left implicit, staff will click it, believe the money stopped, and the family keeps being charged. Assert that copy in the test.

- [ ] **Step 4: Run and commit**

---

## Task 8: Verify against deployed UAT (TEST mode), and the runbook

- [ ] **Step 1: Seed** a family with the flag on in UAT only.
- [ ] **Step 2: E2E** - start → hosted page → return → finalize → assert `started`; run the reconciler; assert the transition. Use Stripe **test** banking details.
- [ ] **Step 3: ⚠️ Verify in the Stripe TEST dashboard that `price_1TxTuwRNUSAfwnFqdXBP8Opi` really is $51.** The portal cannot detect a wrong price - the amount lives at Stripe.
- [ ] **Step 4: Assert nothing sensitive is stored** - dump the pledge doc and confirm no bank-ish field exists.
- [ ] **Step 5: Assert a pledge gates nothing** - payment chip, roster, enrollment confirmation and reports are all unchanged by an `active` pledge.
- [ ] **Step 6: `MOBILE_API_CHANGELOG.md`** - `/api/pledges/*` is family-facing, so the mobile mirrors it.
- [ ] **Step 7: Runbook** - §3 the `pledges` collection, §9 the three env vars, §10 the cron, §8 the flag (**stays OFF**), and a dated §14 entry.
- [ ] **Step 8: Commit**

---

## Before the flag is ever flipped ON

**This is not a no-op.** The first family through after the flip is the first REAL mandate.

1. A **LIVE** Stripe Price exists, and **you have opened the Stripe dashboard and confirmed it is $51.**
2. `STRIPE_PLEDGE_PRICE_ID` points at the LIVE id, not the test one.
3. `/pad/*` is confirmed live on the payment service.
4. The reconciler cron is running and has been observed completing once.
5. Someone owns watching the first few real pledges through to `active`.

## Self-review

**Spec coverage.** §0 contract → Tasks 2, 3, 4. §4.1 status-only record → Task 1. §5 placement → Task 5. §6.1 start → Task 3. §6.2 activation → Tasks 4, 6. §6.3 cancel-is-bookkeeping → Task 7. §7 activation email → Task 4 Step 4 (mechanism already shipped in P3). §9 ship-dark → Global Constraints + Task 1 Step 4. §10 verification → Task 8.

**Type consistency.** `PledgeDocSchema` (Task 1) is written by Task 3, transitioned by Tasks 4/6/7, read by Task 5. The four client functions (Task 2) are the only Stripe surface.

**Known risk.** Task 6 is the one that turns a demo into something correct, and it is the easiest to skip because the happy path works without it. Do not ship Tasks 3-5 without it.

# Monthly Pledge (Pre-Authorized Debit) - Design

> **Status:** REVISED 2026-07-26 - see the banner below. Draft for review.
> **Author:** CMT Developer (with AI agent)
> **Date:** 2026-07-25, substantially revised 2026-07-26
> **Target:** Monday 2026-08-03 (decoupled - see §9)
> **Sibling specs:** `2026-07-24-aug-3-launch-batch-design.md` (launch batch), `2026-07-25-adult-study-class-design.md`

---

## ⚠️ REVISION 2026-07-26 - the portal no longer touches bank details at all

**Vaibhav, 2026-07-26:**
> *"For pledge, let's NOT collect bank details."* … *"I am updating stripe endpoints to now accept one-time credit card (current) and adding monthly PAD."* … *"so in our setu app, we won't store anything PCI - all done directly in Stripe."*

This lands **before any pledge code was written** (verified: zero pledge implementation in the repo on 2026-07-26), so it costs a spec revision and nothing else.

**What it deletes outright:**

| Deleted | Was |
|---|---|
| `pledge_secrets` collection | encrypted bank details at rest |
| `PLEDGE_ENCRYPTION_KEY` + AES-256-GCM module | §4.3, and the key-custody blocker O4 |
| The accounting hand-off | O6 - *"the highest residual risk in the feature"* |
| Bank-field shape validation | O7 |
| The 90-day purge sweep + stale-pledge report | §6.4 - nothing sensitive is stored, so nothing can outlive its purpose |
| Extraction script / decrypted-file transmission | the whole manual pipeline |

**What replaces it:** the family is sent to a **Stripe-hosted** page to authorise the PAD, exactly as the one-time Bala Vihar donation already works. The portal stores **status only**.

**The central design question changes with it.** The old §8.1 argued that a manually-processed PAD *"can never be made provider-authoritative the way Stripe can"*, and settled for "the client can never move a pledge out of `pending`." With Stripe in the loop that constraint is lifted **if** the payment service can tell us a mandate was really established. That is now the single most important open item (O9) - see §6.2 and §11.

**Terminology note:** the disclaimers already use "Pledge" for the *Chinmaya Mission Pledge*, a values statement (`disclaimers.ts:18`, links to `chinmayatoronto.org/cmpledge`). Families will meet two unrelated things called "pledge" on the same site. The family-facing label for **this** feature needs a deliberate decision (O10).

---

---

## 0. The Stripe integration contract (received 2026-07-26)

Source: *Stripe Integration Doc* (Vaibhav). **Verified: it describes the SAME service
the portal already uses** - our existing `/api/setu/donations/checkout` call matches
`/checkout-link` field for field (`lineItems`, `customerEmail`, `client_reference_id`,
`successUrl`, `cancelUrl`, `metadata` → `{ checkoutUrl, sessionId }`).

### The PAD flow is FOUR steps, not two

| # | Call | Notes |
|---|---|---|
| 1 | `POST /pad/setup-link` | `{customerEmail, customerName, client_reference_id, branding_settings, successUrl, cancelUrl, metadata}` → `{checkoutUrl, sessionId, customerId}`. **Takes no amount** - the mandate is not amount-bound. |
| 2 | redirect | Stripe-hosted page collects bank details + mandate acceptance. |
| 3 | `POST /checkout-session-result` | `{sessionId}` → `success` \| `failed` \| `pending`. |
| 4 | `POST /pad/monthly-subscription` | `{setupSessionId, priceId, idempotencyKey?}` → `{subscriptionId, status, customerId, paymentMethodId}`. |
| 5 | `POST /subscription-result` | `{subscriptionId}` → `success` \| `failed` \| `pending`. UI status only. |

> ⚠️ **Step 4 is a SECOND server call, and it is where a pledge can be orphaned.**
> If the family completes the mandate but the portal never reaches step 4 - browser
> closed, network blip, deploy mid-flow - **the mandate exists at Stripe and no
> subscription is ever created.** No money moves, and the family believes they have
> set up monthly giving. A reconciliation job that retries step 4 for any pledge
> stuck after step 3 is **required**, not optional. `idempotencyKey` exists to make
> that retry safe (**confirm** - open item O12).

### Decisions from Vaibhav, 2026-07-26

| # | Answer | Consequence for this spec |
|---|---|---|
| Amount | **Fixed `$51/month` for now** ("let's put in the variable $51") | **Supersedes the family-chosen amount.** No minimum, no suggested tiers, no amount picker. `/pad/monthly-subscription` requires a fixed Stripe `priceId`, and one amount means one Price. §4.3's `minMonthlyAmount`/`suggestedAmounts` are void for v1. |
| Polling | **Do not poll.** Call each result endpoint once, driven by the previous response | Sequence is: step 3 once → if `success`, step 4 → step 5 once for UI. No loops. |
| Cancellation | **Handled manually by the temple/ashram** | The portal gets NO cancel endpoint. An admin "cancel" in the portal is **bookkeeping only** - it must not imply the debit stopped. Copy has to say so, or staff will believe clicking it stopped the money. |
| Environment | **`/pad/*` is available in TEST ONLY for now** | 🔴 **PAD cannot go live on Aug 3 unless it is promoted to live mode.** See §9. |

### ⚠️ STILL UNRESOLVED - how the portal learns a DELAYED outcome

The doc states PAD outcomes are commonly delayed and says to *"render a processing
UI and update state from webhook-backed data"*, with webhooks going to
**`POST /webhooks/stripe` on Vaibhav's service** - not to the portal.

"Do not poll" answers the *sequencing* question but not this one. After the redirect,
step 3 will frequently return `pending`, and there is currently **no described channel
from that service back to the portal**. Without one, a pledge that genuinely succeeded
days later stays `started` in our database forever. **Open item O9, still the blocker.**


## 1. What this is - and what it is NOT

A **monthly pledge** is a voluntary, recurring gift supporting Chinmaya Mission Toronto, collected by **pre-authorized debit (PAD)**. As of the 2026-07-26 revision it is **set up by the family on a Stripe-hosted page**; CMT's payment service handles the mandate and the portal never sees bank details.

> **It is NOT the Bala Vihar donation.** The ~$500 yearly Bala Vihar donation, paid via Stripe, gates enrollment and is unchanged by this spec. A pledge is *extra* support on top of it.

| | Bala Vihar donation | Monthly pledge |
|---|---|---|
| Purpose | Enrollment for the school year | Ongoing support for the mission |
| Amount | ~$500/year, offering-defined | **Fixed `$51/month`** (Vaibhav 2026-07-26; one Stripe Price, so nothing to choose) |
| Channel | Stripe checkout (hosted) | **Stripe PAD (hosted)** - same proxy, new mode |
| Gates enrollment? | **Yes** | **No - gates nothing, ever** |
| Status field | Existing donation status | **Its own separate status** |
| Required? | Effectively, to enroll | Entirely optional |

### 1.1 RESOLVED - the pledge is separate from the Bala Vihar donation

Vaibhav's original note opened with *"Regarding the $500 donation, we are introducing a monthly pledge option"*, which read as though the pledge **were** the payment mechanism for the $500. **Confirmed 2026-07-25: the "$500 donation" is the Bala Vihar donation and the pledge is separate.** Consequences that stand:

- The pledge does **not** confirm Bala Vihar enrollment (the $500 does).
- The pledge is offered **after** the Bala Vihar donation, never in competition with it (§5).
- The pledge gates nothing, so it can slip without affecting the cutover (§9).

---

## 2. Locked decisions

Struck-through rows were superseded by the 2026-07-26 revision.

| Decision | Answer |
|---|---|
| ~~Cheque / direct-deposit-form upload~~ | ~~None, ever.~~ **Moot** - no bank data is collected at all. |
| ~~Bank details collected and stored (encrypted)~~ | **SUPERSEDED 2026-07-26: not collected, not stored, not transmitted. Stripe only.** |
| Pledge status | **Separate** from the BV donation status. Exists only if a family pledges. |
| ~~Confirmation is a manual server-side API~~ | **SUPERSEDED** - see §6.2. Depends on what Vaibhav's endpoint can report (O9). |
| ~~Purge: the confirm call deletes the bank details~~ | **Moot** - there is nothing to purge. |
| ~~Minimum amount $50/month, configurable~~ | **SUPERSEDED 2026-07-26: a fixed `$51/month`.** One Stripe `priceId` = one amount. |
| Placement | Donation success page (primary) + family dashboard card (secondary). |
| Card once pledged | **Shows pledge status** - it does not disappear. |
| Family cancel / change | **Read-only for v1.** Families contact the temple - and per Vaibhav 2026-07-26 the temple cancels **manually in Stripe**. The portal has no cancel endpoint at all. |
| Family email on activation | **Yes**, via an **AWS-SES-managed template**. See §7 - the mechanism is already built. |

---

## 3. Why "no upload" mattered

Verified 2026-07-25: **no file-upload surface exists anywhere in this codebase** - no Vercel Blob, no S3, no Firebase Storage, no multipart, no `<input type="file">`. Corroborated by `SECURITY_REVIEW_2026-07-22.md:1282`.

After the 2026-07-26 revision this is **moot rather than merely decided**: there is no bank data to corroborate, so there is nothing to upload. Retained only so the "should we accept a void cheque?" question is not reopened from scratch.

---

## 4. Data model

**One record.** The second collection and the entire encryption layer were deleted on 2026-07-26.

### 4.1 `pledges/{pid}` - status only, non-sensitive

```ts
{
  pid: string,
  fid: string,
  monthlyAmount: number,          // dollars; >= app_config/pledge.minMonthlyAmount at write time
  status: 'started' | 'active' | 'cancelled',
  startedAt: Date,
  activatedAt: Date | null,
  cancelledAt: Date | null,
  startedByMid: string,
  // Opaque provider handle, whatever Vaibhav's service returns (a Stripe
  // subscription / mandate id, or its own reference). NOT a secret, but also
  // NOT shown to families - it is for reconciliation only. Shape pending O9.
  providerRef: string | null,
}
```

`status` semantics:
- **`started`** - the family was sent to the hosted page. **Counts as payment nowhere, and does NOT mean they finished.**
- **`active`** - the mandate is confirmed established (how, exactly, is O9).
- **`cancelled`** - abandoned, rejected, or stopped.

> **Naming: `started`, not `pending`.** The old model's `pending` meant "submitted, awaiting accounting". Here it means "we redirected them and do not yet know what happened" - a materially weaker claim, and the name should not overstate it.

### 4.2 ~~`pledge_secrets/{pid}`~~ - DELETED 2026-07-26

No encrypted collection, no `PLEDGE_ENCRYPTION_KEY`, no crypto module, no key rotation, no key custody. **Nothing sensitive is stored, so none of the machinery that protected it is needed.**

> The one landmine worth carrying forward: `can-access-route.ts` - the `/api/setu/*` catch-all grants **welcome-team** by default. Pledge routes still get **explicit** rules rather than relying on that prefix. Not because they hold secrets any more, but because a financial write should never inherit its authorization by accident.

### 4.3 `app_config/pledge` - admin-editable

```ts
{
  enabled: boolean,               // kill switch
  // copy fields for the ask card
}
```

> **`minMonthlyAmount` and `suggestedAmounts` are VOID for v1** (Vaibhav 2026-07-26:
> fixed **$51/month**). `/pad/monthly-subscription` takes a fixed Stripe `priceId`, so
> one amount means one Price and there is nothing for the family to choose.
>
> **The amount and the priceId must live TOGETHER, in env, not split across env and
> admin config.** They are environment-specific (test vs live Prices) and, more
> importantly, they must never drift: an admin editing the displayed amount to $75
> while the Price still charges $51 would make the portal lie about a recurring debit.
> Proposed: `STRIPE_PLEDGE_PRICE_ID` + `PLEDGE_MONTHLY_AMOUNT_CAD`, changed together,
> with the amount rendered from the same source the charge uses.

Same shape as `app_config/{disclaimers,locations,school_year}`, so it stays admin-editable in the portal with no external CMS (repo rule).

---

## 5. Placement - where the family meets this

**UNCHANGED by the revision**, with one path correction.

**Primary: the donation success page.** The family has just completed the Bala Vihar donation; intent is highest and the $500 is provably handled. Quiet copy, not a large call-to-action.

> ⚠️ **Path change from P4:** the success page moves from `/family/donate/success` to a **top-level `/donate/success`** (P4 v2 Task 8 Step 4), so it sits outside the gated `/family` layout. The pledge card moves with it.
>
> ⚠️ **Ordering from P4:** the **Adult Study Class ask comes first**, the pledge ask **second and quieter**. Reversing them leads with a money ask straight after a ~$500 payment.

**Secondary: a persistent card** on the family dashboard / `/family/donations`. Catches families who did not act in the success-page moment, and adults with no Bala Vihar children.

**Nowhere else. Specifically NOT:** in the enroll flow, as a modal or interstitial, or as anything that blocks or delays enrollment or the Bala Vihar donation.

> **Rationale for not offering it before the BV donation:** it would cannibalise the payment that actually gates enrollment.

### 5.1 The card is state-driven, and it never disappears

| Pledge state | Card |
|---|---|
| none | The ask: "Support the mission monthly, from $50/month" |
| `started` | **PAD settles slowly by design** - the integration doc says to render a processing UI. This must NOT claim success: *"We're setting up your monthly gift. This can take a few days to confirm."* |
| `active` | "You're giving $X monthly since [date]. Thank you." |
| `cancelled` | Back to the ask |

The `started` copy is a **correctness** matter, not a tone one: if the portal cannot verify the mandate, the card must not assert that a recurring financial arrangement exists.

**The card reads `pledges/{pid}` only.**

---

## 6. Flows

### 6.1 Start

1. Family opens the pledge ask from either entry point.
2. Chooses a monthly amount (≥ `minMonthlyAmount`). **No bank fields. No card fields. Nothing sensitive is rendered, typed, or posted.**
3. `POST /api/pledges/start` (outside `/api/setu/*`; family-manager only):
   - validates the amount against `app_config/pledge`
   - writes `pledges/{pid}` with `status: 'started'`
   - forwards a PAD payload to **CMT's Stripe service** and returns the hosted URL
4. The client redirects to the hosted page. The family authorises the PAD **at Stripe**.

> **This mirrors the existing one-time donation exactly.** The portal already never talks to Stripe directly: `checkout/route.ts` forwards to `getStripeCheckoutUrl()` - CMT's Cloud Run proxy, authed with `x-api-key`, shared with `chinmaya-event-registration`. The pledge is the same call with a different mode. **No new payment architecture.**

### 6.2 Activation - THE open question (O9)

The existing one-time flow is **client-trusted**: `mark-donation-status.ts:11` states outright *"'completed' here is client-trusted (no Stripe webhook in this slice)."* The family returns to the success page and self-attests.

**That is tolerable for a one-off and NOT tolerable for a recurring mandate.** A wrong one-time record is one wrong row; a wrong pledge means the portal tells the family and staff that an ongoing debit arrangement exists when it may not.

Three options, in descending order of preference:

- **(A) Vaibhav's service exposes a status/verify endpoint** the portal calls on return (or polls briefly). Cheapest to build here, and he is editing those endpoints **right now** - so this is the moment to ask. **Recommended.**
- **(B) A real Stripe webhook** into the portal. Correct long-term, but it is a new public route with signature verification, and no webhook exists today. More than launch week wants.
- **(C) Self-attestation, explicitly labelled.** `started` never becomes `active` automatically; the card and admin views say *family-reported, unverified*, and a human reconciles against Stripe. Acceptable **only** if it is stated in the UI rather than implied.

**Whichever is chosen, the client may never write `active` directly.** That rule survives from the original design and is the one part of the old §8.1 that still fully applies.

### 6.3 Cancel - BOOKKEEPING ONLY

`POST /api/admin/pledges/[pid]/cancel` - admin only; sets `status: 'cancelled'`, writes an `audit_log` row.

> 🔴 **RESOLVED 2026-07-26 and it constrains the UI: cancellation is handled MANUALLY by the temple/ashram in Stripe.** There is no cancel endpoint on the payment service and the portal cannot stop a debit.
>
> So this route records a decision; it does **not** stop the money. The admin screen must say so in as many words - something like *"This only updates the record. Cancel the actual debit in Stripe."* Left implicit, staff will click it, believe the debit stopped, and the family keeps being charged.

### 6.4 ~~Backstop purge sweep~~ - DELETED 2026-07-26

There is nothing sensitive to purge. A **stale-pledge report** (anything `started` beyond ~14 days) is still worth having - not for data protection now, but because a pile of `started`-never-`active` rows is the signal that the hosted flow is failing.

---

## 7. Activation email - AWS-managed SES template

**Decision: the template lives in the AWS SES service, not in this repo.** Vaibhav authors and maintains it there; the portal invokes it by name with dynamic variables. **No subject or body text is hardcoded**, so copy changes need no deploy.

> ✅ **The mechanism is ALREADY BUILT** - P3 shipped it (`49c9821`, `0c74de9`). `sendSesTemplatedEmail` exists on both sender interfaces, routed through `resolveSender()` so templated sends inherit the allowlist / redirect / mock machinery, with the registry keyed by env var. `pledge-activated` is **already registered** in `email-templates-config.ts` and `SES_TEMPLATE_PLEDGE_ACTIVATED` is already declared in `lib/env.ts`. Nothing in §7 needs building; it needs the template to exist in SES and the variable names agreed.

### 7.1 Dynamic variables

Family name, monthly amount, activation date. **Never any payment detail.** Exact names are a contract between Vaibhav's SES template and the calling code and must be written down (O5) - a mismatch fails at send time, not at build time.

### 7.2 Operational constraints

- **SES templates are per-region and per-account**, and must exist in `AWS_SES_REGION` (`ca-central-1`). Confirm UAT and prod share one account (O8), or a template present in UAT and absent in prod fails **only in production**.
- **A template that exists but fails to render is accepted by SES, returns a MessageId, and delivers nothing.** The app cannot detect this. Only `SES_CONFIGURATION_SET` with a RENDERING_FAILURE destination, plus a real per-template UAT send, catches it. See `docs/runbooks/ses-email-templates.md`.
- A failed email must **never** roll back the activation. Send outside the transaction, log, surface.
- `resolveSender()` redirects or silently drops in non-production, so a UAT test may not see mail at the real address. Testing gotcha, not a bug.

---

## 8. Security posture

The revision removes this feature's entire sensitive-data surface. What remains is ordinary financial-workflow hygiene.

| Risk | Mitigation |
|---|---|
| Bank details leaking | **Not collected, not stored, not transmitted by the portal.** The risk is deleted, not mitigated. |
| Staff seeing bank details | Same - there is nothing to see. |
| A future route exposing pledge data | Explicit `canAccessRoute` rules, outside the welcome-team-granting `/api/setu/*` catch-all, plus default-deny. |
| **Unverified money counted as real** | **The live risk.** `started` counts as payment nowhere; only a server-side path may set `active`. See O9. |
| Provider handle leaking | `providerRef` is not a secret but is not shown to families; reconciliation only. |

### 8.1 The client-trusted settlement flaw is now the whole story

`SECURITY_REVIEW_2026-07-22.md:265-299` (**High**, open): donation settlement is client-trusted today - a manager can POST `status: "completed"`, or merely visit the success page, and the donation records as paid with no payment.

The original spec argued a manual PAD *"can never be made provider-authoritative the way Stripe can"* and settled for staff-only activation. **Moving to Stripe lifts that constraint** - if the payment service reports mandate status, this feature can be the first provider-authoritative flow in the portal, and the pattern that finding recommends.

If instead we ship option (C), the pledge **inherits** the existing flaw rather than fixing it - which is survivable only because it is labelled. **Do not let (C) ship silently.**

### 8.2 Known residual

`firestore.rules` now exists but is **UAT-only** (deny-all, P5 Task 1 Steps 1-3, shipped). Prod rules are unmanaged from this repo. Per the prod ruleset captured at `firestore.prod.rules.baseline`, Firestore allow rules are **additive**, so `pledges` - matching no rule - is already denied to the client SDK. **No new prod deny is required**, which retired the old blocker.

---

## 9. Scope, sequencing, and what it depends on

A pledge **gates nothing**, so it is fully decoupled from the cutover's critical path.

**The revision changed why it is last.** It was cut candidate #1 because of crypto plus the unowned accounting hand-off. Both are gone, and the build is now small. But it has acquired a **hard external dependency**: Vaibhav's Stripe PAD endpoint and its integration details, which do not exist yet.

> 🔴 **PAD IS TEST-MODE ONLY as of 2026-07-26** (Vaibhav: *"all of this available to test in TEST only for now"*). Unless it is promoted to live before Aug 3, **this feature cannot take a real mandate on launch day.** Two honest options, and the choice is the owner's:
> 1. **Ship it dark** - build it, verify against test, leave `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` off, flip when live mode exists. Costs nothing at launch.
> 2. **Ship the interim** - the "email them the instructions" path from Vaibhav's 8:02 message (~1 day), and replace it with PAD later.
>
> **Doing neither, and shipping the Stripe path against a test key, would take real families through a flow that charges nobody.**

Depends on:
- **Vaibhav's Stripe service supporting monthly PAD IN LIVE MODE** - *blocking for launch, not for build*
- **The delayed-outcome channel (O9)** - *blocking*
- `audit_log` (shipped)
- `app_config` pattern (exists)
- P3's `sendSesTemplatedEmail` (shipped)
- P4 Task 8 Step 4's move of the success page to `/donate/success`
- **No new npm dependency, no crypto, no key management**

Does **not** depend on: file upload, the donation-status model, or the Adult Study Class beyond page placement.

---

## 10. Verification

1. **Deployed-UAT E2E**: start a pledge, assert the card shows `started`, drive activation by whichever mechanism O9 settles, assert `active`.
2. **Nothing sensitive is posted**: assert the start request body contains no bank or card field, and that the form renders none.
3. **N=2**: a family with two pledges over time (one cancelled, one active) must render correctly - the card must not pick "the first pledge".
4. **Amount validation**: below `minMonthlyAmount` is rejected server-side, not just in the form.
5. **`started` counts nowhere**: assert it does not alter the payment chip, roster status, enrollment confirmation, or any report.
6. **The client cannot write `active`**: POST it directly as a family-manager and assert refusal.
7. **Copy honesty**: if option (C), assert the `started` and admin copy say *unverified* rather than implying success.

~~Round-trip crypto test~~ and ~~purge test~~ deleted with the encryption layer.

---

## 11. Open items

| # | Item | Owner |
|---|---|---|
| ~~O1~~ | RESOLVED - the "$500 donation" is the Bala Vihar donation; the pledge is separate (§1.1). | done |
| **O9** ⭐ | **STILL THE BLOCKER, narrowed.** The payload, the result endpoints and cancellation are all answered. What is NOT: **how the portal learns a DELAYED outcome.** PAD settles slowly, step 3 will usually return `pending`, and the authoritative webhooks land on Vaibhav's service. Needs either (a) his service calling a portal webhook, or (b) the portal registering its own Stripe webhook, or (c) an explicit accepted limit that a pledge can sit `started` until someone reconciles by hand. | **Vaibhav** |
| **O12** | Is `POST /pad/monthly-subscription` safe to RETRY later with the same `setupSessionId` (via `idempotencyKey`)? The orphan-mandate case in §0 makes a reconciliation job mandatory, and it depends on this being idempotent. | **Vaibhav** |
| **O13** | The actual **`priceId` for $51** (test now, live later), and the service **BASE URL** - today `STRIPE_CHECKOUT_URL` points at one endpoint, but the contract needs `{BASE}/pad/setup-link`, `/checkout-session-result`, `/pad/monthly-subscription`, `/subscription-result`. Also: same `x-api-key` for test? | **Vaibhav** |
| **O14** | **When does `/pad/*` go live?** Decides ship-dark vs the interim email path (§9). | **Vaibhav / CMT Developer** |
| **O10** | Family-facing **name** for this feature. "Pledge" already means the Chinmaya Mission Pledge in the disclaimers - two unrelated things under one word. | CMT Developer |
| **O2** | Who may invoke cancel - admin only (assumed), or admin + coordinator? | CMT Developer |
| **O5** | Vaibhav creates the activation template **in AWS SES** (`ca-central-1`) and shares the **template name** + exact **variable names**. | Vaibhav |
| **O8** | Confirm UAT and production share one AWS account/region for SES templates, and create `SES_CONFIGURATION_SET` with a RENDERING_FAILURE destination. | CMT Developer |
| **O11** | ~~Is "email them the instructions" the interim path?~~ **NOW LIVE AGAIN** because `/pad/*` is test-only (§9). Decide: ship dark, or build the interim. | CMT Developer |
| ~~O3~~ ~~O4~~ ~~O6~~ ~~O7~~ | Purge window, encryption-key custody, accounting hand-off, bank-field validation - **all deleted** with the bank-detail collection. | closed 2026-07-26 |

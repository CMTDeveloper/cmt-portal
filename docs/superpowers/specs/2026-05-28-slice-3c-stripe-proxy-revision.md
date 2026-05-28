# Slice 3c — Stripe Checkout (REVISED: Cloud Run proxy)

**Date:** 2026-05-28
**Status:** Design revision — supersedes §4 (RBB-1/3/4/5/8/9/10), §8 (Stripe-from-scratch), §9 (PDF receipts) of [the Slice 3 design](./2026-05-26-slice-3-donations-checkout-receipts-design.md).
**Owner:** CMT Developer

---

## 1. Why this revision exists

The original Slice 3 design assumed the portal would build the entire Stripe stack itself — `PaymentIntent` creation, a signed webhook, a receipt-number counter, `@react-pdf/renderer` PDF generation, Firebase Storage upload, and a SES receipt-email path. The user clarified the real operating model on 2026-05-27:

1. **CMT already runs a Stripe checkout service** on Google Cloud Run (the same one the `chinmaya-event-registration` app uses). The portal does not talk to Stripe directly — it POSTs a payload to that service and gets back a hosted Stripe Checkout URL.
2. **Accounting owns receipts.** Today's flow: a family pays, CMT gets a payment notification, and at year-end `accounting@chinmayatoronto.org` mails a CRA **annual rollup** receipt (sample: receipt `25-084`, "General Donation $500.00", issued 14 Feb 2026 for the 2025 tax year). The portal does NOT generate, number, store, or email tax receipts.

**Net effect:** RBB-1 (Stripe account — exists), RBB-3 (receipt numbering — accounting owns it), RBB-4 (per-donation vs rollup — rollup, accounting), RBB-5 (donor address — accounting captures from Stripe), RBB-8 (PDF lib — none), RBB-9 (PDF storage — none), RBB-10 (signature — accounting's) are all **deleted**. RBB-2 (CRA #) survives only as display copy (`11885 3456 RR0001`), and even that is optional in-portal since the portal issues no receipts.

This collapses Slice 3c from "build Stripe + receipts from scratch" (the original 4-5 day 3c + 3 day 3e) into a **single Cloud-Run-proxy slice** modeled directly on `chinmaya-event-registration/src/app/api/chalisa/create-checkout/route.ts`.

## 2. Two donation surfaces

The sidebar already shows **Bala Vihar** and **Giving** as separate tabs. They are two entry points to the same checkout primitive:

| Surface | Route | Amount | When |
|---|---|---|---|
| **Bala Vihar dakshina** | `/family/donate?eid={eid}` | Defaults to `enrollment.effectiveSuggestedAmount`, editable **up** only | Tied to an active enrollment |
| **General giving** | `/family/donate` (no eid) | Any positive amount, donor's choice | Year-round, no enrollment required |

Both resolve to one page (`/family/donate`) and one endpoint (`POST /api/setu/donations/checkout`) with a discriminated body. This matches the user's mental model: "Bala Vihar is the yearly $500 school-year donation; Giving is general, payable all year round."

## 3. The checkout contract (ported from events app)

`getStripeCheckoutUrl()` resolves the endpoint: `STRIPE_CHECKOUT_URL_TEST` when `STRIPE_USE_TEST_CHECKOUT === 'true'`, else `STRIPE_CHECKOUT_URL`. Both accept the same `x-api-key: ${STRIPE_API_KEY}` header.

Request body the Cloud Run service expects:
```ts
{
  lineItems: Array<{ name: string; amount: number; quantity: number }>,
  customerEmail: string,
  client_reference_id: string,          // unique per checkout
  successUrl: string,
  cancelUrl: string,
  metadata?: { campaign?: string; category?: string; [k: string]: string },
  branding_settings?: { display_name?: string },
}
```
Response: `{ url: string }` (the hosted Stripe Checkout link) — the portal 200s this back to the client, which `window.location` redirects.

## 4. Portal endpoint — `POST /api/setu/donations/checkout`

Auth-gated (family-manager; family-member cannot initiate). Ported security posture from the events route:
1. **Per-IP rate limit** (5/min in-memory).
2. **Zod-validated discriminated body** — `{ type: 'bala-vihar', eid, amountCAD, coverFee? }` or `{ type: 'general', amountCAD, coverFee? }`.
3. **Server-side trust, never client:**
   - `customerEmail` ← the signed-in manager's email (from family member record), NOT a client field.
   - `client_reference_id` ← `BV26-{fid}` (bala-vihar) or `GD26-{fid}-{shortId}` (general).
   - For `bala-vihar`: load the enrollment, enforce `amountCAD >= effectiveSuggestedAmount` (the snapshot invariant lives here — a manager can give more, never less; lowering stays welcome-team-only via the override).
   - `lineItems[0].name` ← server-derived: `"Bala Vihar Donation — {periodLabel}"` or `"General Donation — Chinmaya Mission Toronto"`.
   - `successUrl`/`cancelUrl` ← built from a validated request origin (same anti-phishing origin check as events), pointing at `/family/donate/success` and `/family/donate/cancel`.
4. **Processing-fee toggle** (optional, donor's choice): `coverFee` adds a `Processing Fees` line item at `round2(amount * 0.022 + 0.30)` — same constants as the events app.
5. **Persist a lightweight `donations/{did}` doc** with `status: 'redirected'` (audit + family history), then forward to Cloud Run, return `{ url }`.
6. Fail closed if `STRIPE_API_KEY` / checkout URL unset → 503 `checkout-not-configured`.

## 5. Data model — `donations/{did}` (simplified)

No receipt fields (accounting owns those). Just enough for an audit trail + the family's own "donations I started" view.

```ts
type DonationDoc = {
  did: string;                                  // `don_{shortId}`
  fid: string;
  donorMid: string;                             // member who initiated
  donorName: string;                            // snapshot
  donorEmail: string;                           // snapshot
  type: 'bala-vihar' | 'general';
  pid: string | null;                           // bala-vihar → period id; general → null
  eid: string | null;                           // bala-vihar → enrollment id; general → null
  label: string;                                // "Bala Vihar Donation — Fall 2026" / "General Donation"
  amountCAD: number;                            // integer dollars, donor's gift
  coverFee: boolean;
  feeCAD: number;                               // 0 if not covered
  clientReferenceId: string;                    // what we sent Stripe
  status: 'redirected' | 'completed' | 'abandoned';
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Status semantics (honest about what we can know):**
- `redirected` — we created the checkout URL and sent the family to Stripe. Set on checkout.
- `completed` — Stripe redirected the family back to `/family/donate/success?did={did}`. Best-effort, client-trusted — **not** authoritative (accounting's payment notification is). Good enough for the family's "you gave $X" view.
- `abandoned` — they hit `/family/donate/cancel`. Set best-effort.

There is **no webhook** in this slice. The portal never claims a donation is confirmed for tax purposes — `/family/donations` explicitly states the official receipt comes from accounting by email in February.

## 6. `/family/donations` (receipts tab)

Becomes an honest history + expectations page, NOT a receipt store:
- Lists the family's `donations/{did}` docs (year-grouped), showing label, amount, date, and status badge.
- A persistent callout: **"Your official CRA tax receipt is mailed by accounting@chinmayatoronto.org each February for the prior calendar year. This list is your own record of donations started through the portal."**
- No PDF download buttons (we issue none). If a family needs a receipt re-sent, the callout points them to accounting.

## 7. Env vars (added to `lib/env.ts` + `turbo.json`)

```ts
STRIPE_API_KEY: z.string().min(1).optional(),
STRIPE_CHECKOUT_URL: z.string().url().optional(),
STRIPE_CHECKOUT_URL_TEST: z.string().url().optional(),
STRIPE_USE_TEST_CHECKOUT: z.enum(['true', 'false']).default('false'),
NEXT_PUBLIC_FEATURE_SETU_DONATIONS: flagString,   // already used; add to schema for completeness
```
All set in Vercel (production + development confirmed 2026-05-27; preview pending an interactive add). Server-only secrets (`STRIPE_API_KEY`) never reach the client bundle. Add all to `turbo.json` `env` so Turborepo's build sandbox passes them through (per `feedback_turbo_env_passthroughs`).

## 8. Sub-tasks

1. `lib/stripe-config.ts` — `getStripeCheckoutUrl()` resolver (port).
2. `lib/env.ts` + `turbo.json` — Stripe env vars.
3. `packages/shared-domain/src/setu/schemas/donation.ts` — `DonationDoc` + `CheckoutInputSchema` (discriminated union) + `getCheckoutLineItemName` helper + re-export.
4. `features/setu/donations/{create-donation,get-donations,mark-donation-status}.ts` — Firestore helpers.
5. `app/api/setu/donations/checkout/route.ts` — the proxy endpoint (rate limit, origin check, server-side amounts, Cloud Run forward).
6. `can-access-route.ts` — gate `POST /api/setu/donations/checkout` (manager), `GET /api/setu/donations` (any family role). (NOTE: §13 of the original removed the premature `/api/setu/donations/*` gates — re-add them now that handlers exist.)
7. Wire `/family/donate` — discriminated by `?eid=`; real amount input + tiers + coverFee toggle + checkout button → `window.location = url`.
8. `app/family/donate/success/page.tsx` + `cancel/page.tsx` — mark status, friendly copy.
9. Wire `/family/donations` — real data + accounting callout.
10. Update the **Giving** sidebar entry / dashboard to point at `/family/donate` (general) and confirm Bala Vihar links carry `?eid`.
11. Firestore index: `donations (fid ASC, createdAt DESC)` already declared in `firestore.indexes.json` from the original 3a work — deploy to UAT.
12. Tests: schema validation, checkout endpoint (amount-floor enforcement for bala-vihar, manager-only, rate limit, origin check, fail-closed), get-donations, success/cancel status transitions. E2E against UAT for the donation doc round-trip (the Cloud Run call itself is mocked in tests — never hit the real Stripe service from CI).

## 9. What is explicitly NOT in this slice

- No webhook / payment confirmation ingestion (accounting owns truth).
- No PDF / receipt generation, numbering, storage, or email.
- No e-Transfer / cheque pledge flow (the prototype's payment-method picker collapses to **card only** for now; e-Transfer instructions can stay as static copy pointing at `donations@chinmayatoronto.org` but do not create portal records).
- No recurring/monthly donations.
- No designated-fund picker beyond the bala-vihar / general split.

## 10. Verification (mock-free, per CLAUDE.md Pre-ship)

Before flipping `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=true`:
1. With `STRIPE_USE_TEST_CHECKOUT=true`, complete a **real test-mode checkout** end-to-end in UAT: `/family/enroll` → enroll → Continue to donation → land on Stripe test checkout → pay with `4242 4242 4242 4242` → redirect back to `/family/donate/success` → donation doc shows `completed`.
2. Repeat for the general-giving path (`/family/donate` direct).
3. Confirm the `amountCAD >= effectiveSuggestedAmount` floor rejects a below-suggested bala-vihar amount with a clear UI message.
4. Confirm `/family/donations` lists both and shows the accounting-receipt callout.

# Donations module — how it works, end to end

Families pay their program **dakshina** in the portal by credit/debit card:
the donate form hands off to a Stripe-hosted checkout page (via CMT's Cloud
Run Stripe service — the portal never talks to Stripe directly), and the
result shows up on the family dashboard and the welcome roster.

Two framing facts before the steps:

1. **Portal donations are enrollment dakshina only.** General year-round
   giving is handled off-portal (CMT decision 2026-06-04) — a bare
   `/family/donate` visit just returns to the dashboard.
2. **The portal's donation status is best-effort UX, not accounting truth.**
   There is no Stripe webhook: "completed" means *the family reached the
   thank-you page*, not *the payment settled*. Accounting reconciles from
   Stripe directly and owns all CRA receipts (annual rollup mailed each
   February by accounting@chinmayatoronto.org — the portal issues no
   receipts and sends no payment emails).

Specs: `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md`
(+ `2026-05-28-stripe-proxy-revision.md`, `2026-05-29-donation-period-schoolyear-tiered-pricing-revision.md`).

---

## Part 1 — Family: making a donation

### Getting to the form (three doors, all need an enrollment)

- **Right after enrolling** in a donation program, the portal continues
  straight to the donate form ("Enrolled! Continuing to donation.").
- **The enroll page** of an already-enrolled program shows
  **"Continue to donation →"**.
- **The dashboard** donation card shows **Give** (or **Give more**) while
  the suggested amount isn't fully donated.

Only the **family manager** can donate — other members see "Only the family
manager can make a donation through the portal." There is no donations
history screen for families; the dashboard card *is* the status view.

### The form (`/family/donate`)

1. The amount is pre-filled with the enrollment's **suggested amount**, with
   quick-pick chips (the suggested floor is labelled "· suggested").
2. **You can give more, never less online.** Typing below the floor shows
   "Suggested amount is $N. To give less, please contact the welcome team."
   and disables the button (the server enforces the same rule). Lowering a
   family's amount is a welcome-team action — see Part 3.
3. Optional checkbox: **"Add $X processing fee so 100% of my gift reaches
   the Mission"** (2.2% + $0.30, shown live; unchecked by default).
4. A summary card shows Donation / Processing fee / Total today and the
   February tax-receipt note. **Give $X →** opens the Stripe checkout page
   (card payments; "Secured by Stripe").

### After Stripe

- **Success** → the thank-you page ("Thank you for your dakshina") with the
  tax-receipt note. Both buttons lead back to the family dashboard, where
  the donation card now shows progress or "Thank you for your donation".
- **Cancelled / backed out** → "Donation not completed — no charge was
  made." ⚠️ The **"Try again" button on this page lands on the dashboard**,
  not back on the form — retry via the dashboard's **Give** button.
- **2025-26 BV families who paid offline** (legacy roster says paid) see
  "Already paid for {term}" and can't double-pay online. *Partially*-paid
  offline families are **not** blocked and would owe the full floor online —
  send them to the welcome team instead.

## Part 2 — The money model (recap)

Covered in detail in `programs-module-guide.md`; the donation-relevant core:

- Each offering carries **pricing tiers by enrollment date** (e.g. $500 from
  September, $300 from December — Toronto dates). A family's suggested
  amount resolves as: **welcome-team override → live recompute from current
  tiers at their enroll date → the snapshot frozen at enrollment**.
- An admin who fixes a pricing mistake on the offering reaches all unpaid
  families immediately (live recompute) — except those with an override.
- **"Paid" = completed portal donations reaching the suggested amount.**
  Donations are recorded against the specific enrollment (`eid`), so paying
  Bala Vihar doesn't mark Tabla paid on the family dashboard.

## Part 3 — Welcome team and admin

### What you can see

- **`/welcome/roster`** — the per-family payment chip: **paid** (green) /
  **outstanding** (orange) / **unknown**. ⚠️ Two trust caveats:
  - The chip sums a family's completed donations **all-time** against their
    currently-active enrollments — so right after a school-year rollover,
    last year's payers show **paid for the new year they haven't paid yet**.
    Don't trust the chip across a rollover boundary.
  - It only counts portal (Stripe) donations — cutover-year families who
    paid **offline** show "outstanding" here even though their own dashboard
    says Completed.
- **`/welcome/reports` → Donations summary** (**admin-only** — welcome-team
  sees no card and the API returns 403): all-time completed totals by period
  and by program, plus paid/outstanding family counts, with CSV export. The
  date-range control does not apply to this report (all-time by design;
  only the program filter narrows it). The card says it itself: totals are
  best-effort — accounting@ remains the settlement source of truth.

### What you can do

- **Lower (or clear) a family's suggested amount** — API only, no screen:

  ```
  PATCH /api/welcome/enrollments/{eid}/override
  { "suggestedAmountOverride": 300 }     // positive integer, or null to clear (0 is rejected)
  ```

  The family's donate form floor updates immediately. ⚠️ Rollover wipes
  overrides (the new enrollment starts with none) — re-apply after each
  promotion.
- **That's the whole write surface.** There is no admin screen to list
  donations, record an offline/cash donation, mark a family paid, fix a
  stuck status, or issue a refund — all of that lives with accounting and
  the Stripe dashboard.

### Reading donation statuses (when accounting asks)

A donation doc moves `redirected` → `completed` (family reached the success
page) or `abandoned` (family hit cancel). Two patterns are **normal**:

- **Stuck at `redirected` even though the card was charged** — the family's
  session expired mid-checkout, they closed the browser on Stripe's receipt
  page, etc. Nothing in the portal fixes this; cross-check in the Stripe
  dashboard using the donation doc id (it's Stripe's `client_reference_id`).
- **Orphaned `redirected` rows with no Stripe session** — checkout failed
  after the audit record was written (proxy down, config missing). Not lost
  money, not fraud.

### Payment reminders — currently manual, on purpose

The weekly unpaid-family reminder cron is **disabled**
(`WEEKLY_REMINDER_CRON_ENABLED` is not set anywhere) and ashram staff handle
reminders manually. **Do not enable it as-is for Setu donations**: it is a
legacy check-in feature — it reads the old RTDB roster's payment column,
ignores Stripe donations entirely (it would nag families who already paid
online), and its email copy is check-in-centric. A Setu-aware reminder is a
future build. (The "donation thank-you" email is likewise a manual button on
the legacy `/check-in/admin/unpaid` page — nothing is auto-sent on payment.)

## Year-end: rollover resets

The school-year promotion closes the old enrollment and creates a fresh one
with a new pricing snapshot — so every family starts the new year **unpaid
on their dashboard** (correct), **overrides cleared** (re-apply via the
API), and the **roster chip over-reporting paid** until new-year donations
come in (see the caveat above).

## Quick reference

| Who | Where | Does |
|---|---|---|
| Family manager | dashboard **Give** → `/family/donate?eid=…` | Pay dakshina by card (≥ suggested floor, optional fee cover) |
| Family (anyone) | dashboard donation card | Progress "$X of $Y suggested" / Completed |
| Welcome team | `/welcome/roster` | Payment chip (see trust caveats) |
| Welcome team | `PATCH /api/welcome/enrollments/{eid}/override` | Lower/clear a family's suggested amount (API-only) |
| Admin | `/welcome/reports` → Donations summary | All-time totals by period/program + paid/outstanding counts, CSV |
| Accounting (off-portal) | Stripe dashboard | Settlement truth, refunds, CRA receipts (February) |

**Statuses:** `redirected` (sent to Stripe) → `completed` (reached success
page — client-trusted) or `abandoned` (hit cancel; revisiting the success
link can still upgrade it). No failed/refunded states in v1.

## Notes for developers

- Collection `donations/{did}` (top-level): `fid`, `donorMid/Name/Email`
  (email from the member record, never client input), `type`
  (`enrollment`|`general`), `programKey/programLabel/pid/eid`, `label`,
  `amountCAD` (**integer dollars**, 1–100000), `coverFee`/`feeCAD`,
  `clientReferenceId` (= did), `status`, timestamps. Index in use:
  `(fid, createdAt DESC)`. ⚠️ Two declared indexes reference fields no doc
  has (`pledgedAt`, `periodLabel`+`confirmedAt`) — leftovers from the
  scrapped pledge/e-Transfer design; no pledge workflow exists.
- The only handler is `POST /api/setu/donations/checkout` (manager-only,
  5/min/IP in-memory rate limit, fails closed 503 if Stripe env is unset).
  canAccessRoute also allows family-role **GET** `/api/setu/donations/*` —
  forward-compat scaffolding; no GET handler exists. The `type:'general'`
  API branch works but no UI reaches it.
- Stripe wiring: `STRIPE_CHECKOUT_URL` (+ `_TEST` and
  `STRIPE_USE_TEST_CHECKOUT`) point at the Cloud Run proxy (shared with the
  events-registration app), authenticated by `STRIPE_API_KEY` as
  `x-api-key`; all in `turbo.json`'s env array. Success/cancel URLs are
  built server-side from an origin allowlist (cmt-setu/cmt-portal
  `*.vercel.app`, localhost, `NEXT_PUBLIC_PORTAL_BASE_URL`) — a custom
  domain **must** be added to `NEXT_PUBLIC_PORTAL_BASE_URL` or checkout
  400s `invalid-origin`.
- Status transitions happen **only** on the success/cancel page renders
  (`markDonationStatus`: cross-family guard, completed never downgrades).
  Known stranding path: middleware's sign-in bounce keeps the pathname but
  drops `?did=`, so a session expiry during checkout loses the completion
  mark permanently.
- Three different "paid" computations exist and can disagree: dashboard
  (eid-scoped, BV via `selectBalaViharEnrollment`), roster chip (all-time
  donations vs all active enrollments, live tier recompute), donations
  report (snapshot/override only, no live recompute). Legacy RTDB payment
  status is consulted by family-facing pages only.
- ⚠️ **Cron method mismatch (affects more than donations):** all three
  `/api/cron/*` routes export only `POST`, but Vercel cron invokes with
  **GET** — the scheduled invocations would 405. Moot for the weekly
  reminder (env-gated off) but worth fixing before relying on the daily
  cache-reset or prasad-reminder schedules. Manual trigger: `POST` with
  `Authorization: Bearer $CRON_SECRET`.
- Flag: `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` (in `turbo.json`) gates the
  form and the checkout route; donations are live behind it in UAT.
- Test coverage: solid unit/route tests (floor enforcement, fee math,
  manager-only, report aggregation, schemas) + `enroll-wording.spec.ts`
  copy checks — but **no Playwright E2E exercises the donate flow** (even
  up to the Stripe redirect). Known gap, same bucket as seva.

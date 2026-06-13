# Donations module — how it works, end to end

**What this is:** how families pay their program **dakshina** (the suggested
class donation) in the portal, and what you can see and do when a payment
question comes up at the desk.

Families pay by credit or debit card. The donate form hands the family off
to a secure payment page run by Stripe (the card-payment company), and the
result then shows up on the family's dashboard and on the welcome roster.
The portal itself never handles card numbers.

Two things to know before anything else:

1. **Portal donations are enrollment dakshina only.** General year-round
   giving is handled outside the portal (CMT decision 2026-06-04). If
   someone opens the donate page (/family/donate) without coming from an
   enrollment, it simply returns them to the dashboard.
2. **The portal's "paid" status is a helpful indicator, not the official
   accounting record.** The portal never hears back from Stripe after the
   payment: "completed" means *the family reached the thank-you page*, not
   *the payment settled at the bank*. Accounting reconciles from Stripe
   directly and owns all CRA tax receipts (one annual rollup, mailed each
   February by accounting@chinmayatoronto.org). The portal issues no
   receipts and sends no payment emails.

---

## Part 1 — Family: making a donation

### Getting to the form (three doors — all start from an enrollment)

A family can reach the donate form three ways:

1. **Right after enrolling** in a program that takes a donation, the portal
   carries them straight to the donate form (they'll see "Enrolled!
   Continuing to donation.").
2. **From the enroll page** of a program they're already enrolled in — it
   shows a **"Continue to donation →"** button.
3. **From the dashboard** — the donation card shows a **Give** button (or
   **Give more**) for as long as the suggested amount hasn't been fully
   donated.

Only the **family manager** can donate. Other family members see "Only the
family manager can make a donation through the portal." There is no
donations-history screen for families — the dashboard card *is* their
status view.

### Filling in the form (/family/donate)

1. The amount comes pre-filled with the enrollment's **suggested amount**,
   with quick-pick amount chips (the suggested minimum is labelled
   "· suggested").
2. **Families can give more online, never less.** If they type an amount
   below the suggested minimum, they see "Suggested amount is $N. To give
   less, please contact the welcome team." and the button is disabled. (The
   system blocks it behind the scenes too, so there's no way around it
   online.) Lowering a family's amount is a welcome-team action — see
   Part 3.
3. There's an optional checkbox: **"Add $X processing fee so 100% of my
   gift reaches the Mission"** (the fee is 2.2% + $0.30, shown live as they
   type; the box is unchecked by default).
4. A summary card shows Donation / Processing fee / Total today, plus the
   note about the February tax receipt. Clicking **Give $X →** opens the
   Stripe payment page (card payments; it says "Secured by Stripe").

### After the payment page

- **Payment went through** → they land on the thank-you page ("Thank you
  for your dakshina") with the tax-receipt note. Both buttons there lead
  back to the family dashboard, where the donation card now shows progress
  or "Thank you for your donation".
- **They cancelled or backed out** → they see "Donation not completed — no
  charge was made." ⚠️ Watch out: the **"Try again" button on that page
  lands on the dashboard**, not back on the form. To retry, use the
  dashboard's **Give** button.
- **Families from the 2025-26 Bala Vihar year who already paid offline**
  (the old records show them as paid) see "Already paid for {term}" and
  can't accidentally pay twice online. ⚠️ But families who *partially* paid
  offline are **not** blocked — online they'd be asked for the full
  suggested amount. Send those families to the welcome team instead.

## Part 2 — How the suggested amounts work (recap)

The full picture is in the [programs module guide](programs-module-guide.md).
Here's the part that matters for donations:

- Each program offering has **prices that change by enrollment date** (for
  example, $500 if you enrol from September, $300 from December — Toronto
  dates). The amount a family is asked for is decided in this order: **a
  special amount the welcome team set for that family** → otherwise, **the
  current price list applied to their enrollment date** → otherwise, **the
  price that was saved when they enrolled**.
- Because of that second step, when an admin fixes a pricing mistake on the
  offering, every unpaid family sees the corrected amount right away —
  except families who have a special amount set.
- **"Paid" means completed portal donations add up to the suggested
  amount.** Each donation is tied to the specific class enrollment it pays
  for, so paying for Bala Vihar doesn't mark Tabla as paid on the family
  dashboard.

## Part 3 — Welcome team and admin

### What you can see

- **The roster** (/welcome/roster) shows a payment chip on each family:
  **paid** (green), **outstanding** (orange), or **unknown**. ⚠️ Two
  reasons not to take the chip at face value:
  - The chip adds up a family's completed donations **from all time** and
    compares them against the enrollments that are active **right now**. So
    just after a school-year rollover, last year's payers show as **paid**
    for the new year — which they haven't actually paid yet. Don't trust
    the chip across a rollover boundary.
  - The chip only counts online (Stripe) donations. Cutover-year families
    who paid **offline** show as "outstanding" here, even though their own
    dashboard says Completed.
- **Reports** (/welcome/reports) → the **Donations summary** card
  (**admin-only** — welcome-team members don't see the card, and the data
  is blocked for them too): all-time completed totals by period and by
  program, plus paid/outstanding family counts, with a CSV download. Note:
  the date-range control on the reports page does **not** apply to this
  report — it is all-time by design; only the program filter narrows it.
  The card says it itself: these totals are best-effort — accounting@
  remains the source of truth for settled payments.

### What you can do

- **Lower (or clear) a family's suggested amount.** There is no screen for
  this — ask the tech team to set it (the details they need are in the
  developer notes below). Once set, the family's donate form switches to
  the new minimum immediately. ⚠️ The school-year rollover wipes these
  special amounts (each new enrollment starts without one) — they have to
  be re-applied after every promotion.
- **That's the only change anyone can make in the portal.** There is no
  admin screen to list donations, record an offline/cash donation, mark a
  family paid, fix a stuck status, or issue a refund — all of that lives
  with accounting and the Stripe dashboard.

### Reading donation statuses (when accounting asks)

Behind the scenes, every donation record moves through statuses:
**redirected** (the family was sent to the payment page) → **completed**
(they reached the thank-you page) or **abandoned** (they hit cancel). Two
patterns are **normal** and not a cause for alarm:

- **Stuck at "redirected" even though the card was charged.** This happens
  when the family's sign-in expired mid-checkout, or they closed the
  browser on Stripe's receipt page, and so on. Nothing in the portal fixes
  this. The payment can be cross-checked in the Stripe dashboard — every
  portal donation carries a reference id that Stripe stores too (ask the
  tech team to look it up).
- **A "redirected" record with no matching Stripe payment at all.** That
  means checkout broke right after the portal wrote its own record (the
  payment service was down or misconfigured). It is not lost money and not
  fraud.

### Payment reminders — currently manual, on purpose

The weekly "you haven't paid yet" reminder email is **switched off**: the
tech team would have to turn it on, and it is off everywhere. Ashram staff
handle payment reminders manually. **Do not ask for it to be switched on
as-is for Setu donations** — it is a leftover from the legacy check-in
system: it reads the old system's payment records, knows nothing about
online (Stripe) donations (so it would nag families who already paid
online), and its email wording is written for check-in. A donations-aware
reminder is a future build. (Likewise, the "donation thank-you" email is a
manual button on the legacy check-in admin page (/check-in/admin/unpaid) —
nothing is sent automatically when a payment comes in.)

## Year-end: rollover resets

The school-year promotion closes each family's old enrollment and creates a
fresh one with that year's pricing. Three things follow:

- Every family starts the new year **unpaid on their dashboard** — that's
  correct, not a bug.
- Any **special amounts the welcome team had set are cleared** — ask the
  tech team to re-apply them.
- The **roster payment chip over-reports "paid"** until new-year donations
  come in (see the caveat in Part 3).

## Quick reference

| Who | Where | What they can do |
|---|---|---|
| Family manager | **Give** on the dashboard → donate form (/family/donate) | Pay dakshina by card (at or above the suggested amount, optional fee cover) |
| Family (anyone) | Donation card on the dashboard | See progress ("$X of $Y suggested") or Completed |
| Welcome team | Roster (/welcome/roster) | See the payment chip (read the trust caveats above) |
| Welcome team | Ask the tech team (no screen for this) | Lower or clear a family's suggested amount |
| Admin | Reports (/welcome/reports) → **Donations summary** | All-time totals by period/program, paid/outstanding counts, CSV download |
| Accounting (off-portal) | Stripe dashboard | The real payment record: settlement, refunds, CRA receipts (February) |

**Statuses:** **redirected** (sent to the payment page) → **completed**
(reached the thank-you page — the portal takes the browser's word for it)
or **abandoned** (hit cancel; if the family later opens the thank-you link,
the status can still flip to completed). There is no "failed" or "refunded"
status in this version.

## Notes for developers

- Specs: `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md`
  (+ `2026-05-28-stripe-proxy-revision.md`, `2026-05-29-donation-period-schoolyear-tiered-pricing-revision.md`).
  Checkout goes through CMT's Cloud Run Stripe proxy — the portal never
  talks to Stripe directly, and there is **no Stripe webhook**.
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
- The "ask the tech team to lower a family's suggested amount" action in
  Part 3 is:

  ```
  PATCH /api/welcome/enrollments/{eid}/override
  { "suggestedAmountOverride": 300 }     // positive integer, or null to clear (0 is rejected)
  ```

  API only, no screen. The family's donate-form floor updates immediately.
- The Donations summary report API is admin-gated — welcome-team requests
  return 403.
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
  mark permanently. The donation doc id doubles as Stripe's
  `client_reference_id` for cross-checking in the Stripe dashboard.
- Three different "paid" computations exist and can disagree: dashboard
  (eid-scoped, BV via `selectBalaViharEnrollment`), roster chip (all-time
  donations vs all active enrollments, live tier recompute), donations
  report (snapshot/override only, no live recompute). Legacy RTDB payment
  status is consulted by family-facing pages only.
- The weekly unpaid-family reminder is gated by
  `WEEKLY_REMINDER_CRON_ENABLED` (not set anywhere); it reads the legacy
  RTDB roster's payment column, not Setu donations.
- **Crons** (`/api/cron/*`) export both `GET` (how Vercel cron invokes —
  it auto-sends `Authorization: Bearer $CRON_SECRET`) and `POST` (manual
  trigger). All three schedules are ≤ once/day, so they're valid on the
  Vercel **Hobby/free** plan (limits: 100 jobs, once-per-day min, ±59 min
  precision). The weekly payment reminder is still env-gated off
  (`WEEKLY_REMINDER_CRON_ENABLED`) and is a legacy check-in feature.
- Flag: `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` (in `turbo.json`) gates the
  form and the checkout route; donations are live behind it in UAT.
- Test coverage: solid unit/route tests (floor enforcement, fee math,
  manager-only, report aggregation, schemas) + `enroll-wording.spec.ts`
  copy checks — but **no Playwright E2E exercises the donate flow** (even
  up to the Stripe redirect). Known gap, same bucket as seva.

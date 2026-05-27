# Slice 3 — Donations Checkout + CRA Tax Receipts (Design)

**Date:** 2026-05-26
**Status:** Design — pending review
**Owner:** CMT Developer
**Related:** [2026 redesign brief](./2026-05-16-portal-2026-redesign-brief.md) · [Slice 2 design](./2026-05-22-slice-2-setu-auth-family-api-design.md) · [Slice 2 plan](../plans/2026-05-22-slice-2-setu-auth-family-api.md)

---

## 1. Goal

Make the v3 donation prototypes (`/family/enroll`, `/family/donate`, `/family/donations`) **functional**. After this slice, a real family can:

1. See their **Bala Vihar enrollment status** + the suggested donation amount locked to the period they first attended.
2. **Enroll** in Bala Vihar (idempotent — also auto-triggered by first attendance under Slice 4).
3. **Donate** via Stripe card, Interac e-Transfer (manual reconciliation), or cheque (manual reconciliation).
4. **Receive a CRA-compliant tax receipt PDF** by email immediately after payment confirms.
5. **Browse + re-download** every past receipt from `/family/donations`, year-grouped.

Admins (welcome-team superset) can configure **donation periods** per program × location at `/admin/donation-periods`.

The visual layer is done (with stub data + "Coming soon" banners). This slice replaces the banners and stubs with real payment + receipt infrastructure.

## 2. Out of scope

Explicitly NOT in this slice — each becomes its own follow-up:

- **Recurring / monthly donations** (Stripe Subscriptions). MVP is one-time donations only. Recurring is a follow-up if demand materialises.
- **Refunds / receipt voids.** Refunds are rare for charity donations and complicate CRA accounting. Out-of-band manual process via Stripe Dashboard + a separate `void-receipt` admin action; not a self-serve family flow.
- **Tribute / "in memory of" donations.** Single donor → single family → single program in v1.
- **Designated-fund picking** (building fund vs scholarship fund vs general). All Slice 3 donations route to the **Bala Vihar program fund** for the enrolled period. Multi-fund picking is a follow-up.
- **Donations from non-portal users** (lapsed members, well-wishers). Slice 3 requires a signed-in family. A public `/give` landing for outside donors is a separate slice.
- **Apple Pay / Google Pay.** Stripe supports them with one extra flag; deferred to a polish pass once card flow is proven.
- **PSP alternatives** (Square, Helcim, PayPal). Stripe-only in v1.
- **Multi-currency.** CAD only — CMT is a Canadian charity issuing CAD receipts.

## 3. Audience

| Role | What they do in Slice 3 |
|---|---|
| **Family manager** | Enroll the family, donate, see receipts |
| **Family member** | See enrollment + donation status (read-only); cannot initiate a donation |
| **Welcome-team** | Mark e-Transfer / cheque donations as received; override suggested amount downward for a specific family ("hardship adjustment") |
| **Admin** | Configure donation periods; void a receipt (rare) |

Teachers do NOT touch donations in Slice 3. Their UI (Slice 4) is read-only of `enrollmentStatus` for roster display.

## 4. ⚠ RESOLVE BEFORE BUILD — decisions only the user can make

Each item has a **recommendation** so we can move fast if you sign off, plus the alternatives. Marked `RBB-N` so we can reference them in PR descriptions.

### RBB-1 — Stripe account ownership & merchant identity

- **Recommendation:** CMT to create a Stripe account under the charity's legal name (Chinmaya Mission of Toronto / charitable registration #) with a CAD bank account for payouts. Single account, single set of API keys.
- **Why it matters:** receipts must show the legal charity name + registration #. Stripe statement descriptor on the card statement should read "CHINMAYA MISSION TO" or similar (max 22 chars).
- **Alternative:** Stripe Connect with a Standard account if CMT already routes through a parent organisation. Adds complexity; only do this if there's an actual structural reason.
- **Action:** confirm Stripe account exists, share the publishable + restricted secret keys via `vercel env add` (never paste in PRs).

### RBB-2 — CRA charity registration number

- **Recommendation:** hardcode in `apps/portal/src/lib/charity.ts` as a single source of truth used by both the receipt PDF and the receipts page footer.
- **Why it matters:** CRA requires "Canadian charity registration number" on every receipt over $20. Format: `BN/RR0001`-style, e.g. `123456789 RR0001`.
- **Action:** share the exact registration number string.

### RBB-3 — Receipt numbering scheme

- **Recommendation:** `CMT-{YYYY}-{seq}` where `seq` is a fiscal-year monotonic counter (zero-padded to 5). Reset to 1 each January 1.
  - Example: `CMT-2026-00001`
- **Why it matters:** CRA requires **unique, sequential, non-repeating** numbers. Implementation needs an atomic counter (Firestore transaction or distributed-counter pattern).
- **Alternatives:** monotonic across all years (`CMT-00012345`), or Stripe charge id (ugly + not human-readable).
- **Action:** confirm the format. Also confirm fiscal year = calendar year for CMT (not e.g. April-to-March).

### RBB-4 — Per-donation receipts vs annual rollup

- **Recommendation:** **Per-donation, emailed immediately** on payment confirmation. Annual rollup is a separate "Annual giving statement" PDF generated each January, additive — does NOT replace per-donation receipts.
- **Why it matters:** CRA allows either. Per-donation is operationally simpler (one receipt = one transaction = easy to void). Annual rollup means the donor receives a single PDF in January covering the whole year — better for donors but harder to amend.
- **Action:** confirm per-donation is OK; we'll add annual statements in a polish slice.

### RBB-5 — Donor address on receipt

- **Recommendation:** add a **mailing-address fieldset** to the donate form, prefilled from the family record (collected once and cached on `families/{fid}.mailingAddress`). Required for donations ≥ $20 (CRA rule). Below $20, address is optional. Form shows the address inline-editable with an "Update mailing address" affordance.
- **Why it matters:** CRA requires donor name + address on receipts over $20. Slice 2 collects neither. We need to capture this on first donation, store it on the family record, reuse it on subsequent donations.
- **Action:** confirm the field set (street, unit, city, province, postal, country=Canada). Confirm whether email-address-only is acceptable for under-$20 (CRA says: name only is fine under $20).

### RBB-6 — e-Transfer & cheque reconciliation

- **Recommendation:** **Pledge then confirm.**
  1. Family selects e-Transfer / cheque on `/family/donate` → portal creates a `donation` doc with `status: 'pledged'` + instructions on screen + emailed.
  2. They send the e-Transfer to `donations@chinmayatoronto.org` (existing CMT inbox) or drop a cheque at the lobby.
  3. Welcome-team sees pledged donations on `/welcome/donations/pledged` and clicks "Mark received" once funds arrive → status flips to `confirmed`, receipt generated and emailed.
  4. Pledges expire after **30 days** (configurable). Expired pledges auto-archive but do NOT email the donor (avoid nagging — they can re-pledge any time).
- **Alternative:** auto-parse the Interac email confirmation that lands in `donations@chinmayatoronto.org`. Better long-term but a separate slice (needs IMAP / Gmail API integration + parsing rules).
- **Action:** confirm the manual-reconciliation flow, plus the 30-day pledge TTL.

### RBB-7 — Hardship "donate less than suggested" path

- **Recommendation:** **Welcome-team-only override.** The family CAN donate any amount above the suggested via the donate form (the input is unbounded upward). To donate below the suggested, they must contact welcome-team — who can apply a per-family `donationOverride` on the enrollment record (Firestore `enrollments/{eid}.suggestedAmountOverride`). Once set, the donate form shows the overridden amount as the new suggested.
- **Why it matters:** prototype copy already says "Lowering is possible only by contacting the welcome team" — we want to keep that humanity (no anonymous "I can't afford it" form) without making people feel stigmatised.
- **Action:** confirm. The override field surfaces in the welcome-team family-detail view.

### RBB-8 — Tax receipt PDF generation library

- **Recommendation:** **`@react-pdf/renderer`** — pure JS, runs in Node, ships under 500KB, lets us write the receipt as a React component (easy theming + maintenance). No headless browser, no native deps, works on Vercel out-of-the-box.
- **Alternatives considered:**
  - **Puppeteer / Playwright** — heavy (200MB+), slow cold-start on Vercel Functions, overkill for a 1-page invoice-style PDF.
  - **PDFKit** — works but lower-level (you draw shapes/text, not declarative).
  - **HTML-to-PDF via an external service** (DocRaptor, PDFShift) — fast but adds a third-party dependency for something we can do in-process.
- **Action:** confirm `@react-pdf/renderer`. I'll prototype the receipt layout in a `packages/ui/receipts/` module (this is one of the rare cases for a shared package — both portal + future mobile app may need to render the same PDF, though mobile is unlikely so this could equally live in-app).

### RBB-9 — Receipt PDF storage

- **Recommendation:** **Generate on demand, store in Firebase Storage.** On payment confirmation, generate the PDF, upload to `gs://chinmaya-setu-uat.appspot.com/receipts/{fid}/{receiptNo}.pdf` (path-keyed by fid for clean access rules), store a signed URL with 7-day expiry on the `donation` doc. Re-generation possible at any time from the source data on the donation doc.
- **Alternative:** generate on every download request (no storage). Simpler but each download burns CPU + the receipt PDF *must* be byte-identical across downloads (CRA might audit). Pre-generating + caching keeps the signed-and-issued artifact immutable.
- **Action:** confirm Firebase Storage. UAT bucket already exists; prod needs a `donations-rcpt` bucket or path namespace.

### RBB-10 — Authorised officer signature on receipt

- **Recommendation:** **PNG signature image** stored at `packages/ui/src/assets/charity-signature.png` (committed to repo, ~30KB). Embedded in the PDF as a static asset. CRA accepts a facsimile signature.
- **Alternative:** typed name + "(authorised officer)" with no graphic. Legal but less professional-looking.
- **Action:** share a PNG of the authorised officer's signature (President of CMT, or whoever's name appears on the existing paper receipts).

---

Defaults assumed below (override during review):

| RBB | Default assumed |
|---|---|
| 1 | Stripe single-account, CAD payouts |
| 2 | Hardcoded in `lib/charity.ts` |
| 3 | `CMT-{YYYY}-{5-digit-seq}`, calendar fiscal year |
| 4 | Per-donation immediate |
| 5 | Inline mailing-address fieldset, family-cached |
| 6 | Pledge → welcome-team "mark received", 30-day TTL |
| 7 | Welcome-team override field on enrollment |
| 8 | `@react-pdf/renderer` |
| 9 | Firebase Storage, signed URLs, 7-day expiry |
| 10 | PNG facsimile signature, repo-committed |

## 5. Data model — Firestore

Slice 3 adds three new top-level collections + a sub-collection. All under the existing `PORTAL_FIREBASE_PROJECT_ID`.

### 5.1 `donationPeriods/{pid}`

Admin-configured donation periods. One per program × location × semester. Multiple periods can be **active simultaneously** (e.g. Fall + Winter overlap during the December break).

```ts
type DonationPeriodDoc = {
  pid: string;                            // generated, e.g. "bv-brampton-fall-2026"
  programKey: 'bala-vihar';               // extensible — but Bala Vihar only at launch
  programLabel: 'Bala Vihar';
  location: 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
  periodLabel: string;                    // "Fall 2026", "Spring 2027"
  startDate: Timestamp;                   // inclusive, midnight Toronto local
  endDate: Timestamp;                     // inclusive, 23:59:59 Toronto local
  suggestedAmount: number;                // CAD, integer dollars (e.g. 500)
  amountTiers: number[];                  // [500, 750, 1000, 1500] — UI chip presets
  enabled: boolean;                       // admin toggle; disabled periods stay readable but no new enrollments
  createdAt: Timestamp;
  createdBy: string;                      // admin uid
  updatedAt: Timestamp;
  updatedBy: string;
};
```

### 5.2 `families/{fid}/enrollments/{eid}`

A family's enrollment in a specific donation period. Sub-collection under `families/` so a family's enrollments are co-located with the family record.

```ts
type EnrollmentDoc = {
  eid: string;                            // `{fid}-{pid}` — composite, so it's idempotent
  fid: string;
  pid: string;                            // → donationPeriods/{pid}
  programLabel: string;                   // snapshot at enrollment time
  periodLabel: string;
  location: string;
  enrolledAt: Timestamp;                  // when the family enrolled (or attended-and-auto-enrolled)
  enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team';
  enrolledByMid: string | null;           // null for first-attendance auto-enroll
  childrenMids: string[];                 // which children are in the class (denormalised for fast roster reads)
  suggestedAmountSnapshot: number;        // copy at enrollment time — period rate could later change, this stays pinned
  suggestedAmountOverride: number | null; // welcome-team set; null = use snapshot
  status: 'active' | 'cancelled';
  cancelledAt: Timestamp | null;
  cancelledReason: string | null;
};
```

**Key invariant: pricing snapshot.** Once enrolled, the family's "suggested amount" is `override ?? snapshot`. Even if admin later edits the period's `suggestedAmount`, this family's snapshot stays — locked at the moment they enrolled (matching the brief's "donation intent locked at first attendance" rule).

### 5.3 `donations/{did}`

Top-level — easier to query across families for admin reports.

```ts
type DonationDoc = {
  did: string;                            // generated, e.g. `don_${nanoid(12)}`
  fid: string;
  donorMid: string;                       // which member initiated (audit trail)
  donorName: string;                      // snapshot — receipt uses this
  donorEmail: string;                     // snapshot
  donorMailingAddress: PostalAddress;     // snapshot — needed for CRA receipt
  programKey: 'bala-vihar';
  programLabel: string;
  periodLabel: string;
  pid: string;                            // → donationPeriods
  eid: string | null;                     // → enrollments — null for non-enrollment donations (general giving)
  amountCents: number;                    // store in cents; CAD
  amountCAD: number;                      // mirror for read-ability — single source of truth is cents
  method: 'card' | 'etransfer' | 'cheque';
  status: 'pledged' | 'processing' | 'confirmed' | 'failed' | 'voided';
  // Stripe-specific
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  // Manual reconciliation
  pledgedAt: Timestamp;
  confirmedAt: Timestamp | null;
  confirmedByUid: string | null;          // welcome-team uid for manual confirmations
  expiresAt: Timestamp | null;            // for pledged status — auto-archive deadline
  // Receipt
  receiptNo: string | null;               // assigned at status=confirmed
  receiptIssuedAt: Timestamp | null;
  receiptPdfPath: string | null;          // gs:// path to the stored PDF
  receiptVoidedAt: Timestamp | null;
  receiptVoidedBy: string | null;
  receiptVoidReason: string | null;
  // Audit
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type PostalAddress = {
  line1: string;
  line2: string | null;
  city: string;
  province: string;                       // 2-letter (ON, BC, …)
  postalCode: string;                     // formatted "M1M 1M1"
  country: 'Canada';                      // hardcoded for now
};
```

### 5.4 `receiptCounters/{YYYY}`

Atomic counter for receipt numbering. One doc per fiscal year.

```ts
type ReceiptCounterDoc = {
  year: number;                           // 2026
  nextSeq: number;                        // next number to issue (starts at 1)
  updatedAt: Timestamp;
};
```

Receipt issuance does `runTransaction(db, async tx => { /* read, increment, write, return `CMT-${year}-${seq.padStart(5)}` */ })`. Firestore transactions guarantee no duplicates.

### 5.5 Composite indexes

Add to `firestore.indexes.json`:

| Collection | Fields | Used by |
|---|---|---|
| `donations` | `fid` ASC, `createdAt` DESC | family receipts page (`/family/donations`) |
| `donations` | `fid` ASC, `status` ASC, `createdAt` DESC | filtering by status in admin |
| `donations` | `status` ASC, `pledgedAt` ASC | welcome-team pledged queue + auto-archive cron |
| `donations` | `programKey` ASC, `periodLabel` ASC, `confirmedAt` DESC | admin period reports |
| `donationPeriods` | `programKey` ASC, `location` ASC, `enabled` ASC, `startDate` DESC | admin list + family-side period resolution |
| `families/{fid}/enrollments` | `status` ASC, `enrolledAt` DESC | family dashboard |

**Deployment:** UAT (`chinmaya-setu-uat`) only — production is read-only from this repo until kiosk cutover (per `CLAUDE.md`).

## 6. Donation periods — admin surface

Per §6.5.1 of the brief. A simple table-based admin UI at `/admin/donation-periods`.

### 6.1 UI

| Column | Type | Notes |
|---|---|---|
| Program | Select (Bala Vihar only at launch) | extensible |
| Location | Select | Brampton / Mississauga / Scarborough / Markham |
| Period label | Text | "Fall 2026" |
| Start / End date | Date pickers | midnight Toronto inclusive |
| Suggested $ | Number input | integer dollars |
| Tiers (comma-sep) | Text | "500, 750, 1000, 1500" |
| Enabled | Toggle |  |
| Actions | Edit / Disable | no hard delete; disable instead |

### 6.2 Endpoints

| Method | Path | Auth |
|---|---|---|
| GET | `/api/admin/donation-periods` | admin |
| POST | `/api/admin/donation-periods` | admin |
| PATCH | `/api/admin/donation-periods/:pid` | admin |

**No DELETE.** A period that's been enrolled into must stay readable forever (enrollments + donations reference it by `pid`). Disable via `enabled: false`. Hard-delete is a manual Firestore operation only.

### 6.3 Validation

- `suggestedAmount` ≥ 1 CAD, integer.
- `amountTiers` must contain at least one entry; first tier should equal `suggestedAmount` (UI convention — the "suggested" chip is the first).
- `endDate` > `startDate`.
- Overlap warning (non-blocking): if a new period for the same (program, location) overlaps an enabled period, surface a warning toast but allow save. Multiple active periods is a legitimate state.

## 7. Enrollment flow

### 7.1 Family-initiated (from `/family/enroll`)

1. Server reads the current family's location, looks up the **active enabled period** for `(programKey=bala-vihar, location=family.location)` with `now ∈ [start, end]`.
   - If multiple match (rare — overlapping fall/winter), pick the one with the **latest** `startDate`.
   - If none match, render a friendly "No active Bala Vihar period for {location} right now — check back next semester" empty state.
2. If a period exists, render the "Enroll & donate" card. CTA → `POST /api/setu/enrollments` with `{ pid }`.
3. Server (transaction):
   - Verify the period exists, is enabled, is current.
   - `eid = {fid}-{pid}`. If `families/{fid}/enrollments/{eid}` already exists with `status: 'active'`, return 200 idempotent (re-enrollment is a no-op).
   - Create the enrollment doc with `suggestedAmountSnapshot = period.suggestedAmount`.
   - `childrenMids` = members of the family with `type === 'Child'` (best-effort; the welcome-team can edit later).
4. Response includes `{ eid, suggestedAmount, donateUrl: '/family/donate?eid={eid}' }`.

### 7.2 First-attendance auto-enroll (triggered from Slice 4)

When a teacher marks a child present in `take attendance` and the child's family has no active enrollment for the current period, Slice 4 will call an internal `enrollFamilyOnFirstAttendance({ fid, pid, markedByTeacherUid })` server function. Same transaction shape as 7.1 with `enrolledVia: 'first-attendance'`. Slice 3 exports this helper; Slice 4 wires the call site.

### 7.3 Welcome-team enroll-on-behalf

`POST /api/welcome/enrollments` body `{ fid, pid }` — welcome-team can enroll a family they're helping at the lobby kiosk. Identical transaction with `enrolledVia: 'welcome-team'`, `enrolledByMid: null` (the welcome team isn't a family member).

## 8. Donation checkout flow

The unified entry point is `/family/donate` (or `/family/donate?eid=…` for an enrollment-bound donation). The page already exists as a prototype; Slice 3 wires it.

### 8.1 Form state machine

```
[idle] → [amount-entry] → [payment-method] → [confirm] → [processing]
                                                     ↓
                              ┌─ card ───→ Stripe Checkout → success/cancel
                              ├─ etransfer → instructions screen + pledge created
                              └─ cheque → instructions screen + pledge created
```

Single-page client state — no multi-step routes — using sections that scroll into view. Mobile collapses to a single column; desktop uses the prototype's 1fr/380px split.

### 8.2 Server-side preparation

`POST /api/setu/donations/intent` — auth-gated, manager-only.

Body:
```ts
{
  amountCAD: number;                       // integer dollars from the form
  method: 'card' | 'etransfer' | 'cheque';
  eid: string | null;                      // optional — null = general giving (not v1, but reserve the field)
  mailingAddress: PostalAddress;           // collected from the form
}
```

Server:
1. Validate (zod schema in `packages/shared-domain/src/setu/donation.ts`).
2. Resolve the family + enrollment + period to compute `programLabel`, `periodLabel`, `pid`.
3. Compute `suggestedAmount = enrollment.suggestedAmountOverride ?? enrollment.suggestedAmountSnapshot`. Enforce `amountCAD >= suggestedAmount` — return `400 amount-below-suggested` if violated. (Welcome-team override is the only path below suggested; manager UI hides this case.)
4. If `mailingAddress` differs from `families/{fid}.mailingAddress`, update it (single-write upsert).
5. Create `donations/{did}` with `status: 'pledged'`, `amountCents`, snapshot fields.
6. **Method-specific:**
   - `card`: create Stripe `PaymentIntent` (`amount: amountCents`, `currency: 'cad'`, `metadata: { did, fid }`). Patch `donations/{did}.stripePaymentIntentId`. Return `{ did, clientSecret }` for the client to confirm via Stripe.js.
   - `etransfer`: return `{ did, etransferInstructions: { to: 'donations@chinmayatoronto.org', memo: did, expiresAt } }`.
   - `cheque`: return `{ did, chequeInstructions: { payableTo: 'Chinmaya Mission of Toronto', memo: did, dropAtLobby: 'Sunday at the Brampton centre' } }`.
7. Send a confirmation email (`donation-pledged-email` template) — both for pledges and as a fallback for card flows that complete on a different device.

### 8.3 Stripe confirmation — webhook

Stripe doesn't trust the client. Source of truth for `status: 'confirmed'` is the webhook:

`POST /api/webhooks/stripe`

- Signature-verified using `STRIPE_WEBHOOK_SECRET` (env var, set per env).
- Handles three events for v1:
  - `payment_intent.succeeded` → look up `donations/{metadata.did}`, set `status: 'confirmed'`, `confirmedAt: now`, `stripeChargeId: pi.latest_charge`, trigger receipt issuance (§9).
  - `payment_intent.payment_failed` → set `status: 'failed'`. Email the donor "your payment didn't go through" with a re-try link.
  - `charge.refunded` → set `receiptVoidedAt`, `receiptVoidReason: 'refund'`. Receipt voiding is a separate manual step normally, but a Stripe-initiated refund implies the receipt is no longer valid.
- All other events 200 (acknowledged but not processed).
- **Idempotency:** Firestore transaction reads the donation doc; if already `confirmed`, no-op. Stripe will retry on 5xx, so we accept the same event multiple times safely.

### 8.4 e-Transfer / cheque confirmation — welcome-team UI

At `/welcome/donations/pledged`:

- Table of pledged donations: family, amount, method, pledged-at, expires-at, memo.
- Row action "Mark received" → `POST /api/welcome/donations/:did/confirm` with optional `{ receivedAt }` (defaults to now).
- Server: verifies caller is welcome-team. Flips `status: 'confirmed'`, sets `confirmedAt`, `confirmedByUid`. Triggers receipt issuance (§9). Sends donation-thank-you email (already exists as a stub template, to be expanded).

### 8.5 Pledge auto-archive

Vercel Cron (`vercel.ts` declaration):

```ts
{ path: '/api/cron/archive-pledges', schedule: '0 4 * * *' }   // daily 4am UTC
```

Finds donations with `status: 'pledged'` AND `expiresAt < now`, sets `status: 'failed'` with a `pledgeExpired: true` flag. Does NOT email the donor (avoid nagging). They can re-pledge any time.

## 9. Tax receipt PDF generation

Triggered when a donation transitions `status: 'pledged' → 'confirmed'` (any method).

### 9.1 Issuance flow

1. Increment `receiptCounters/{currentYear}.nextSeq` atomically; derive `receiptNo` = `CMT-{YYYY}-{seq:05}`.
2. Compose PDF via `@react-pdf/renderer` in `packages/ui/src/receipts/TaxReceipt.tsx`. Inputs:
   - Donor name + mailing address (snapshot on `donation`)
   - Donation amount + date received (= `confirmedAt`)
   - Receipt number + date issued (= now)
   - Charity name + registration number + address (from `lib/charity.ts`)
   - Authorised officer signature (PNG, embedded)
   - Pre-filled "**Eligible amount: $X**" — for unconditional cash gifts this equals the donation amount. (Advantage-aware receipting is out of scope; we don't sell tickets or auction items in Slice 3.)
3. Upload PDF to Firebase Storage at `receipts/{fid}/{receiptNo}.pdf`.
4. Generate a signed URL with 7-day expiry; cache on `donations/{did}.receiptPdfPath`.
5. Update `donations/{did}` with `receiptNo`, `receiptIssuedAt`, `receiptPdfPath`.
6. Email the donor via SES — body has a "Download your tax receipt (PDF)" CTA pointing to the signed URL, plus the receipt embedded as an attachment. Subject `Your tax receipt — Chinmaya Mission Toronto`.

### 9.2 Re-download

`GET /api/setu/donations/:did/receipt` — auth-gated, must be a manager of the donating family.

- Reads `donations/{did}`.
- If `receiptPdfPath` exists, generate a fresh signed URL (7-day expiry) and 302 redirect to it.
- If the file has been deleted (unlikely — we don't delete) or expired (signed URLs are time-limited, not the file), re-generate from source by re-running the PDF composer with the donation's snapshot fields. Receipt number stays the same; date issued stays the same. **The PDF must be byte-identical** to the original — same data in, same PDF out. We pin `@react-pdf/renderer` and fix the timestamp embedded in the PDF metadata to `receiptIssuedAt`.

### 9.3 Voiding a receipt

Out of scope for self-serve. Admin-only action via Firestore Console + an internal CLI script `apps/portal/scripts/void-receipt.ts` that:

1. Sets `receiptVoidedAt`, `receiptVoidedBy`, `receiptVoidReason` on the donation.
2. Optionally regenerates the PDF with a "VOID" watermark for record-keeping.
3. Emails the donor a "we've voided receipt CMT-2026-00123 due to ${reason}. The replacement receipt will follow separately" notice.

Voided receipts still appear on `/family/donations` but with a "Voided" badge.

## 10. Receipts UI

### 10.1 Family — `/family/donations`

Already prototyped. Slice 3 swap-ins:

- Year-tile totals: real sums from `donations` where `fid = current` and `status = 'confirmed'` and `confirmedAt` falls in that calendar year.
- Year-grouped list rows: from the same query.
- "Receipt PDF" button on each row: `<Link href={`/api/setu/donations/${did}/receipt`} target="_blank">` — server re-signs the URL.
- "Download all (YYYY)" button: ZIPs the year's PDFs server-side. New endpoint `GET /api/setu/donations/zip?year=YYYY`. Use `jszip` (already common in the ecosystem; ~30KB).
- Statuses surface as badges: confirmed (no badge), pledged (yellow "Pending"), failed (grey "Expired"), voided (red "Voided").

### 10.2 Welcome-team — `/welcome/donations`

Two tabs:

- **Pledged** — manual reconciliation queue (table from §8.4).
- **All** — searchable list across all families, columns: family, amount, method, status, date.

Both read-only except for the "Mark received" action on pledged rows.

### 10.3 Admin — `/admin/donations`

Reuses `/welcome/donations` UI (welcome-team is a subset of admin). Admin gets one extra column: "Void receipt" action (links to a confirm dialog that warns voiding is non-reversible).

## 11. Endpoint inventory

All under `/api/setu/*` for family-facing, `/api/welcome/*` for welcome-team, `/api/admin/*` for admin, `/api/webhooks/*` for external.

| Method | Path | Auth |
|---|---|---|
| GET | `/api/setu/enrollments` | family (any role) |
| POST | `/api/setu/enrollments` | family-manager |
| DELETE | `/api/setu/enrollments/:eid` | family-manager (rarely used; sets `status: 'cancelled'`) |
| POST | `/api/setu/donations/intent` | family-manager |
| GET | `/api/setu/donations` | family (read own family's) |
| GET | `/api/setu/donations/:did/receipt` | family (own family only) |
| GET | `/api/setu/donations/zip?year=YYYY` | family (own family only) |
| POST | `/api/webhooks/stripe` | Stripe signature |
| POST | `/api/welcome/donations/:did/confirm` | welcome-team |
| GET | `/api/welcome/donations` | welcome-team |
| POST | `/api/welcome/enrollments` | welcome-team |
| PATCH | `/api/welcome/enrollments/:eid/override` | welcome-team |
| GET | `/api/admin/donation-periods` | admin |
| POST | `/api/admin/donation-periods` | admin |
| PATCH | `/api/admin/donation-periods/:pid` | admin |
| GET | `/api/admin/donations` | admin |
| GET | `/api/cron/archive-pledges` | Vercel Cron header |

`canAccessRoute` in `packages/shared-domain/src/auth/public-routes.ts` updated to gate each path. Webhook + cron paths are public but signature-verified at the handler level.

## 12. Frontend wiring — per-route changes

| Route | Today (prototype) | After Slice 3 |
|---|---|---|
| `/family/enroll` | Static "Enroll & donate" CTA, no backing data | Reads `GET /api/setu/enrollments` + active period for family location. Shows real suggested amount. CTA hits `POST /api/setu/enrollments`. |
| `/family/donate` | Static $500, disabled CTA, "Coming soon" banner | Real form: amount input + tiers from period, mailing-address fieldset, payment-method picker, Stripe Elements card form on card path. Submit → `POST /api/setu/donations/intent` → Stripe.js confirm OR pledge instructions screen. |
| `/family/donations` | Stub year totals, disabled PDF buttons | Real year totals from `GET /api/setu/donations`. Working PDF download per row. ZIP download per year. Status badges. |
| `/family` (dashboard) | Stub "Donation status" card | Reads the family's active enrollment + most-recent donation. Card states: "Not enrolled" / "Enrolled · suggested $X" / "Donated $X · receipt sent" / "Pledged · awaiting confirmation". |
| `/admin/donation-periods` | Doesn't exist | New page (admin-only). Table + create/edit modal per §6. |
| `/welcome/donations/pledged` | Doesn't exist | New page (welcome-team). Manual-reconciliation queue. |
| `/admin/donations` | Doesn't exist | New page (admin). Cross-family donation list. |

## 13. Middleware changes

`apps/portal/src/middleware.ts` + `packages/shared-domain/src/auth/public-routes.ts`:

1. Add `/api/webhooks/stripe` to `PUBLIC_ROUTES` (Stripe signs the request body — no session).
2. Add `/api/cron/archive-pledges` to `PUBLIC_ROUTES` (Vercel Cron sends an `Authorization: Bearer ${CRON_SECRET}` header which the handler verifies).
3. `canAccessRoute` updates:
   - `/api/setu/donations/*` + `/api/setu/enrollments/*` — `family-manager` + `family-member` (members get read; managers get write).
   - `/api/welcome/donations/*` + `/api/welcome/enrollments/*` — `welcome-team` + `admin`.
   - `/api/admin/donation-periods/*` + `/api/admin/donations` — `admin` only.
4. Update `/family/donate` + `/family/enroll` + `/family/donations` from being publicly reachable prototypes to being session-gated (they're currently public so the visual prototypes work — Slice 3 removes that).

## 14. Env vars

Add to `apps/portal/src/lib/env.ts`:

```ts
// Stripe
STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),                 // mirrored as NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY for client
STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),

// Receipt storage
RECEIPTS_BUCKET: z.string().default('chinmaya-setu-uat.appspot.com'), // overridden in prod env
RECEIPT_SIGNED_URL_TTL_MIN: z.coerce.number().int().min(5).max(60 * 24 * 7).default(60 * 24 * 7),

// Donation pledge expiry
SETU_PLEDGE_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(30),

// Cron auth
CRON_SECRET: z.string().min(32),

// Feature flag — keep until donations is announced (Slice 2 + 3 + 4 all green)
NEXT_PUBLIC_FEATURE_SETU_DONATIONS: flagString,
```

Mirror `STRIPE_PUBLISHABLE_KEY` as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for the client bundle (per `feedback_next_public_static_inline.md` — inline `process.env.NEXT_PUBLIC_*` access only, never via a helper).

Add all server-side keys to `turbo.json` `env` array (per `feedback_turbo_env_passthroughs.md`).

## 15. Sub-slice breakdown

Six sub-slices, sequenced. Each merges to `main` behind `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=false` until the whole slice is UAT-soaked.

### 3a — Donation periods + admin UI (2-3 days)

- Firestore: `donationPeriods/` collection + indexes.
- Zod schemas in `packages/shared-domain/src/setu/donation.ts`.
- Endpoints: GET/POST/PATCH `/api/admin/donation-periods`.
- New page `/admin/donation-periods` with table + create/edit modal.
- Seed script: `apps/portal/scripts/seed-donation-periods.ts` — populates the current Brampton/Mississauga periods for go-live.
- Tests: validation (overlap warning, date ordering, suggested amount positive), admin-only enforcement.

### 3b — Enrollment workflow (2 days)

- Firestore: `families/{fid}/enrollments/` subcollection + index.
- Endpoints: `GET/POST/DELETE /api/setu/enrollments`, `POST /api/welcome/enrollments`, `PATCH /api/welcome/enrollments/:eid/override`.
- Wire `/family/enroll` to real data; render no-active-period empty state.
- Server helper `enrollFamilyOnFirstAttendance({ fid, pid, … })` exported for Slice 4 to call (no UI wire-up yet).
- Tests: enrollment idempotency, override path, snapshot-after-period-edit invariant.

### 3c — Stripe checkout (4-5 days, biggest sub-slice)

- Install `stripe` (server) + `@stripe/stripe-js` + `@stripe/react-stripe-js` (client).
- Endpoint `POST /api/setu/donations/intent` (creates PaymentIntent for card, pledge for etransfer/cheque).
- Endpoint `POST /api/webhooks/stripe` (signature-verified, handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`).
- Wire `/family/donate` form: tiers + amount + mailing address + payment-method picker + Stripe Elements for card path.
- Set up Stripe test mode in UAT; webhook endpoint configured in Stripe Dashboard pointing at the UAT preview URL.
- Tests: PaymentIntent creation, webhook signature verification, idempotent re-processing, amount-below-suggested rejection.
- **Mock-free walkthrough required** (per `feedback_walk_the_full_user_flow_before_declaring_done.md`): actual test card → webhook → donation `confirmed` → email sent.

### 3d — Manual reconciliation (e-Transfer + cheque) (2 days)

- Endpoints: `POST /api/welcome/donations/:did/confirm`, `GET /api/welcome/donations`.
- New page `/welcome/donations/pledged` (table + "Mark received" action).
- Vercel Cron `/api/cron/archive-pledges` + `vercel.ts` declaration.
- Tests: welcome-team-only enforcement, pledge → confirmed transition, auto-archive.

### 3e — Tax receipt PDFs + email (3 days)

- Install `@react-pdf/renderer`.
- New `packages/ui/src/receipts/TaxReceipt.tsx` — the receipt React component.
- `lib/charity.ts` — registration #, address, signature image (placeholder for real signature).
- `receiptCounters/{YYYY}` atomic counter + `issueReceipt(donationId)` server function.
- Firebase Storage upload + signed URL helper.
- Endpoint `GET /api/setu/donations/:did/receipt` (re-sign + redirect).
- Endpoint `GET /api/setu/donations/zip?year=YYYY` (jszip).
- SES `donation-receipt-email` template (replaces / extends the existing thank-you stub).
- Wire `/family/donations` page: real totals, real PDF buttons, ZIP download.
- Tests: receipt-number uniqueness under concurrent issuance, byte-identical regeneration, signed-URL expiry handling.
- **Mock-free walkthrough**: open the actual PDF in a viewer, check CRA-required fields are present.

### 3f — Dashboard surfaces + cutover (1-2 days)

- `/family` dashboard "Donation status" card real wiring.
- `/admin/donations` cross-family list.
- Flag `NEXT_PUBLIC_FEATURE_SETU_DONATIONS=true` in UAT.
- Documentation: `docs/superpowers/specs/2026-XX-stripe-prod-runbook.md` — pre-go-live checklist (Stripe live keys, webhook endpoint, charity registration in `lib/charity.ts`, signature image, receipt counter starting seq).
- Tests: dashboard card states, admin role enforcement.

### Total estimate

**~14-17 days of focused work.** Comparable to Slice 2 in scope. The biggest sub-slice (3c, Stripe) takes a chunk because the mock-free walkthrough is non-negotiable here — actual money + actual receipts + actual CRA compliance.

## 16. Risks & tradeoffs

| Risk | Severity | Mitigation |
|---|---|---|
| **CRA non-compliance on receipts** (missing fields, wrong format, duplicate numbers) | HIGH | Implement to CRA spec by-the-book; sample receipt PDF reviewed by an actual accountant before go-live. Atomic receipt counter via Firestore transaction. |
| **Stripe webhook missed / out-of-order** | MEDIUM | Idempotent handler keyed on `paymentIntent.id`; Stripe's automatic retry covers transient 5xx. Monitor webhook delivery in Stripe Dashboard. |
| **Donation amount tampered client-side** | HIGH | Server re-reads enrollment + period from Firestore and validates `amountCAD >= suggestedAmount`. Stripe PaymentIntent created with the server-computed amount (the client only confirms). |
| **e-Transfer "received" marked in error** | LOW | Welcome-team-only action with audit trail (`confirmedByUid`, `confirmedAt`). Voidable. |
| **Receipt PDF rendering changes after Stripe version bump** | MEDIUM | Pin `@react-pdf/renderer` exact version. Snapshot-test rendered PDF bytes for one canonical donation. CI catches drift. |
| **Stripe API key leakage** | HIGH | Server-only `STRIPE_SECRET_KEY`, never NEXT_PUBLIC. Publishable key is safe to expose (Stripe design). Webhook secret + cron secret similarly server-only. |
| **Donor mailing-address collected but not encrypted** | LOW | Firestore is encrypted at rest (Google-managed). Don't display in UI beyond the donor's own family + welcome-team. Don't include in logs. |
| **Period overlap creates donation routing ambiguity** | LOW | Resolution rule is "latest `startDate` wins" (§7.1). UI warning at period-create time. |
| **Re-generated receipt PDF byte-different from original** | MEDIUM | Pin `@react-pdf/renderer`. Fix PDF creation timestamp to `receiptIssuedAt`. Snapshot-test golden PDF in CI. |
| **Pledged donation never paid** | LOW | 30-day auto-archive. No nag emails. Family can re-pledge. |

## 17. Release strategy

Slice 3 lands incrementally to `main`, gated behind `NEXT_PUBLIC_FEATURE_SETU_DONATIONS`. When all six sub-slices are merged + UAT-soaked + a real test-mode end-to-end is verified:

1. Provision Stripe **live mode** account + keys (RBB-1 settled).
2. Move charity registration number + signature image into prod env (RBB-2, RBB-10).
3. Set receipt counter starting sequence for the current fiscal year (probably `1` — fresh start).
4. Flip flag to `true` in production.
5. **Do NOT announce yet** (per Slice 2 §17). Per the locked release strategy: families don't see donation flows until Slice 4 (teacher + attendance) is also complete and the entire Bala Vihar lifecycle is real end-to-end. Until then donations is reachable-but-unannounced like the rest of Setu.

Production legal pre-flight (RBB-1 through RBB-10 resolved) is the gating event; code-complete is the easy half.

## 18. Test strategy

Per `CLAUDE.md` "Pre-ship verification" — green tests ≠ shipped. Slice 3 verification has three tiers:

### 18.1 Unit + integration (covered by `pnpm test`)

- Zod schema validation (donate intent, period creation, enrollment).
- Server helpers in isolation (receipt counter atomicity, period resolution, enrollment idempotency).
- Mock Stripe + mock SES + mock Firebase Storage.

### 18.2 E2E (`pnpm test:e2e` against UAT Firestore)

- Enrollment round-trip.
- Manual-reconciliation flow (welcome-team confirm).
- Receipt issuance + re-download.
- Webhook signature verification (replay attack rejected).

### 18.3 Mock-free UAT walkthrough (manual, gated on each sub-slice)

- 3a: create a period in admin UI; verify it appears on family-side `/family/enroll`.
- 3b: enroll a family; verify dashboard reflects status.
- 3c: **complete a real Stripe test-mode card payment**; verify webhook fires, donation is `confirmed`, receipt is generated, email arrives in `dineshdm7@gmail.com` (per allowlist). Click the receipt link, open the PDF, **eyeball every CRA-required field**.
- 3d: pledge an e-Transfer; verify pledge entry shows up in welcome-team queue; click "Mark received"; verify receipt is generated.
- 3e: verify the regenerated-receipt-link path actually re-signs; verify the year ZIP downloads and unzips properly.
- 3f: verify dashboard cards show real data; verify admin can see all donations across families.

The walkthrough checklist gets pasted into the final commit's PR description / release note.

## 19. Open questions for review

All ten RBB items in §4. Specifically the user must:

1. Share or create the Stripe account + keys (RBB-1).
2. Share the CRA registration number (RBB-2).
3. Confirm receipt-numbering format + fiscal year (RBB-3, RBB-4).
4. Confirm mailing-address fieldset shape (RBB-5).
5. Confirm pledge-then-confirm flow + 30-day TTL (RBB-6).
6. Confirm welcome-team override path (RBB-7).
7. Sign off on `@react-pdf/renderer` (RBB-8) + Firebase Storage (RBB-9).
8. Provide a signature image (RBB-10).

Sub-slice 3a (admin donation-periods UI) does NOT depend on any of these — it's safe to start while RBBs are being resolved.

## 20. Next step

**Implementation plan:** `docs/superpowers/plans/2026-05-26-slice-3-donations-checkout-receipts.md` — created alongside this design after RBBs are resolved (or at minimum: RBB-1 + RBB-2 + RBB-8 + RBB-10, the four that block code work).

**Suggested kickoff:** start Sub-slice 3a (donation periods) immediately — it's purely internal (admin UI, no payment integration), unblocks Slice 4 teacher/attendance work that needs `pid` to exist, and exercises the Firestore + admin-role layers we'll lean on for the rest of Slice 3.

Ready to execute on your green light + answers to the RBB items.

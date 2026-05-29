# Revision — Donation period = school year + date-tiered pricing

**Date:** 2026-05-29
**Status:** Design revision — supersedes the period/pricing parts of [Slice 3a/3b](./2026-05-26-slice-3-donations-checkout-receipts-design.md). Revises **shipped** code.
**Owner:** CMT Developer

---

## 1. Why

Two facts from CMT (2026-05-29) invalidate the shipped donation-period model:

1. **Bala Vihar is one continuous school year (Sept → June), not two semesters.** The shipped seed split each location into "Fall 2025" + "Winter 2026" periods — wrong. There is **one period per location per school year** (e.g. "Bala Vihar Brampton 2025-26", Sep 7 2025 – Jun 14 2026).
2. **The suggested donation is prorated by when a family enrolls.** Join in September → $500 (full year); Dec/Jan → ~$300; Feb/Mar → less. Admin + welcome-team configure these tiers and amounts from the admin panel. (Confirmed: **auto-pick the tier by enrollment date, with a per-family override** for special cases.)

The shipped model has a single fixed `suggestedAmount` per period — it can't express date-prorated pricing. This revision fixes that before Slice 4 builds on it (Slice 4's first-attendance auto-enroll must snapshot the right amount).

## 2. Period model: school year, one per location

`DonationPeriodDoc` becomes a **school-year** record:
- `periodLabel`: "2025-26" (or "Bala Vihar 2025-26")
- `startDate` / `endDate`: the full year (Sep → Jun)
- one per `(programKey, location)` per school year — no more Fall/Winter split.

`resolveActivePeriod` is unchanged in shape (still picks the enabled period covering `now` for a location) — there's just one to pick now, and it stays active all year.

## 3. Pricing: date-windowed tiers (the core change)

Replace the single `suggestedAmount: number` with an ordered **pricing schedule**:

```ts
type PricingTier = {
  effectiveFrom: string;   // ISO date 'YYYY-MM-DD' — tier applies to enrollments on/after this date
  amountCAD: number;       // suggested donation for families enrolling in this window
  label: string;           // "Full year (from Sept)", "Joined winter", "Joined spring"
};

// on DonationPeriodDoc:
pricingTiers: PricingTier[];   // ordered ascending by effectiveFrom; first = full-year/base
```

**Resolution** (`resolveSuggestedAmount(period, enrollDate)`): pick the **last** tier whose `effectiveFrom <= enrollDate`; if `enrollDate` is before the first tier, use the first (full-year). Pure function in `@cmt/shared-domain`.

Example for Brampton 2025-26:
```
[ { effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' },
  { effectiveFrom: '2025-12-01', amountCAD: 300, label: 'Joined winter' },
  { effectiveFrom: '2026-02-01', amountCAD: 200, label: 'Joined spring' } ]
```
A family enrolling 2026-01-10 → resolves to the Dec tier → **$300**.

### Disambiguating the two "tier" concepts
- **`pricingTiers`** (NEW) — the *join-date schedule* that sets the suggested amount. Drives the snapshot.
- **`amountTiers`** (EXISTING) — the *give-more quick-pick chips* on the donate form ($500/$750/…). Keep, but now they should derive from / start at the resolved suggested amount (a family seeing $300 suggested shouldn't get a $500 chip as "suggested"). Make `amountTiers` optional; if absent, the donate form derives chips from the resolved suggested (×1, ×1.5, ×2).

## 4. Enrollment snapshot change (Slice 3b)

`enroll-family.ts` currently sets `suggestedAmountSnapshot = period.suggestedAmount`. Change to:
```ts
suggestedAmountSnapshot = resolveSuggestedAmount(period, /* enrollment date */ now)
```
The snapshot invariant is unchanged in spirit — the family's amount is pinned at enroll time — it's just resolved from the date-tier instead of a flat field. Welcome-team `suggestedAmountOverride` still wins (RBB-7 from Slice 3, already built).

`enrollFamilyOnFirstAttendance` (the Slice 4 hook) gets the same treatment — the attendance date is the enroll date for tier resolution.

## 5. Admin UI change (Slice 3a)

`/admin/donation-periods`:
- Period row shows the school-year range + the pricing-tier schedule (not a single amount).
- Edit modal: manage the `pricingTiers` list (add/remove rows of `effectiveFrom` date + `amountCAD` + `label`). Validate ascending dates, ≥1 tier, all amounts ≥ 1.
- Welcome-team gains access to adjust tiers too (they already adjust per-family overrides) — OR keep tier-schedule admin-only and per-family override welcome-team. **Default: tier schedule = admin; per-family override = welcome-team** (matches "configure" vs "adjust" split). Confirm at build.

## 6. Seed change

Replace `seed-donation-periods.ts` semester entries with **one school-year period per location**, each with the pricing-tier schedule:
- Brampton 2025-26 (Sep 7 2025 – Jun 14 2026): tiers [Sep $500, Dec $300, Feb $200] *(amounts to confirm with CMT — using the example values)*
- Scarborough 2025-26: same shape (East dates from its calendar)
- Mississauga / Markham: only if they run Bala Vihar.

## 7. Migration of shipped data (UAT only)

The shipped semester periods (`bv-brampton-fall-2025`, `bv-brampton-winter-2026`, Mississauga equivalents) + the test enrollments/donations referencing them are **UAT test data**. Plan:
1. Delete the 4 old semester `donationPeriods` docs.
2. Delete test enrollments referencing the old pids (the `_test`-tagged ones + my own `CMT-P672RGSS` test enrollment) and the 7 test donation docs from the checkout testing.
3. Re-seed the school-year periods.
4. No prod impact — prod donations were never enabled for real families; this is all UAT/test-mode data.

(Destructive on test data — will confirm the exact deletes with the user before running, per the "don't delete what you didn't create / surface contradictions" rule. My own test enrollment + donations are fair game; any real-looking family enrollment gets flagged first.)

## 8. Impact — files to change

**Schema (`packages/shared-domain/src/setu/schemas/donation-period.ts`):**
- `suggestedAmount: number` → `pricingTiers: PricingTier[]`
- `amountTiers` → optional
- add `PricingTier` type + `resolveSuggestedAmount(period, date)` helper + tests
- update `CreateDonationPeriodSchema` / `UpdateDonationPeriodSchema` (validate tiers)

**Enrollment (`features/setu/enrollment/enroll-family.ts` + `enroll-on-first-attendance.ts`):**
- snapshot via `resolveSuggestedAmount(period, enrollDate)`

**Admin routes + UI (`api/admin/donation-periods/*`, `features/admin/donation-periods/periods-table.tsx`):**
- accept/validate/render `pricingTiers`

**Donate form (`features/family/components/donate-form.tsx`):**
- derive give-more chips from resolved suggested when `amountTiers` absent

**Seed (`scripts/seed-donation-periods.ts`):** school-year periods + tiers

**Tests:** `resolveSuggestedAmount` (boundary dates), schema validation, enroll snapshot picks the right tier by date, admin tier CRUD.

**Docs:** note the Slice 4 calendar is unaffected (already date-keyed, school-year spanning).

## 9. Sub-tasks (this revision)
1. Schema + `resolveSuggestedAmount` + tests (`@cmt/shared-domain`).
2. Enroll snapshot resolution (both enroll paths) + tests.
3. Admin routes + periods-table UI for pricing tiers + tests.
4. Donate-form chip derivation.
5. Seed rewrite → school-year periods.
6. UAT data migration (confirm deletes with user, then run + re-seed).
7. Walk the flow in UAT: create period w/ tiers → enroll at a date → snapshot = correct tier → donate floor honors it.

Then resume Slice 4 (4a levels + 4b calendar) on the corrected foundation.

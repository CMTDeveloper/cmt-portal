# Slice 3a — Donation Periods: What Shipped

**Date:** 2026-05-27
**Commits:** f247959 (schemas + routes + seed) · 5edc557 (cross-fix: revalidateTag + lint)
**Scope:** Donation period admin surface — Firestore model, API routes, admin UI, canAccessRoute, Firestore indexes, seed script, feature flag.
**Design ref:** `docs/superpowers/specs/2026-05-26-slice-3-donations-checkout-receipts-design.md` §5.1, §6, §13, §14, §15.3a

---

## What shipped

### Shared domain — `packages/shared-domain/src/setu/schemas/donation-period.ts`

- `DonationPeriodDoc` — full Firestore shape (pid, programKey, location, periodLabel, start/endDate, suggestedAmount, amountTiers, enabled, audit fields).
- `CreateDonationPeriodSchema` — POST body; datetime strings + `endDate > startDate` refinement; `enabled` defaults `true`.
- `UpdateDonationPeriodSchema` — PATCH body; all fields optional; date-ordering re-validated only when both sides are present.
- `PROGRAM_KEYS` + `LOCATIONS` enums re-exported and consumed by the enrollment schema (`schemas/enrollment.ts` imports from here).

### Firestore indexes — `firestore.indexes.json`

Five new composite indexes (UAT-only; prod is read-only per CLAUDE.md):

| Collection | Fields | Purpose |
|---|---|---|
| `donationPeriods` | programKey ASC, location ASC, enabled ASC, startDate DESC | family-side period resolution + admin list |
| `donations` | fid ASC, createdAt DESC | `/family/donations` receipt list |
| `donations` | fid ASC, status ASC, createdAt DESC | admin status filter |
| `donations` | status ASC, pledgedAt ASC | welcome-team pledged queue + archive cron |
| `donations` | programKey ASC, periodLabel ASC, confirmedAt DESC | admin period reports |
| `enrollments` (subcollection) | status ASC, enrolledAt DESC | family dashboard |

Field override: `enrollments.eid` indexed as COLLECTION_GROUP (for welcome-team/override PATCH which looks up eid without knowing the family).

### canAccessRoute + public-routes — `packages/shared-domain/src/auth/`

New method-aware gates (before the `/api/setu/` catch-all):

- `/api/setu/enrollments/*` — GET: any setu family; POST/DELETE: manager-only
- `/api/setu/donations/*` — GET: any setu family; POST: manager-only
- `/api/welcome/donations/*` + `/api/welcome/enrollments/*` — welcome-team (isWelcomeTeam includes admin)

New public routes:
- `/api/webhooks/stripe` — Stripe signs the body; no session needed
- `/api/cron/archive-pledges` — CRON_SECRET verified at handler; no session needed

Note: `/api/admin/*` is already gated to `isAdmin` by the upstream catch-all at line 29 — no duplicate entry needed.

### Admin API routes

**`GET /api/admin/donation-periods`** — returns all periods including disabled, ordered by `startDate DESC`. Timestamps serialized to ISO strings (Firestore `Timestamp` → `.toDate().toISOString()`).

**`POST /api/admin/donation-periods`** — creates a period. Derives `pid` as `{programKey}-{location}-{periodLabel}` (kebab). Checks for overlap with existing enabled periods for the same (programKey, location): non-blocking — returns `{ pid, overlapWarning: true }` on overlap, saves regardless (multiple active periods are intentional per design §6.3). Admin uid sourced from `x-portal-uid` header set by middleware.

**`PATCH /api/admin/donation-periods/[pid]`** — partial update. Re-validates date ordering against the existing doc when only one side is provided. No DELETE endpoint (disable via `enabled: false`; hard-delete is a manual Firestore console operation only).

### Feature flag — `apps/portal/src/lib/flags.ts`

`setuDonations: process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS === 'true'`

All 3a routes should be gated behind this flag in a follow-up (currently ungated — gating is deferred until sub-slices 3b–3f are complete per the "merge to main but don't announce" strategy from the design §17).

### Seed script — `apps/portal/scripts/seed-donation-periods.ts`

Idempotent upsert of current Bala Vihar periods for go-live:
- Brampton Fall 2025 (2025-09-07 → 2026-01-26)
- Brampton Winter 2026 (2026-02-01 → 2026-06-28)
- Mississauga Fall 2025 (same dates)
- Mississauga Winter 2026 (same dates)

Suggested amount: $500 for all. Tiers: [500, 750, 1000, 1500].

Run: `pnpm --filter @cmt/portal seed:donation-periods` (UAT default). Refuses prod without `--allow-prod`. `--dry-run` logs plan without writing.

---

## Post-deploy verification checklist

Before announcing 3a to any admin:

1. **Deploy Firestore indexes to UAT** — `firebase deploy --only firestore:indexes --project chinmaya-setu-uat` (no `--force`). Verify no existing indexes were dropped.
2. **Run seed script against UAT** — `pnpm --filter @cmt/portal seed:donation-periods`. Verify 4 docs appear in the `donationPeriods` collection in the Firebase console.
3. **Open `/admin/donation-periods`** as an admin user. Confirm the table shows the 4 seeded periods.
4. **Create a new period** via the modal. Confirm it appears in the table. Confirm overlapping periods show the overlap warning toast.
5. **Disable a period** via the Disable button. Confirm the period disappears from the default (enabled-only) view; appears when "Show disabled" is checked.
6. **Edit a period** (change the period label). Confirm the change persists on refresh.
7. **Verify family-member cannot reach `/api/admin/donation-periods`** — should receive 403 from the admin catch-all in canAccessRoute.

---

## RBB items that affect 3a

The following RBB items from the design §4 are resolved for 3a (no payment integration needed here):

| RBB | Status | Notes |
|---|---|---|
| RBB-1 (Stripe account) | Not needed in 3a | Needed in 3c |
| RBB-2 (CRA registration #) | Not needed in 3a | Needed in 3e |
| RBB-3 (receipt numbering) | Not needed in 3a | Needed in 3e |

The only 3a-relevant RBB:
- **None** — 3a is purely internal admin infrastructure with no payment, receipt, or Stripe dependency.

---

## Known gaps / follow-ups for later sub-slices

1. **Feature-flag gate on admin routes** — `GET/POST/PATCH /api/admin/donation-periods` should check `flags.setuDonations` (currently ungated). Add when flipping the flag for UAT announcement.
2. **Scarborough + Markham periods** — seed script only covers Brampton + Mississauga (the two active locations at go-live). Add Scarborough/Markham periods once those centres launch.
3. **Period start/end stored as UTC timestamps** — the seed uses Toronto EDT offset (`-04:00`). During EST (winter), the offset changes to `-05:00`. The migration script will need updating for winter-start periods. The admin modal uses date inputs (local date strings) converted via `new Date(dateString).toISOString()` — this is UTC midnight, which may be off by 4–5 hours from Toronto midnight. A future polish: pass the date as Toronto midnight explicitly, matching the seed script's `torontoMidnight()` helper.

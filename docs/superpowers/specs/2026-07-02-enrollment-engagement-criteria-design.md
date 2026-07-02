# Enrollment engagement criteria — "Registered" vs "Enrolled" (issue #23)

**Date:** 2026-07-02 · **Status:** Approved (CMT Developer, 2026-07-02) · **Approach:** derived state (no schema change)

## Problem

After the 2026-27 year rollover, families see an **"Enrolled"** Bala Vihar pill they never asked for. Verified against the reporter's real UAT record (`CMT-P672RGSS`): the welcome-team backfill created a 2025-26 BV enrollment from the legacy roster (no family action), and the admin's rollover promotion cancelled it and wrote an **active** 2026-27 enrollment (`enrolledVia: 'promotion'`). The dashboard pill means only "an active BV enrollment doc exists" (`select-bv-enrollment.ts:24-26`), so it reads "Enrolled" for families that never engaged. Secondary complaint, same screen: no clear path to complete the donation (mobile dashboard has **no** donate CTA at all).

## Product rule (owner decision, 2026-07-02)

> A family is **Enrolled** in Bala Vihar for a school year only when it has **attended ≥ 1 BV class that year** OR **made a completed donation toward that year's BV enrollment**. Until then it is **Registered**.

Locked decisions:

1. **Applies to ALL enrollments** regardless of `enrolledVia` — self-enroll, teacher add, promotion, backfill. (A teacher add records attendance in the same action, so those confirm immediately in practice.)
2. **Interim state is visible**: amber **"Registered"** pill + nudge copy ("Attend your first class or complete your donation to confirm enrollment") + a donate CTA on **both** desktop and mobile.
3. **Any completed donation** tied to that year's BV enrollment confirms — amount irrelevant (donations are suggestions, not fees). *Flippable to full-suggested-amount if the owner reconsiders; isolated in one predicate.*
4. Enrollment **docs do not change** — `status` stays `['active','cancelled']`, promotion still writes `active`. "Confirmed" is **derived at read time** from attendance + donations. Retroactive by construction: all 769 promoted 2026-27 enrollments show Registered today, which is correct (no 2026-27 classes have run).

## Why derived (approach A) over stored

- ~20 files filter `status === 'active'` (teacher roster, prasad engine input, checkout, payment chip, reports, child profile…). A new status value would force an audit of every one; a derived label touches none of them. Two of them **must** keep treating registered families as active: the teacher roster (else the first check-in could never happen) and donations checkout (it is the confirmation trigger).
- No migration, no mobile status-enum break, no drift between a stored flag and the facts it summarizes.
- The all-families surfaces (roster, reports) already aggregate via bulk in-memory reads — the same derivation runs there without new Firestore indexes.
- If reports later need an indexed "unconfirmed" query, graduate to an additive `confirmedAt` field (approach C) without unwinding this work.

## Design

### 1. Derivation helper (pure, shared)

`apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`:

```ts
type ConfirmationInputs = {
  /** Attendance events already loaded for this enrollment's offering window
   *  (same per-offering source the dashboard heatmap uses — legacy
   *  family-check-ins for legacy-sourced offerings, attendance module rows
   *  otherwise). Only present/late count. */
  attendanceCount: number;
  /** The family's donations (all). */
  donations: DonationDoc[];
};

/** Attended ≥1 class in the enrollment's window OR ≥1 completed donation
 *  with eid === enrollment.eid. Applies to every enrolledVia. */
export function isEnrollmentConfirmed(
  enrollment: EnrollmentWithOffering,
  inputs: ConfirmationInputs,
): boolean;
```

Per-year scoping is structural: attendance is counted inside the enrollment's **offering window**, and donations match on the enrollment's **eid** — a 2025-26 check-in or donation cannot confirm 2026-27.

### 2. Dashboard model (web + mobile views)

`buildFamilyDashboardModel` gains:

```ts
bvState: 'enrolled' | 'registered' | 'none';
```

- `enrolled` — active BV enrollment AND `isEnrollmentConfirmed(...)`.
- `registered` — active BV enrollment, not yet confirmed.
- `none` — no active BV enrollment.

Pill mapping (replaces the current boolean pill): green **Enrolled** / amber **Registered** / grey **Not enrolled**. `isEnrolled` (doc-exists semantics) is retained for existing consumers; all new branching uses `bvState`.

Registered families see, on **both** the mobile (`page.tsx` `block md:hidden` branch) and desktop branches:
- nudge line: *"Attend your first class or complete your donation to confirm enrollment."*
- a **Give donation** button (`donateUrl`) — this adds the missing mobile donate CTA from #23. Desktop keeps its existing button.

No other dashboard behavior changes (attendance heatmap, program cards, seva/prasad untouched).

### 3. Mobile API (additive only)

`GET /api/setu/dashboard` → `balaVihar` gains `bvState: 'enrolled' | 'registered' | 'none'`. Existing `isEnrolled` keeps its current meaning (active record exists) so the hand-mirrored mobile schema does not silently change semantics. Dated, SHA-keyed `MOBILE_API_CHANGELOG.md` entry; mobile shows the same three-state pill + nudge.

### 4. Welcome/admin surfaces

- **Roster** (`/welcome/roster`) and the **enrollment headcount report** (`/welcome/reports` → enrollment) label each BV family/count as Confirmed vs Registered via the same helper. These surfaces add bulk attendance + donation reads following the house bulk-collectionGroup pattern (unfiltered gets joined in memory — same as the roster CSV and attendance report do today). No new Firestore indexes; no query-shape changes.

### 5. Out of scope

- The #5/#19 donation-clarity redesign (progress bars, `showGive` balance-gating, amounts copy).
- Any change to enrollment **creation** paths — promotion/backfill/self-enroll all still write `status:'active'`.
- Teacher roster, prasad, checkout, attendance flows — deliberately untouched (they operate on `status`).
- Non-BV programs: `bvState` is a Bala Vihar concept; other programs keep their cards as-is.

## Testing

- **Unit** (helper + model): attendance-only confirms; donation-only confirms; both confirm; neither → registered; `eid` mismatch (donation to Tabla) does NOT confirm BV; window scoping (2025-26 attendance does not confirm 2026-27); N=2 enrollments (BV + Tabla) — Tabla activity never affects `bvState`; N=2 members.
- **Deployed-UAT E2E** (`e2e/setu/` Playwright, realistic fixture): seeded family with an unconfirmed 2026-27 BV enrollment shows **Registered** + nudge + mobile donate CTA; after a completed donation is written for that eid, dashboard shows **Enrolled**. The reporter's real family (`CMT-P672RGSS`) is the manual walkthrough case: Registered today, Enrolled after first 2026-27 engagement.
- **Mobile contract**: dashboard route test asserts `bvState` present for all three states.

## Rollout

Code-only change (no data writes, no index deploys, no flags — display semantics + additive API field). Ships like any slice: unit-green → deployed-UAT E2E → done. Issue #23 gets the verified diagnosis + this spec linked; the donation-redesign remainder stays tracked in #5/#19.

# Prasad revision: propose → confirm (admin-team feedback) — design

**Revises:** `2026-06-10-prasad-module-design.md` (shipped). Admin-team feedback:
*"we only want to **propose** and show available dates, and not directly assign.
The logic can still be used, but only to propose."* Plus CMT Developer's decision:
*if a family never confirms, the admin gets the option to assign it.*

## Decisions

| Question | Decision |
|---|---|
| Workflow | **Propose → family confirms → admin assigns stragglers.** Publish writes `status:'proposed'` rows. A family confirms the suggested date OR picks any open Sunday (the available-dates list). Confirmed = `status:'assigned'`, behaves exactly like today (move + 7-day lock). |
| Engine | **Unchanged.** `proposePrasadAssignments` already only proposes; only the publish WRITE status changes. Existing rows of either status still consume seats on re-publish (idempotency unchanged). |
| Family never confirms | Stays `proposed` indefinitely — **no auto-confirm deadline**. Admin assigns from `/admin/prasad`: per-row **Assign** + bulk **"Assign all unconfirmed"** per location. |
| Distinguishing who committed | `confirmedBy: 'family' \| 'admin'` + `confirmedAt` on the doc. |
| Telling families about the proposal | Publish sends ONE proposal email+SMS per family ("your suggested prasad Sunday — confirm or pick another date"), stamped `proposalNotifiedAt` so re-publish never re-sends. Gated by `PRASAD_REMINDER_CRON_ENABLED` (now the master prasad-send switch) + the UAT allowlists. |
| 7d/2d cron | Same daily cron, **status-aware copy**: `assigned` → today's reminder; `proposed` → "please confirm" nudge. Same `remindedAt` stamps, same per-family try/catch isolation. |
| Backward compat | `'assigned'` keeps its meaning (= committed). The shipped E2E fixture and any pre-existing docs stay valid; no data migration. |

## Data model (`packages/shared-domain/src/setu/prasad.ts`)

- `PRASAD_STATUSES = ['proposed', 'assigned', 'cancelled']`.
- `PrasadAssignmentDocSchema` — new fields (⚠️ add to the Zod schema in the SAME
  commit as the writers — silent-strip trap):
  - `confirmedAt: z.date().nullable()`
  - `confirmedBy: z.enum(['family', 'admin']).nullable()`
  - `proposalNotifiedAt: z.date().nullable()`
- New bodies:
  - `PrasadConfirmBodySchema = { date: YMD.optional() }` — omitted ⇒ confirm the
    proposed date in place; present ⇒ confirm at that open Sunday.
  - `PrasadAssignRemainingBodySchema = { pid }` — bulk admin assign.
  - `PrasadAdminReassignBodySchema` gains `assign: z.boolean().optional()` —
    `{paid, assign:true}` flips proposed→assigned (with optional `date`).
- **No new Firestore indexes**: the cron's proposed-date-range query reuses the
  existing `(status,date)` composite; bulk assign is `pid==` + `status==`
  (two equalities — merge-join, no composite needed).

## Publish (`publish-assignments.ts`)

`publishAssignments` writes NEW rows with `status:'proposed'`,
`confirmedAt/confirmedBy/proposalNotifiedAt: null`. Existing rows (proposed OR
assigned) are never touched and keep consuming seats — re-publish fills gaps
exactly as today. After the batch lands, send the proposal notification to each
NEWLY-written family (email+SMS via the existing resolve-sender paths), stamping
`proposalNotifiedAt` AFTER send per family (dup-risk over skip-risk, same
semantics as reminders), each in its own try/catch.

## Family surface (`/family/prasad` + dashboard card; mobile + desktop branches)

- **proposed**: "Suggested prasad Sunday: **<date>**" + the existing why-line,
  with two CTAs: **Confirm this date** and **Pick a different Sunday** (reuses
  the move sheet's available-dates list with per-Sunday remaining capacity).
  Picking a date = confirm at that date. No 7-day lock in this state — a
  proposal can be confirmed/redirected any time before the date.
- **assigned**: card exactly as shipped (date, move, 7-day lock).
- New `POST /api/setu/prasad/confirm` — already manager-only via the existing
  prasad prefix rule in `canAccessRoute` (`/api/setu/prasad/` + POST ⇒
  `isSetuManager`); GET surfaces unchanged for any family role. **No gate change.**
- `confirmAssignment(fid, date?, actorMid)` transaction:
  - in-place confirm: assert doc still `proposed`, flip to `assigned`,
    `confirmedBy:'family'`, `confirmedAt` (seat already counted — no cap check);
  - confirm-at-other-date: cap-checked `tx.get(query)` recount like
    `moveAssignment` (frees the proposed seat, takes the target seat), rejects
    past/non-listed dates;
  - results → HTTP: `confirmed` 200 · `not-found` 404 · `already-confirmed` 409 ·
    `invalid-target` 409 · `target-full` 409.

## Admin surface (`/admin/prasad` manage view)

- Stats strip adds **confirmed / proposed / % confirmed** per location.
- Rows get a status chip (Proposed / Confirmed / Cancelled). Proposed rows get
  an **Assign** action (`{paid, assign:true}` → `assigned`, `confirmedBy:'admin'`);
  existing reassign (`date`) and cancel actions stay and now preserve the row's
  current status unless `assign:true` accompanies them.
- New bulk action per location: **"Assign all unconfirmed (N)"** with a confirm
  dialog → `POST /api/admin/prasad/assign-remaining {pid}` (batched ≤400 writes,
  same gate stack as the other admin prasad routes).
- Publish CTA copy: "Publish proposals".

## Welcome surface (`/welcome/prasad`)

Day-of list shows both statuses with chips — confirmed first, then proposed
("not yet confirmed") so the team knows who may need a day-of nudge. Per-Sunday
header: "X confirmed · Y proposed".

## Reminder cron (`reminder-service.ts`)

Unchanged query (`(status,date)`, date ∈ [today+7, today+2]) run twice — once
for `assigned` (today's reminder copy) and once for `proposed` (confirm-nudge
copy linking to `/family/prasad`). Same `remindedAt.{weekBefore,twoDayBefore}`
stamps; a family that confirms between the two marks simply gets the assigned
copy at the next mark.

## Rollout

- No data migration: UAT has no real publishes (only the E2E fixture, which
  stays `assigned` so the locked-move specs remain deterministic). Prod has
  nothing.
- Seed additions: a `proposed` fixture (future date) on the test-accounts
  Scarborough family for proposed-card/confirm E2E; `seed:e2e-family` untouched.
- Runbook §14 entry + update the prasad operational steps (publish now produces
  proposals; add "assign stragglers before the season starts" to the admin
  ritual).

## Testing

- **Unit (same commits as the code):** schema round-trip with new fields;
  publish writes `proposed` + idempotent re-publish counts both statuses;
  `confirmAssignment` all five results incl. cap-full and already-confirmed
  races; admin assign single + bulk; cron sends the right copy per status and
  isolates per-family failures.
- **E2E vs deployed UAT:** proposed card renders with both CTAs; confirm
  validation (400 malformed, 409 paths); admin manage shows chips + assign
  control (testids); bulk endpoint auth (401/403/400); all shipped prasad specs
  stay green unchanged.

## Out of scope

Auto-confirm deadlines · proposal expiry · family-to-family swaps · Scarborough
calendar entry (still the operational step via `/admin/calendar`).

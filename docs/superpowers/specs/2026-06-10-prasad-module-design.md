# Prasad Module — Design

**Date:** 2026-06-10 · **Status:** Approved direction (brainstormed with CMT Developer; architecture = rollover-pattern, Approach A)

## Problem

Every Bala Vihar Sunday ends with prasad for all kids and families. Today this runs on voluntary weekly signups: collecting them takes time, some Sundays nobody signs up, and the team falls back to announcing in adult classes or messaging around. The portal should replace the signup sheet with a year-long assignment every family can see, move, and be reminded of.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Workflow | **Auto-assign + self-serve swap.** Admin runs the assigner, reviews, publishes. Families see their date; no confirmation step. |
| Date choice | **Youngest child's birthday month + spill.** Balanced across that month's class Sundays up to a per-Sunday cap; overflow spills to the calendar-nearest Sunday with room. |
| Changes | **Self-serve move** to any future class Sunday with seats left (no admin involvement); locked within 7 days of the date. |
| Reminders | **Email + SMS** to family managers 7 days and 2 days before, via existing SES/SNS senders + daily cron. |
| Locations | **Both centers** from day one (per-location rotations; Scarborough's class calendar gets seeded as part of this work). |
| Architecture | **Approach A — rollover pattern**: pure engine in `@cmt/shared-domain`, top-level `prasadAssignments` collection, `/admin/prasad` preview→publish screen. |

## Data facts that shaped the design

- The legacy roster (prod RTDB `/roster`, read via the **local snapshot** — never live) carries **`dob_m`** (birth month 1–12, **no year**) for 728 of 835 current students; **455 of 512 families** have ≥1 child with a birth month. Birth months are fairly even (48–78 kids/month).
- Setu members have `birthMonthYear` (`YYYY-MM`) but it is null for nearly all migrated kids — only month data exists, so we model **`birthMonth` (1–12, nullable)** honestly rather than fabricate years.
- "Youngest child" cannot come from birth years; it comes from the **lowest grade rung** (JK < SK < 1 < … < 12), which IS complete.
- Scale: Brampton ~357 enrolled families over ~36 class Sundays ≈ cap 10/Sunday; Scarborough ~155 ≈ cap 5/Sunday.
- The class calendar (`classCalendarEntries`) already models class vs no-class Sundays per location — holidays/breaks are excluded for free.

## Data model

### New top-level collection `prasadAssignments`

One doc per family per school-year period. Deterministic id `paid = {pid}-{fid}` (e.g. `bv-brampton-2026-27-CMT-ABC123`) → re-publishing is idempotent.

```ts
interface PrasadAssignmentDoc {
  paid: string;            // `${pid}-${fid}`
  pid: string;             // per-location period, e.g. 'bv-brampton-2026-27'
  fid: string;
  familyName: string;      // snapshot for day-of lists
  location: 'Brampton' | 'Scarborough';
  date: string;            // YYYY-MM-DD assigned class Sunday
  youngestMid: string | null;
  youngestName: string | null;
  birthMonth: number | null;          // 1-12 used for the assignment
  reason: 'birthday-month' | 'spill' | 'no-birth-month';
  source: 'auto' | 'family-move' | 'admin';
  status: 'assigned' | 'cancelled';
  assignedAt: Timestamp;
  movedFrom: string | null;  // previous date when source != 'auto'
  movedAt: Timestamp | null;
  movedBy: string | null;    // mid or admin uid
  remindedAt: { weekBefore: Timestamp | null; twoDayBefore: Timestamp | null };
}
```

Indexes: `prasadAssignments(pid, date)` for per-Sunday lists + capacity counts; `prasadAssignments(fid, pid)` is satisfied by the deterministic doc id (direct `doc(paid).get()` — no index). Add to `firestore.indexes.json`, deploy to UAT (never `--force` on prod).

### Member field `birthMonth`

`birthMonth: number | null` (1–12) on `families/{fid}/members/{mid}`. Sources, in priority order: explicit value → derived from `birthMonthYear` when present → backfilled from legacy `dob_m`. Zod: add to the member schema (nullable, optional-tolerant) — the schema must include the new field or `safeParse` silently strips it (this bit the `extraRoles` claim once already).

### Calendar flag `prasadNeeded`

`prasadNeeded: boolean` (default `true`) added to `ClassCalendarEntryDoc` + create/update schemas + a toggle in the `/admin/calendar` editor. The engine only schedules onto entries with `kind === 'class' && enabled && prasadNeeded !== false`. Additive — existing docs without the field read as `true`.

### Config doc `prasadConfig/{pid}`

`{ pid, capPerSunday: number, publishedAt, publishedBy }` — written at publish so the family move dialog and re-runs enforce the same cap the admin chose.

## Assignment engine (pure, in `@cmt/shared-domain`)

`proposePrasadAssignments(input): PrasadProposal` — no Firestore, deterministic, exhaustively unit-tested (mirrors `decidePromotion`).

```ts
interface PrasadEngineInput {
  pid: string;
  location: string;
  cap: number;                       // default ceil(families / sundays), admin-editable at preview
  sundays: Array<{ date: string }>;  // eligible: class + enabled + prasadNeeded, future-only
  families: Array<{
    fid: string;
    familyName: string;
    children: Array<{ mid: string; name: string; gradeRung: number | null; birthMonth: number | null }>;
    existing: { date: string } | null;   // already-assigned (any source) → never moved
  }>;
}
```

Algorithm:
1. **Seats**: each eligible Sunday starts with `cap` seats minus already-assigned families on that date (existing assignments are never moved — re-runs only fill gaps; this also handles families who join mid-year).
2. **Youngest child** = lowest `gradeRung` (JK=0, SK=1, Grade n=n+1; tie → lower mid for determinism); target `birthMonth` = youngest's, else the next-youngest child that has one.
3. **Pass 1 — birthday families** (sorted by fid for determinism): place into the target month's Sunday with the most remaining seats (tie → earliest date) → `reason: 'birthday-month'`. If the month has no seats (or no class Sundays — July/August), take the calendar-nearest Sunday with a seat (equal distance → earlier date) → `reason: 'spill'`.
4. **Pass 2 — no-birth-month families** (sorted by fid): fill the Sundays with the most remaining seats (tie → earliest) → `reason: 'no-birth-month'`.
5. Output: proposed rows + per-Sunday counts + stats (`% in birthday month`, spills, no-birth-month count, unplaceable when total families > total seats — the preview blocks publish and tells the admin to raise the cap).

## Admin — `/admin/prasad`

Rollover-shaped flow, per-location tabs:
- **Preview step**: cap input (computed default), proposed schedule grouped by Sunday with reason chips, stats strip. Read-only until **Publish** (writes assignment docs + `prasadConfig`).
- **Manage view** (post-publish): per-Sunday groups, family search, admin reassign (`source:'admin'`, bypasses the 7-day lock), cancel (family left — frees the seat), "unassigned families" strip with one-click re-run for newcomers.
- **This Sunday** list (names + manager contacts) — also visible read-only to welcome-team for assembly day.

APIs (admin catch-all covers auth): `GET /api/admin/prasad?date=...`, `POST /api/admin/prasad/preview`, `POST /api/admin/prasad/publish`, `PATCH /api/admin/prasad/assignment`. Welcome-team: `GET /api/welcome/prasad/upcoming` (explicit `canAccessRoute` rule).

## Family experience

- Dashboard card + `/family/prasad` page: "Your prasad Sunday — **Sun, Mar 22**", why ("Aarav's birthday month"), what-to-bring blurb (static copy v1), and the move control.
- **Move dialog**: future class Sundays with `seatsLeft > 0` (cap from `prasadConfig`); selection runs in a Firestore transaction that re-counts the target date under the cap (no overbooking). Locked within 7 days of the assigned date. Manager-only to move; any family role views.
- Mobile-first layout (`block md:hidden` branch) + Bearer-ready handlers (`readSessionFromHeaders`, ISO JSON): `GET /api/setu/prasad`, `GET /api/setu/prasad/options`, `POST /api/setu/prasad/move` — each needs an explicit `canAccessRoute` rule (the `/api/setu/` catch-all is manager-only; view routes open to all family roles).

## Reminders

Daily cron (extends the existing daily route): query `prasadAssignments` where `status=='assigned'` and `date - today ∈ {7, 2}` (America/Toronto), send the `prasad-reminder` SES template + SNS SMS to the family's managers, stamp `remindedAt.weekBefore/twoDayBefore` — idempotent, re-runs never double-send. UAT allowlists (`SETU_EMAIL_ALLOWLIST` / `SETU_PHONE_ALLOWLIST`) apply as everywhere else.

## Backfill + rollout

1. `backfill:birth-months` script (UAT-guarded, idempotent): legacy `dob_m` → `members.birthMonth` via `legacySid`, **reading the local RTDB snapshot** (`RTDB_SNAPSHOT_DIR`) — zero live downloads. Legacy parser learns `dob_m` so future lazy-migrations carry it.
2. Seed Scarborough's class calendar (extend `seed-bala-vihar-calendar.ts` with the East PDF dates).
3. Member edit + new-child forms gain an optional "Birth month" select so coverage improves over time.
4. Ship to UAT against the 2026-27 period; prod replay at cutover = deploy indexes (no `--force`) + run backfill with `--allow-prod` + admin publishes from the screen.

## Out of scope (v1)

No prasad-brought/no-show tracking; no family↔family direct swaps (move-to-open-seat covers it); no per-date cap overrides (single per-location cap); Shishu-only families without graded kids follow the no-birth-month path unless `birthMonthYear` exists.

## Testing

- **Engine (TDD)**: heavy-month overflow → spill; July/Aug birthdays; no-birth-month spread; idempotent re-run keeps existing + fills gaps; cap-exhaustion flags unplaceable; N=2 children picks the younger; determinism (same input → same output).
- **Routes**: move rejects full Sundays + inside-lock-window moves; publish idempotency; role gates (member can view, only manager moves; welcome-team read-only).
- **Playwright E2E vs deployed UAT**: preview renders (read-only — safe), seeded family's card renders, move round-trip with revert, reminder cron double-call sends once (assert `remindedAt` stamps via endpoint).

# Prasad module — how it works, end to end

One prasad Sunday per Bala Vihar family per school year. The portal **proposes**
a date for every family (youngest child's birthday month when possible), the
family **confirms** it or picks another open Sunday, and the admin **assigns**
anyone who never responds. This guide walks the full flow from setup to prasad
Sunday.

Specs: `docs/superpowers/specs/2026-06-10-prasad-module-design.md` (engine) +
`2026-06-10-prasad-propose-confirm-design.md` (propose→confirm revision).

---

## Stage 0 — One-time setup (admin, per school year)

1. **Class calendar** for each location must exist (`/admin/calendar`). Every
   `class` Sunday is a potential prasad day. Toggle **"prasad needed"** OFF for
   special days (Diwali event, holiday assembly…) — those dates are excluded
   automatically.
2. **Birth months** come from the legacy roster (`members.birthMonth`,
   backfilled for 906 children via `backfill:birth-months`). New children get
   it from their member record.
3. **Sends are OFF** until `PRASAD_REMINDER_CRON_ENABLED=true` is set in
   Vercel — publishing works without it, but no emails/SMS go out (publish
   notification AND the daily reminders are both gated by this one switch).

## Stage 1 — Admin proposes the schedule (`/admin/prasad`)

4. Pick a location tab (Brampton / Scarborough). The **preview** places every
   enrolled BV family onto a Sunday:
   - **Birthday month** 🎂 — a Sunday in the *youngest child's* birth month
     (most-open Sunday first). The happy path; this is the why-line families see.
   - **Moved nearby** — that month's Sundays are full (or absent from the
     season), so the nearest open Sunday.
   - **No birth month** — families with no birth-month data fill the emptiest
     Sundays.
   - Each Sunday holds at most the **cap** (adjustable; the default spreads
     families evenly). If families don't fit, the preview blocks publishing —
     raise the cap.
5. Click **"Publish proposals"**. Every family gets a *proposal*
   (`status:'proposed'`) — nothing is committed yet. **Re-publishing is safe:**
   existing families (proposed or confirmed) are never touched; only new
   families get slotted in.
6. On publish, each family's managers receive a **one-time email + SMS**:
   "Your family's suggested prasad Sunday is *date* — please confirm or pick
   another date," linking to the portal. (Never re-sent on re-publish.)

## Stage 2 — Families respond (`/family/prasad` + dashboard card)

7. The family sees **"Suggested prasad Sunday: [date]"** with the reason
   (e.g., "Anu's birthday month 🎂") and two buttons:
   - **Confirm this date** — one tap, done. The card flips to "Your prasad
     Sunday."
   - **Pick a different Sunday** — lists every open Sunday with spots
     remaining ("3 spots left"); picking one confirms it there instead.
     Capacity is enforced transactionally — two families can't grab the last
     seat at once.
8. A *proposed* family can pick **any** future Sunday (even next week). Once
   **confirmed**, the normal rules apply: self-serve moves are allowed until
   the date **locks 7 days before** their Sunday (after that: "contact the
   welcome team").

## Stage 3 — Automatic nudges (daily cron, 14:00 UTC)

9. At **7 days** and **2 days** before each date:
   - *Unconfirmed* families → "your suggested Sunday is coming and is **not
     confirmed yet** — please confirm or pick another date."
   - *Confirmed* families → "your prasad day is this Sunday — please bring
     prasad for the assembly."
   - Each family is stamped after sending, so nobody gets duplicates.

## Stage 4 — Admin closes the loop (`/admin/prasad`, manage section)

10. The manage list shows every family with a **Proposed / Confirmed** chip
    and a counts line ("41 confirmed · 9 proposed (82% confirmed)").
11. For stragglers who never respond:
    - per-row **Assign** — commits that one family to their suggested date;
    - **"Assign all unconfirmed (N)"** — one click commits everyone still
      proposed (anyone who confirmed in the meantime is skipped).
    - **Recommended ritual:** publish → give families ~2 weeks → bulk-assign
      before the first prasad Sunday.
12. Admin can also **reassign** any family to another Sunday (bypasses cap +
    lock — the front-desk override) or **cancel** a family that left. The
    record tracks whether the family or an admin confirmed each date
    (`confirmedBy`).

## Stage 5 — Prasad Sunday (`/welcome/prasad`)

13. The welcome team's day-of list shows the next 4 Sundays per location:
    which families are bringing prasad, **manager names + phone/email** for a
    quick call, and a **"not confirmed"** flag on anyone to chase that morning.

## Mid-year and year-end

- **New family enrolls mid-year** → hit Publish again; only they get slotted
  and notified.
- **School-year rollover** → bump `CURRENT_PRASAD_PIDS`
  (`apps/portal/src/features/setu/prasad/constants.ts`) to the new year's
  program ids, enter the new class calendar, publish fresh. (Same cadence as
  the rest of the rollover ritual.)

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | `/admin/prasad` | Preview → Publish proposals → monitor → Assign stragglers / reassign / cancel |
| Admin | `/admin/calendar` | Maintain class Sundays + "prasad needed" toggle |
| Family manager | `/family/prasad` (+ dashboard card) | Confirm suggested date, or pick / move to another open Sunday |
| Welcome team | `/welcome/prasad` | Day-of list with contacts + not-confirmed flags |
| Cron (automatic) | daily 14:00 UTC | 7d/2d reminders — confirm-nudge vs bring-prasad copy |

**Statuses:** `proposed` (awaiting family) → `assigned` (committed — by family
confirm or admin assign) → `cancelled` (family left). All sends gated by
`PRASAD_REMINDER_CRON_ENABLED`.

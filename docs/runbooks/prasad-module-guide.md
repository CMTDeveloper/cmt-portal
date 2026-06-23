# Prasad module — how it works, end to end

**What this is:** every Bala Vihar family brings prasad for the assembly on
one Sunday each school year. The portal suggests a date for each family (the
youngest child's birthday month when possible), the family confirms it or
picks another open Sunday, and the admin assigns anyone who never responds.
This guide walks you through the whole flow, from setup to prasad Sunday.

---

## Stage 0 — One-time setup (admin, once per school year)

1. Make sure the class calendar for each location is entered on the calendar
   page (/admin/calendar). Every class Sunday is a potential prasad day. For
   special days (a Diwali event, a holiday assembly…), turn the **"prasad
   needed"** toggle OFF — those dates are then skipped automatically.
2. Children's birthday months were brought over from the old roster by the
   tech team (906 children). New children get theirs from their member
   record — nothing for you to do here.
3. Emails and texts stay OFF until the tech team switches them on. You can
   still publish the schedule without it — but no messages go out. One switch
   controls both the "your suggested date" announcement and the daily
   reminders.

## Stage 1 — Admin proposes the schedule (/admin/prasad)

4. Open the prasad admin page (/admin/prasad) and pick a location tab
   (Brampton or Scarborough). You'll see a **preview** that places every
   enrolled Bala Vihar family onto a Sunday:
   - **Birthday month** 🎂 — a Sunday in the *youngest child's* birthday
     month (the most-open Sunday first). This is the happy path, and it's the
     reason families see next to their date.
   - **Moved nearby** — the Sundays in that month are full (or the month has
     no class Sundays in the season), so the family goes on the nearest open
     Sunday.
   - **No birth month** — families with no birthday-month data fill the
     emptiest Sundays.
   - Each Sunday holds at most the **cap** (you can adjust it; the default
     spreads families evenly). If the families don't fit, the preview blocks
     publishing — raise the cap.
5. Click **"Publish proposals"**. Every family gets a *suggested* date —
   nothing is locked in yet. **Publishing again later is safe:** families who
   already have a date (suggested or confirmed) are never touched; only new
   families get slotted in.
6. When you publish, each family's managers get a **one-time email + text**:
   "Your family's suggested prasad Sunday is *date* — please confirm or pick
   another date," with a link to the portal. (This message is never re-sent
   when you publish again.)

## Stage 2 — Families respond (/family/prasad, plus a dashboard card)

7. The family sees **"Suggested prasad Sunday: [date]"** with the reason
   (e.g., "Anu's birthday month 🎂") and two buttons:
   - **Confirm this date** — one tap, done. The card flips to "Your prasad
     Sunday."
   - **Pick a different Sunday** — shows every open Sunday with spots
     remaining ("3 spots left"); picking one confirms them there instead.
     The system prevents double-booking — two families can't grab the last
     spot at once.
8. A family that hasn't confirmed yet can pick **any** future Sunday (even
   next week). Once they've **confirmed**, the normal rules apply: they can
   still move themselves until the date **locks 7 days before** their Sunday.
   After that, the page tells them to contact the welcome team.

## Stage 3 — Automatic nudges (sent daily)

9. The portal automatically reminds families at **7 days** and **2 days**
   before their date:
   - Families who *haven't confirmed* → "your suggested Sunday is coming and
     is **not confirmed yet** — please confirm or pick another date."
   - Families who *have confirmed* → "your prasad day is this Sunday — please
     bring prasad for the assembly."
   - Each family is marked after a reminder goes out, so nobody gets
     duplicates.

## Stage 4 — Admin closes the loop (/admin/prasad, manage section)

10. The manage list shows every family with a **Proposed / Confirmed** chip
    and a running count ("41 confirmed · 9 proposed (82% confirmed)").
11. For stragglers who never respond:
    - **Assign** on a family's row — commits that one family to their
      suggested date;
    - **"Assign all unconfirmed (N)"** — one click commits everyone still
      waiting (anyone who confirmed in the meantime is skipped).
    - **Recommended rhythm:** publish → give families about 2 weeks → assign
      the rest before the first prasad Sunday.
12. You can also **reassign** any family to another Sunday (this skips the
    cap and the 7-day lock — it's the front-desk override) or **cancel** a
    family that left. The record keeps track of whether the family or an
    admin confirmed each date.

## Stage 5 — Prasad Sunday (/welcome/prasad)

13. The welcome team's day-of page shows the next 4 Sundays per location:
    which families are bringing prasad, the **manager names + phone/email**
    for a quick call, and a **"not confirmed"** flag on anyone you may need
    to chase that morning.

## Mid-year and year-end

- **A new family enrolls mid-year** → click **"Publish proposals"** again;
  only the new family gets a date and a notification.
- **School-year rollover** → set the current school year in the admin
  school-year page, enter the new class calendar, then publish fresh prasad
  proposals. Prasad follows the Bala Vihar offerings for that current year.

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | /admin/prasad | Preview → Publish proposals → watch confirmations → Assign stragglers / reassign / cancel |
| Admin | /admin/calendar | Keep class Sundays current + the "prasad needed" toggle |
| Family manager | /family/prasad (+ dashboard card) | Confirm the suggested date, or pick / move to another open Sunday |
| Welcome team | /welcome/prasad | Day-of list with contacts + not-confirmed flags |
| Reminders (automatic) | daily 14:00 UTC | 7-day and 2-day reminders — "please confirm" vs "please bring prasad" wording |

**A family's date moves through three states:** suggested (waiting on the
family) → committed (by the family confirming, or by an admin assigning) →
cancelled (the family left). No emails or texts go out until the tech team
turns sending on.

## Notes for developers

- Specs: `docs/superpowers/specs/2026-06-10-prasad-module-design.md` (engine)
  + `2026-06-10-prasad-propose-confirm-design.md` (propose→confirm revision).
- **All sends are gated by one switch:** `PRASAD_REMINDER_CRON_ENABLED=true`
  in Vercel. Publishing works without it, but neither the publish
  notification email/SMS nor the daily reminders go out.
- The reminder cron runs daily at 14:00 UTC.
- Statuses on the assignment record: `proposed` (awaiting family) →
  `assigned` (committed — by family confirm or admin assign) → `cancelled`
  (family left). `confirmedBy` records whether the family or an admin
  confirmed each date.
- Publish writes proposals with `status:'proposed'`. Re-publishing is
  idempotent: existing families (proposed or confirmed) are never touched;
  only new families get slotted.
- Family self-serve picks enforce capacity transactionally (cap check inside
  the transaction), so two families can't take the last seat at once.
- Birth months live at `members.birthMonth`, backfilled for 906 children from
  the legacy roster via `backfill:birth-months`; new children get the field
  from their member record.
- School-year rollover: no code or Vercel env change is needed for prasad.
  The current prasad periods come from the app-managed current school year and
  the matching Bala Vihar offerings. If those offerings are not present yet,
  prasad falls back to the standard ids for that year.
- `pid` means "program/period id" in this area of the codebase: the Bala Vihar
  offering id such as `bv-brampton-2026-27`. It appears as `offerings.oid`,
  `enrollments.pid`, `prasadAssignments.pid`, and `prasadConfig/{pid}`.

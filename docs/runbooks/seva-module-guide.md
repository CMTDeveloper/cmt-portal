# Seva module — how it works, end to end

**What this is:** your guide to the portal's seva-hours (volunteering)
tracker — posting opportunities, helping families sign up, and confirming
hours after each event.

Every registered family is asked to contribute a yearly seva-hours target
(default **20 hours per family per year**). The portal tracks it through a
simple loop: you **post opportunities** → families **sign up** → you
**confirm hours** after the event → everyone watches progress on their
dashboard. For now, the module only **tracks and reminds** — no family is
ever blocked for falling short, and families cannot log hours themselves.
Hours only count once a sevak confirms them.

> Naming note: this guide is about **seva hours** (volunteering). The
> "Sevak" screen at `/admin/users` is something different — that one is
> about staff roles.

---

## Stage 0 — Admin sets the seva year (one-time per year, admin-only)

1. Open the staff seva page (`/welcome/seva`). The requirement panel at the
   top shows the current seva year and the hours target.
2. Click **Edit requirement**. Only admins see this button — welcome-team
   members see "Admin-managed" instead.
3. Type the **Seva year** (for example `2026-27`) and the **Hours per family
   per year** (default 20). Save.

Until a seva year is set, the whole module stays asleep: families see no
seva card and an empty Seva page (`/family/seva`), the compliance report is
empty, and trying to post an opportunity is rejected with "Set a seva year
first."

## Stage 1 — Post opportunities (`/welcome/seva`)

You need to be welcome-team **or** admin (admins automatically have
welcome-team access).

1. Click **New opportunity**.
2. Fill in the form:

| Field | What to enter |
|---|---|
| Title | A short name, e.g. "Diwali hall setup" (required) |
| Date | Pick from the calendar (required) |
| Default hours | What a volunteer typically earns, e.g. 2 (required, must be more than 0 — you can adjust per family later when you confirm) |
| Capacity | How many families can sign up — **leave blank for unlimited** |
| Location | e.g. "Brampton" (optional) |
| Description | What families will be helping with (optional) |

3. Save. The opportunity is posted as **open** and belongs to the current
   seva year.

Each opportunity card offers three actions: **View roster**, **Edit** (same
form — you can change any field), and **Close**. Closing stops new sign-ups
(families see "Sign-ups are closed for this one") but keeps existing
sign-ups intact, and you can still work the roster — close it once the event
is full or has passed. There is no delete; closed cards just dim in the
list.

## Stage 2 — Families sign up (`/family/seva` + dashboard card)

You don't do anything in this stage, but knowing what families see helps
when they come to the desk with questions.

1. Families find seva via the **Seva** tab (bottom of the screen on a phone,
   sidebar on a computer) or the dashboard's progress card ("Find seva →").
2. Their Seva page (`/family/seva`) shows a goal band — **"X of Y hours of
   seva this year"** — and every open opportunity for the current year with
   its date, hours, location, and **spots left**.
3. To sign up, they pick **"Whole family"** or choose a specific member from
   the dropdown, then tap **Sign up**. *Any* signed-in family member can do
   this (not just the manager). Each family can sign up once per
   opportunity.
4. **Cancel** is available any time *before* hours are confirmed (from the
   card or the "My sign-ups" list). If they sign up again later, the same
   sign-up simply comes back to life.
5. Messages families may run into: "That opportunity just filled up" (no
   spots left) and "Sign-ups are closed for this one" (staff closed it).
   Also, once a sign-up has been confirmed it can't be cancelled or
   re-created — confirmed hours are protected.

Pending sign-ups never inflate the hours number — the goal band counts
**confirmed hours only**, with a separate "You're signed up for N
opportunities — thank you" line.

## Stage 3 — Confirm hours after the event (`/welcome/seva/{opportunity}`)

1. Open the opportunity's roster: click **View roster** on the card.
2. The list is sorted so the work is at the top: **To confirm** → Completed
   → No-show, with a live count band above it.
3. For each family that signed up:
   - Click **Mark completed**. An inline hours editor opens, pre-filled with
     the opportunity's default hours. Adjust if this family did more or less
     (half-hours are allowed), then click Confirm. **This is the moment the
     hours become real.**
   - Click **No-show** if the family didn't come — one tap, records 0 hours.
4. Mistakes are always fixable:
   - A completed row has **Edit hours** (e.g. fix an accidental 5 → 3 —
     re-saving simply replaces the awarded hours).
   - A no-show row has **Mark completed** to flip it back and award hours.
5. A sign-up the family already **cancelled** never appears for
   confirmation.

The roster and confirmation keep working after an opportunity is closed, so
the normal rhythm is: event happens → close the opportunity → confirm the
roster.

## Stage 4 — Everyone watches progress

- **Families:** the dashboard **Seva progress card** (heart icon, which
  turns into a filled check at goal) shows "X of Y hours", a progress bar,
  and "N hours to go" or "Goal reached — thank you for your seva". The same
  numbers appear on their Seva page (`/family/seva`).
- **You:** each family's detail page (`/welcome/family/{fid}`) shows a
  "Seva hours" card with their total and a **Met / Short** pill.

## Stage 5 — The compliance report (`/welcome/seva/compliance`)

Reached from the **Compliance report** button on `/welcome/seva`. It lists
**every registered family** — including those with zero sign-ups, shown at
"0 of 20" — with hours earned, a Met/Short pill, and a progress bar, sorted
**shortest first** so the families needing a nudge sit at the top. The
summary line reads "N of M families have met the 20-hour target." Each row
links straight to that family's detail page (their contact info is there
for follow-up calls). For now the report is browse-only — there is no CSV
export.

## Year-end: rolling the seva year

⚠️ **The seva year does NOT change on its own when the school year rolls
over.** It is a separate, deliberate admin step: edit the requirement panel
on `/welcome/seva` and type the new year. (It has the same once-a-year
rhythm as the rollover's other manual follow-up steps, like the prasad
update.)

When you change it:

- Every family's display resets to "0 of 20".
- Old-year opportunities and sign-ups disappear from all views. The
  information is kept, just no longer shown — there is no past-years
  history screen yet.
- New opportunities belong to the new year.

Until you change it, new opportunities keep landing in the **old** year —
so update the year **before** posting the new year's first opportunity.

## Quick reference

| Who | Where | What you do |
|---|---|---|
| Admin | Requirement panel on `/welcome/seva` | Set the seva year + hours target (this switches the module on) |
| Welcome-team / admin | `/welcome/seva` | Post, edit, and close opportunities |
| Welcome-team / admin | `/welcome/seva/{opportunity}` | Confirm hours (mark completed with editable hours, mark no-show, fix mistakes) |
| Welcome-team / admin | `/welcome/seva/compliance` | See which families have met the target, shortest first |
| Family (any member) | `/family/seva` + dashboard card | Browse open opportunities, sign up (whole family or one member), cancel, watch progress |

**What a sign-up can be:**

- **Signed up** — pending. The family can still cancel; it holds a capacity
  spot, but no hours count yet.
- **Completed** — you confirmed it; hours are awarded and can still be
  corrected.
- **No-show** — 0 hours; can be flipped back to completed.
- **Cancelled** — the family backed out before confirmation; if they sign up
  again, the same sign-up comes back to life.

**What an opportunity can be:** **open** or **closed**. Closing stops new
sign-ups and never touches existing ones.

## Notes for developers

- Spec: `docs/superpowers/specs/2026-06-05-seva-hours-design.md`
  (+ slice plans A–D under
  `docs/superpowers/plans/2026-06-0{5,6}-seva-hours-slice-*.md`).
- Collections: `seva_opportunities` (id = UUID) and `seva_signups`
  (id = `{oppId}__{fid}` — one per family per opportunity); config lives in
  `app_config/seva_requirement`. One composite index:
  `seva_opportunities(sevaYear,status,date)` — deploy to prod at cutover, no
  `--force`. `seva_signups` deliberately has **no** composite index (all
  queries single-field + in-memory) — any future two-field query must add its
  index in the same commit.
- Status enums: sign-ups are `signed-up` → `completed` | `no-show`, plus
  `cancelled` (re-signup reactivates the same doc); opportunities are
  `open` ↔ `closed`.
- The "prasad update" referenced under Year-end is the `CURRENT_PRASAD_PIDS`
  bump done at each school-year rollover.
- No feature flag — gated purely by roles (`isSetuFamily` for
  `/api/setu/seva/*`, `isWelcomeTeam` for `/api/welcome/seva/*`, admin for
  the requirement).
- The capacity check is read-then-write (not transactional) — a same-instant
  race for the last spot can oversubscribe by one; accepted at current scale.
- Known gap: seva has **no Playwright E2E** yet (it predates the
  every-feature-E2E rule) — coverage is unit/route tests + manual UAT
  walkthroughs from the slice plans.

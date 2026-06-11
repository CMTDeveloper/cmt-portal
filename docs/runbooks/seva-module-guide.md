# Seva module — how it works, end to end

Every registered family is asked to contribute a yearly seva-hours target
(default **20 hours/family/year**). The portal tracks it through a simple
loop: staff **post opportunities** → families **sign up** → staff **confirm
hours** after the event → everyone watches progress on their dashboard. v1 is
**track & remind only** — nothing is ever blocked for falling short, and
there is no free-form self-logging: hours only exist when a sevak confirms
them.

Spec: `docs/superpowers/specs/2026-06-05-seva-hours-design.md`
(+ slice plans A–D under `docs/superpowers/plans/2026-06-0{5,6}-seva-hours-slice-*.md`).

> Naming note: this module is **seva hours** (volunteering). The "Sevak"
> screen at `/admin/users` is unrelated — that's staff roles.

---

## Stage 0 — Admin sets the seva year (one-time per year, admin-only)

1. Go to **`/welcome/seva`**. The requirement panel at the top shows the
   current seva year and the hours target. Only **admins** see the
   "Edit requirement" button (plain welcome-team sees "Admin-managed").
2. Set the **Seva year** (free text, e.g. `2026-27`) and **Hours per family
   per year** (default 20). Save.

Until a seva year is set, the whole module is dormant: families see no seva
card and an empty `/family/seva`, the compliance report is empty, and posting
an opportunity is rejected with "Set a seva year first."

## Stage 1 — Staff post opportunities (`/welcome/seva`)

Welcome-team **or** admin (admin inherits welcome-team). Click
**New opportunity** and fill in:

| Field | Notes |
|---|---|
| Title | e.g. "Diwali hall setup" (required) |
| Date | calendar picker (required) |
| Default hours | what a volunteer typically earns, e.g. 2 (required, > 0; confirmer can adjust per family later) |
| Capacity | how many families can sign up — **leave blank for unlimited** |
| Location | e.g. "Brampton" (optional) |
| Description | what families will be helping with (optional) |

The opportunity is posted **open** and stamped with the current seva year.
Each card offers **View roster**, **Edit** (same form, any field), and
**Close**. Closing stops new sign-ups (families see "Sign-ups are closed for
this one") but keeps existing sign-ups intact and the roster fully workable —
close it once the event is full or has passed. There is no delete; closed
cards just dim in the list.

## Stage 2 — Families sign up (`/family/seva` + dashboard card)

1. Families find seva via the **Seva** tab (mobile bottom nav / desktop
   sidebar) or the dashboard's progress card ("Find seva →").
2. `/family/seva` shows a goal band — **"X of Y hours of seva this year"** —
   and every open opportunity for the current year with date, hours,
   location, and **spots left**.
3. Signing up: pick **"Whole family"** or credit a specific member from the
   dropdown, then **Sign up**. *Any* signed-in family member can do this (not
   just the manager). One sign-up per family per opportunity.
4. **Cancel** is available any time *before* hours are confirmed (from the
   card or the "My sign-ups" list). Re-signing up later just reactivates the
   same sign-up.
5. Edge cases families may hit: "That opportunity just filled up" (capacity
   reached), "Sign-ups are closed for this one" (staff closed it), and an
   already-confirmed sign-up can't be cancelled or re-created — confirmed
   hours are protected.

Pending sign-ups never inflate the hours number — the goal band counts
**confirmed hours only**, with a separate "You're signed up for N
opportunities — thank you" line.

## Stage 3 — Staff confirm hours after the event (`/welcome/seva/{opportunity}`)

Open the opportunity's **roster** (View roster on the card). The list is
sorted action-first: **To confirm** → Completed → No-show, with a live count
band at the top.

For each family that signed up:

- **Mark completed** — opens an inline hours editor pre-filled with the
  opportunity's default hours; adjust if this family did more or less
  (half-hours allowed), then Confirm. This is the moment hours become real.
- **No-show** — one tap, records 0 hours.
- **Corrections are always possible:**
  - a completed row has **Edit hours** (e.g. fix an accidental 5 → 3 —
    re-saving simply overwrites the awarded hours);
  - a no-show row has **Mark completed** to flip it back with hours.
- A sign-up the family already **cancelled** never appears for confirmation.

Roster + confirmation keep working after an opportunity is closed, so the
normal rhythm is: event happens → close the opportunity → confirm the roster.

## Stage 4 — Everyone watches progress

- **Families:** the dashboard **Seva progress card** (heart icon → filled
  check at goal) shows "X of Y hours", a progress bar, and "N hours to go" or
  "Goal reached — thank you for your seva". Same numbers on `/family/seva`.
- **Staff:** each family's detail page (`/welcome/family/{fid}`) shows a
  "Seva hours" card with their total and a **Met / Short** pill.

## Stage 5 — The compliance report (`/welcome/seva/compliance`)

Reached from the **Compliance report** button on `/welcome/seva`. It lists
**every registered family** — including those with zero sign-ups at
"0 of 20" — with hours earned, a Met/Short pill, and a progress bar, sorted
**shortest first** so the families needing a nudge are at the top. The
summary line reads "N of M families have met the 20-hour target." Each row
links straight to that family's detail page (contacts there for follow-up
calls). Browse-only in v1 — no CSV export.

## Year-end: rolling the seva year

⚠️ **The seva year does NOT roll over with the school-year rollover** — it's
a separate, deliberate admin action: edit the requirement panel on
`/welcome/seva` and set the new year (same cadence as the rollover's other
manual follow-ups, like the prasad pid bump).

When you change it: every family's display resets to "0 of 20", old-year
opportunities and sign-ups disappear from all views (the data is retained,
just no longer shown — there's no past-years history screen in v1), and new
opportunities stamp the new year. Until you bump it, new opportunities keep
landing in the old year — so do it before posting the new year's first
opportunity.

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | `/welcome/seva` requirement panel | Set seva year + hours target (the module's on-switch) |
| Welcome-team / admin | `/welcome/seva` | Post / edit / close opportunities |
| Welcome-team / admin | `/welcome/seva/{opportunity}` | Confirm hours (completed w/ editable hours · no-show · corrections) |
| Welcome-team / admin | `/welcome/seva/compliance` | Met/Short report across all families, shortest first |
| Family (any member) | `/family/seva` + dashboard card | Browse open opportunities, sign up (whole family or credit a member), cancel, watch progress |

**Sign-up statuses:** `signed-up` (pending — cancellable, counts a capacity
seat, no hours) → `completed` (confirmed, hours awarded, correctable) or
`no-show` (0 hours, flippable to completed) · `cancelled` (family backed out
pre-confirmation; re-signup reactivates it). **Opportunity statuses:** `open`
↔ `closed` (close stops sign-ups, never touches existing ones).

## Notes for developers

- Collections: `seva_opportunities` (id = UUID) and `seva_signups`
  (id = `{oppId}__{fid}` — one per family per opportunity); config lives in
  `app_config/seva_requirement`. One composite index:
  `seva_opportunities(sevaYear,status,date)` — deploy to prod at cutover, no
  `--force`. `seva_signups` deliberately has **no** composite index (all
  queries single-field + in-memory) — any future two-field query must add its
  index in the same commit.
- No feature flag — gated purely by roles (`isSetuFamily` for
  `/api/setu/seva/*`, `isWelcomeTeam` for `/api/welcome/seva/*`, admin for
  the requirement).
- The capacity check is read-then-write (not transactional) — a same-instant
  race for the last spot can oversubscribe by one; accepted at current scale.
- Known gap: seva has **no Playwright E2E** yet (it predates the
  every-feature-E2E rule) — coverage is unit/route tests + manual UAT
  walkthroughs from the slice plans.

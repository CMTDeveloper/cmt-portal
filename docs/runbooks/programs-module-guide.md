# Programs module — how it works, end to end

**What this is:** the part of the portal where admins set up everything CMT
offers (Bala Vihar, Tabla, Vocal, Yuva Kendra, Om Chanting…) and where
families find and join those programs.

It helps to know the three building blocks first. Everything else in this
guide builds on them:

1. **Program** — *what* CMT offers. It carries the name, who can join
   (children/adults, age range), and which features it uses (donations?
   levels? calendar? attendance?).
2. **Offering** — *when and where* a program runs: one term at one location,
   with its own dates and suggested-donation pricing. Example:
   Bala Vihar · Brampton · 2026-27. A program can have many offerings.
3. **Enrollment** — *one family joined one offering*. The family manager
   creates it (or the yearly school-year rollover creates it automatically),
   and the family's eligible members come along with it.

---

## Part 1 — Admin: setting up programs and offerings

### Create or edit a program

1. Open **Programs** (/admin/programs). You'll see every program with a count
   of its open offerings.
2. Click **"+ New program"** (or open an existing program to edit it).
3. Fill in the fields:

| Field | What it means |
|---|---|
| Label | The name families see — "Tabla", "Bala Vihar"… (the short internal name is created for you automatically) |
| Status | **active** (visible to families) · draft · archived |
| Locations | Which centers run it. Leave empty for a program with no location (e.g. online) |
| Term type | term (school year) · one-time · rolling |
| Eligibility | children / adults / anyone, plus an optional min–max age |
| Capabilities | Uses donations? · uses levels? · uses calendar? · attendance mode (none / check-in / teacher) |

The capabilities are the program's feature switches. **Uses donations**
decides whether families see a dakshina step when they enroll. **Uses
levels** plus the attendance mode control whether the teacher tooling
applies — that's Bala Vihar. A simple program like Om Chanting has
everything switched off.

### Add offerings (on the program's detail page)

1. Open the program from the list.
2. Find the **Offerings** panel and click **"+ New offering"**.
3. Fill in the fields:

| Field | What it means |
|---|---|
| Location | One of the program's locations, or "None (location-less)". ⚠️ **Locked after creation** — you can't change it later |
| Term label | e.g. "2026-27" |
| Start / end date | The term window (the end date must be after the start date) |
| Suggested donation by enrollment date | The pricing tiers — see "The money model" below. Only shown for donation programs |
| Payment source | **portal (Stripe)** for everything new; "legacy roster" exists only for the 2025-26 Bala Vihar cutover year |
| Enabled | ✓ means **enrollment is open**. This checkbox is the on/off switch families actually feel |

Handy extras on the offerings list:

- **Duplicate** pre-fills a copy with all dates shifted forward one year —
  the "clone last year" shortcut for non-Bala-Vihar programs.
- **Enable/Disable** is one click per row.
- If two enabled offerings for the same program and location overlap in
  dates, a warning appears. It's a warning only — it won't block you.

⚠️ **The most common pitfall:** if a program has no offering that is both
*enabled* and *not yet ended*, the program quietly disappears from the
family programs page — no error, just gone. The admin screens do warn you
("Families can't see this program yet…"). So if families say they can't
find a program, check two things first: is the offering's **Enabled** box
ticked, and has its end date passed?

### The yearly rhythm

For Bala Vihar, don't create next year's offerings by hand. Instead, use
**School year rollover** (/admin/school-year), Step 1 — it clones each Bala
Vihar offering and its levels into the new year and then promotes the
enrollments. See [the school-year rollover guide](school-year-rollover-guide.md).
For every other program, use **Duplicate**.

## Part 2 — Families: finding and joining a program

### Browse (/family/programs)

The **Programs** tab (bottom navigation on a phone, sidebar on a computer)
lists every active program that has at least one open offering for the
family. Each card shows either "Enroll →" or "✓ Enrolled · View enrollment".

### Enroll (/family/enroll/{program})

Here's what happens when a family taps Enroll:

1. The page shows **which family members the program applies to**. The
   eligibility rules (children/adults plus age range) are applied
   automatically — the family never picks individuals. If a member's age is
   unknown, they're given the benefit of the doubt and included.
2. If the program has more than one open offering (say, two terms), a picker
   appears. With just one, it's simply a confirm button.
3. **The wording changes with the program:**
   - *Donation programs* show the **dakshina block**: "$X per family ·
     suggested — Suggested, not required. The program runs entirely on family
     donations. Any amount welcome." (plus the tax-receipt footnote).
   - *Free programs* (e.g. Om Chanting) say: "This program has no donation
     requirement. Confirm enrollment below."
4. **Only the family manager can enroll.** Other family members see a
   disabled button that says so. Pressing Enroll creates the enrollment
   right away — and enrolling twice is harmless; it's the same enrollment.
5. For donation programs, the success screen flows straight into
   **"Continue to donation →"** (/family/donate), pre-filled with this
   enrollment's suggested amount and quick-pick chips. Paying is never
   required to be enrolled.

### Afterwards

- The family **dashboard** grows a card for each enrolled program. Bala
  Vihar gets the full card (attendance "X of Y Sunday classes" plus donation
  progress); other programs get a simpler card with an Enrolled pill and
  "View enrollment →".
- Once an enrollment is fully donated, the enroll page shows
  **"Paid · {term}"** with a thank-you panel.
- **Cancelling:** the family manager can cancel an enrollment. If they
  re-enroll later, the same enrollment simply comes back to life (with the
  suggested amount worked out fresh for the new date).

## Part 3 — The money model (suggested donation, never a fee)

- Each donation offering carries **pricing tiers by enrollment date** — for
  example, the full-year amount from September, and less for a family who
  joins in January. A family's suggested amount is the latest tier whose
  date has already arrived on the day they enroll (using Toronto dates).
- The amount is **suggested, not required** — it's dakshina. Nothing in the
  portal is ever blocked because a family hasn't paid.
- The amount a family sees is decided in this order:
  1. A **per-family override** set by the welcome team. There's no screen
     for this yet — ask the tech team to set one.
  2. Otherwise, the portal recalculates from the *current* tiers using the
     family's original enroll date. That means an admin price correction
     reaches families who already enrolled but haven't paid — while
     early-bird joiners keep their early-bird tier.
  3. Otherwise, the amount that was saved at the moment they enrolled (this
     only matters if the offering was later deleted).
- **Paid** means either: marked paid on the legacy roster (2025-26 Bala
  Vihar only), **or** the family's completed portal donations linked to that
  enrollment add up to the suggested amount. Payment chips appear on the
  family dashboard, the enroll page, and the welcome roster.

## Part 4 — What the welcome team sees (read-only)

- **Roster** (/welcome/roster): filter all families by program, see a
  payment chip per family, and export a CSV that includes program and
  override columns.
- **Reports** (/welcome/reports): enrollment headcounts per program and per
  level, with CSV export.
- **Member detail** (/welcome/family/{fid}/members/{mid}): the year-by-year
  Bala Vihar journey (grade and level for each school year).
- The welcome team **cannot** create or cancel enrollments — enrolling is
  something family managers do for themselves (plus the rollover's automatic
  promotion). The only thing the welcome team can change is a family's
  suggested-amount override — and since there's no screen for it yet, that
  goes through the tech team.

## Enrollment lifecycle (reference)

| State / detail | What it means |
|---|---|
| Active | The live enrollment. One per family per offering — enrolling again is safe and just lands on the same enrollment |
| Cancelled | The manager cancelled it, or the yearly rollover closed it while promoting the family to the new year. Each child's grade and level for that year are kept, so the year-by-year journey still shows |
| How it was created | By the family manager on the portal · by the welcome team (behind the scenes, via the tech team) · by the rollover's promotion · by first attendance (reserved for the future attendance module — not active yet) |

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | **Programs** (/admin/programs) | Create/edit programs (eligibility, capabilities, status) |
| Admin | /admin/programs/{key} | Add, edit, duplicate, enable offerings (dates, pricing tiers, payment source) |
| Admin | **School year rollover** (/admin/school-year) | Yearly Bala Vihar offering clone + enrollment promotion |
| Family manager | /family/programs → /family/enroll/{program} | Enroll (eligible members auto-selected), continue to dakshina, cancel |
| Family (anyone) | dashboard | Program cards, attendance (Bala Vihar), donation progress |
| Welcome team | /welcome/roster, /welcome/reports | Program filter, payment chips, headcounts, CSV; amount overrides (ask the tech team) |

## Notes for developers

- Spec: `docs/superpowers/specs/2026-05-30-multi-program-foundation-design.md`.
- Collections: `programs/{programKey}` (slug ids, dynamic — no enum),
  `offerings/{oid}` (admin-created ids are `{program}-{location|all}-{term}`;
  legacy/rollover ids like `bv-brampton-2025-26` persist), and
  `families/{fid}/enrollments/{fid}-{oid}` (deterministic id = idempotent
  enroll). `enrollments.pid` mirrors `oid` and is the teacher-roster join
  key — always written, optional on read for back-compat.
- Indexes in play: enrollments collectionGroup `(pid,status)` ·
  `(oid,status)` · `(programKey,status)`, plus the offerings composites — all
  in `firestore.indexes.json`; deploy to prod at cutover, never `--force`.
- Enrollment lifecycle fields: `status` is `active` | `cancelled`; the
  rollover closes enrollments as `promoted-{year}` (per-child grade/level
  snapshots preserved). `enrolledVia` is `family-initiated` (manager on the
  portal) · `welcome-team` (API) · `promotion` (rollover) ·
  `first-attendance` (reserved for the attendance module — not active yet).
- Welcome-team suggested-amount override: `PATCH
  /api/welcome/enrollments/{eid}/override` — no UI yet; this is the welcome
  team's only write.
- The dashboard's BV section must select by `programKey` via
  `selectBalaViharEnrollment` (lint-enforced) — never "first active
  enrollment" (the 2026-06-01 Tabla-hijack bug).
- `enrollFamily`/`getProgram` use Next `'use cache'` and throw outside a
  request context — scripts/seeds must write enrollment docs directly (the
  seed scripts document this).
- `enabled` is the only enrollment-window switch (no startDate gate — advance
  registration is allowed); capacity limits and richer enroll windows are
  deliberately deferred (multi-program spec §5).
- E2E coverage: `e2e/setu/programs.spec.ts`, `enroll-wording.spec.ts`, and
  the dashboard spec's enrolled-state assertions.

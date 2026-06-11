# Programs module — how it works, end to end

The programs module is how everything CMT offers (Bala Vihar, Tabla, Vocal,
Yuva Kendra, Om Chanting…) gets defined by admins and joined by families. It
has three layers, and the whole module makes sense once you see them:

1. **Program** — *what* CMT offers. Carries the name, who's eligible
   (children/adults, age range), and what features it uses (donations?
   levels? calendar? attendance?).
2. **Offering** — *when and where* a program runs: one term at one location
   with its own dates and suggested-donation pricing. Example:
   `Bala Vihar · Brampton · 2026-27`. A program can have many offerings.
3. **Enrollment** — *one family joined one offering*. Created by the family
   manager (or automatically by the school-year rollover), with the family's
   eligible members attached.

Spec: `docs/superpowers/specs/2026-05-30-multi-program-foundation-design.md`.

---

## Part 1 — Admin: setting up programs and offerings (`/admin/programs`)

### Create or edit a program

`/admin/programs` lists every program with its open-offerings count. **"+ New
program"** asks for:

| Field | Meaning |
|---|---|
| Label | "Tabla", "Bala Vihar"… (the key is derived automatically) |
| Status | **active** (visible to families) · draft · archived |
| Locations | which centers run it (none = location-less/online) |
| Term type | term (school year) · one-time · rolling |
| Eligibility | children / adults / anyone, optional min–max age |
| Capabilities | uses donations? · uses levels? · uses calendar? · attendance mode (none / check-in / teacher) |

The capabilities are the feature switches: `uses donations` decides whether
families see a dakshina step at enrollment; `uses levels` + attendance mode
control whether the teacher tooling applies (that's Bala Vihar); a simple
program like Om Chanting has everything off.

### Add offerings (the program's detail page)

Open the program → **Offerings** panel → **"+ New offering"**:

| Field | Meaning |
|---|---|
| Location | one of the program's locations, or "None (location-less)" — **locked after creation** |
| Term label | e.g. "2026-27" |
| Start / end date | the term window (end must be after start) |
| Suggested donation by enrollment date | the pricing tiers — see "The money model" below (only shown for donation programs) |
| Payment source | **portal (Stripe)** for everything new; "legacy roster" exists only for the 2025-26 BV cutover year |
| Enabled | ✓ = **enrollment open** — this checkbox is the on/off switch families feel |

Handy extras: **Duplicate** pre-fills a copy with all dates shifted +1 year
(the "clone last year" path for non-BV programs); **Enable/Disable** is one
click per row; an overlap warning appears if two enabled offerings for the
same program+location overlap (warning only, not a block).

⚠️ **The most common pitfall:** a program with no *enabled, not-yet-ended*
offering is **silently invisible** on the family programs page. The admin
screens warn about this ("Families can't see this program yet…") — if
families say they can't find a program, check its offering's Enabled box and
end date first.

### Yearly cadence

For Bala Vihar, don't create next year's offerings by hand — the
**school-year rollover** (`/admin/school-year`, Step 1) clones each BV
offering and its levels into the new year and then promotes the enrollments
(see `school-year-rollover-guide.md`). For other programs, use Duplicate.

## Part 2 — Families: finding and joining a program

### Browse (`/family/programs`)

The **Programs** tab (mobile bottom nav / desktop sidebar) lists every active
program that has at least one open offering for the family. Cards show
"Enroll →" or "✓ Enrolled · View enrollment".

### Enroll (`/family/enroll/{program}`)

1. The page shows **which family members the program applies to** —
   eligibility (children/adults + age range) is applied automatically; the
   family never picks individuals. If a member's age is unknown, they're
   given the benefit of the doubt.
2. If the program has multiple open offerings (e.g. two terms), a picker
   appears; with one, it's just a confirm button.
3. **Wording depends on the program:**
   - *Donation programs* show the **dakshina block**: "$X per family ·
     suggested — Suggested, not required. The program runs entirely on family
     donations. Any amount welcome." (and the tax-receipt footnote).
   - *Free programs* (e.g. Om Chanting): "This program has no donation
     requirement. Confirm enrollment below."
4. **Only the family manager can enroll** — other members see a disabled
   button saying so. Pressing Enroll creates the enrollment instantly
   (enrolling twice is harmless — it's the same enrollment).
5. For donation programs, the success path continues straight to
   **"Continue to donation →"** (`/family/donate`), pre-filled with this
   enrollment's suggested amount and quick-pick chips. Paying is never
   required to be enrolled.

### Afterwards

- The **dashboard** grows a card per enrolled program. Bala Vihar gets the
  full card (attendance "X of Y Sunday classes", donation progress); other
  programs get a simpler card with an Enrolled pill and "View enrollment →".
- Once an enrollment is fully donated, the enroll page shows
  **"Paid · {term}"** with a thank-you panel.
- **Cancel:** the manager can cancel an enrollment; re-enrolling later simply
  re-activates it (with the suggested amount recomputed for the new date).

## Part 3 — The money model (suggested donation, never a fee)

- Each donation offering carries **pricing tiers by enrollment date** — e.g.
  full-year $X from September, less for a January join. A family's suggested
  amount is the latest tier whose date has arrived when they enroll
  (Toronto dates).
- The amount is **suggested, not required** — dakshina. Nothing is gated on
  payment.
- The amount a family sees is resolved in this order:
  1. a **per-family override** set by the welcome team (API:
     `PATCH /api/welcome/enrollments/{eid}/override` — no UI yet);
  2. otherwise a live recompute from the *current* tiers at their original
     enroll date — so an admin price correction reaches already-enrolled
     unpaid families, while early-bird joiners keep their early-bird tier;
  3. otherwise the snapshot frozen at enrollment (if the offering was
     deleted).
- **Paid** = legacy-roster paid (2025-26 BV only) **or** completed portal
  donations linked to that enrollment reaching the suggested amount. Payment
  chips show up on the family dashboard/enroll page and on the welcome
  roster.

## Part 4 — What the welcome team sees (read-only)

- **Roster** (`/welcome/roster`): filter all families by program, payment
  chip per family, CSV export with program + override columns.
- **Reports** (`/welcome/reports`): enrollment headcounts per program and per
  level, with CSV.
- **Member detail** (`/welcome/family/{fid}/members/{mid}`): the year-by-year
  Bala Vihar journey (grade + level per school year).
- The welcome team **cannot** create or cancel enrollments — enrollment is
  family-manager self-serve (plus the rollover's automatic promotion). Their
  only write is the suggested-amount override.

## Enrollment lifecycle (reference)

| Status / path | Meaning |
|---|---|
| `active` | the live enrollment (one per family per offering — re-enrolling is idempotent) |
| `cancelled` | manager cancelled, or the rollover closed it as `promoted-{year}` (with per-child grade/level snapshots preserved for the journey) |
| `enrolledVia` | `family-initiated` (manager on the portal) · `welcome-team` (API) · `promotion` (rollover) · `first-attendance` (reserved for the attendance module — not active yet) |

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | `/admin/programs` | Create/edit programs (eligibility, capabilities, status) |
| Admin | `/admin/programs/{key}` | Add/edit/duplicate/enable offerings (dates, pricing tiers, payment source) |
| Admin | `/admin/school-year` | Yearly BV offering clone + enrollment promotion |
| Family manager | `/family/programs` → `/family/enroll/{program}` | Enroll (eligible members auto-selected), continue to dakshina, cancel |
| Family (anyone) | dashboard | Program cards, attendance (BV), donation progress |
| Welcome team | `/welcome/roster`, `/welcome/reports` | Program filter, payment chips, headcounts, CSV; amount overrides (API) |

## Notes for developers

- Collections: `programs/{programKey}` (slug ids, dynamic — no enum),
  `offerings/{oid}` (admin-created ids are `{program}-{location|all}-{term}`;
  legacy/rollover ids like `bv-brampton-2025-26` persist), and
  `families/{fid}/enrollments/{fid}-{oid}` (deterministic id = idempotent
  enroll). `enrollments.pid` mirrors `oid` and is the teacher-roster join
  key — always written, optional on read for back-compat.
- Indexes in play: enrollments collectionGroup `(pid,status)` ·
  `(oid,status)` · `(programKey,status)`, plus the offerings composites — all
  in `firestore.indexes.json`; deploy to prod at cutover, never `--force`.
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

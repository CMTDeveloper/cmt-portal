# School-year rollover — how it works and how to run it

Once a year, the portal moves every Bala Vihar family from the ending school
year to the new one: each child's grade advances one rung, Grade 12 students
graduate, the old year's enrollments close (with history preserved), and new
active enrollments are created under the new year. The whole thing is two
guided buttons at **`/admin/school-year`**, with a dry-run preview before
anything is written.

Spec: `docs/superpowers/specs/2026-06-07-bala-vihar-school-year-rollover-design.md`
(+ the Set-grade follow-up plan `docs/superpowers/plans/2026-06-09-rollover-set-grade.md`).

---

## The mental model (read this first)

- **Promotion is grade-driven, never level-driven.** A child has no stored
  "level" — only `schoolGrade`. Their level is always re-derived from the new
  year's grade bands. That's why two-grades-per-level just works: Brampton
  Level 2 holds Grades 2–3, so a Grade 2→3 child *stays* in Level 2 while a
  Grade 3→4 child *moves* to Level 3 — with zero special-casing.
- **The grade ladder** is `JK → SK → 1 → 2 → … → 12` (14 rungs). Grades are
  normalized on both sides ("Grade 3", "Gr. 3", and "3" all match), and the
  rollover writes back the canonical form.
- **History is preserved, not rewritten.** The old enrollment is closed with a
  per-child snapshot of the grade/level they finished; the child's profile
  shows the full "Bala Vihar journey" across years.

### What happens to each child (the five outcomes)

| Outcome | When | Effect |
|---|---|---|
| **Advance** | Has a grade on the ladder below 12 | Grade +1 rung; enrolled in the new year; level re-derived from the new grade |
| **Graduate** | Grade 12 | Year closed with snapshot; no new enrollment; drops off rosters; grade unchanged |
| **Shishu stays** | No grade, age 18–59 months (from `birthMonthYear`) | Re-enrolled in Shishu for the new year; no grade written |
| **Shishu aged out** | No grade, age ≥ 60 months | **Needs attention** — a human must set JK/SK |
| **Needs grade** | No grade and no usable birth date, or an off-ladder grade ("kindergarten", "13") | **Needs attention** — fix the grade, then re-run |

A family where *every* child needs attention is left completely untouched —
its old-year enrollment stays **active** so a re-run picks it up after you fix
the data. Nobody gets stranded.

---

## Step 0 — Prerequisites

1. **Firestore index**: the rollover discovers families via a
   `enrollments(oid, status)` collection-group query. The index is in
   `firestore.indexes.json` and deployed to UAT. At prod cutover it must be
   deployed to 715b8 first — **never with `--force`** (shared project; a
   forced deploy deletes the door-app's indexes).
2. **Grades on file**: the cleaner the `schoolGrade` data, the smaller the
   need-attention list. You can fix grades during the flow (below), so this
   isn't blocking.
3. Admin role required — the page and all three APIs are admin-only.

## Step 1 — "Start {next year}" (clone the scaffolding)

Open `/admin/school-year`. The header shows **Active year → Next year**; the
Next-year card reads "Ready" once Step 1 has run.

Click **Start 2026-27** (or whatever the next year is). This clones, for each
location:

- **Offerings** — `bv-brampton-2025-26` → `bv-brampton-2026-27` etc., with
  start/end dates shifted exactly one year and pricing tiers carried over.
- **Donation periods** — a mirror doc so the legacy admin dropdowns keep
  working.
- **Levels** — same names, grade bands, curriculum, and order — but with
  **empty teacher assignments** (`teacherRefs: []`). Re-assigning teachers is
  deliberately a manual post-rollover step.

**Idempotent by design:** anything that already exists is skipped, never
overwritten — so the **Re-sync** button is always safe and will never clobber
teachers you've already assigned to the new year's levels. The toast tells you
what was created vs. kept.

What Step 1 does **not** do: the new year's class calendar (enter it via
`/admin/calendar`) and teacher assignments (`/admin/levels`).

## Step 2 — Preview the promotion (nothing is written)

Step 2 stays locked until Step 1 is done. Click **Preview run**. The portal
finds every family with an active old-year BV enrollment and computes each
child's outcome. You see:

- **Three stat blocks** — *moving up* (with an "incl. N Shishu continuing"
  sub-line), *graduate*, and *need attention*.
- **"Where students move"** — proportional bars per level transition
  (e.g. "Level 2 → Level 3: 48"), so you can sanity-check class sizes before
  committing.
- **Graduating (N)** — collapsible name list of the Grade 12s.
- **Need attention (N)** — open by default; each row shows the child, the
  reason ("no grade set" / "aged out of Shishu"), and two actions.

The banner says it plainly: *"Nothing has changed yet — this is a preview."*
**Refresh preview** re-runs it any time.

## Step 3 — Fix the "Need attention" rows

Two ways, both admin-only and both writing the same endpoint:

1. **Inline, right on the row**: pick a grade from the **"Set grade…"**
   dropdown (ladder values only — JK, SK, Grade 1–12) and hit **Save**. The
   preview refreshes automatically and the fixed child drops out of the list.
2. **From the member page**: the **Review →** pill opens
   `/welcome/family/{fid}/members/{mid}`, where admins see an
   **"Admin · Set grade"** editor below the child's profile (plain
   welcome-team volunteers see the page read-only).

**Shishu note:** a Shishu-age child is promoted **by age, not grade** — only
set a grade once they're genuinely in JK or older. (The grade dropdown
deliberately has no Shishu option.) In the 2025-26→2026-27 UAT run, all 24
need-attention children were Shishu Pre-K and were *intentionally left out* —
they're handled at normal registration, not by forcing grades.

You don't have to clear the whole list: you can commit with attention rows
remaining. Those families stay on the old year and a later re-run promotes
them once fixed.

## Step 4 — Commit

Click **Promote N students →**. A confirmation dialog spells out the deal:
*"This advances grades and closes the {year} enrollments. Every child's
history is preserved. This can't be undone with one click."*

On confirm, the portal processes **one atomic transaction per family**:

1. each advancing child's `schoolGrade` is bumped to the next rung;
2. the old enrollment is set `cancelled` with reason `promoted-{newYear}` and
   per-child snapshots of the *finishing* grade/level;
3. a new **active** enrollment is created under the new year's offering
   (`enrolledVia: 'promotion'`, with the promoted children, the new pricing
   snapshot, and per-child snapshots of the *starting* grade/level).

Families that only graduated get their year closed but no new enrollment.
Untouched: need-attention-only families (still active on the old year).

**Safety properties:**
- *Per-family atomic* — a crash mid-run can leave the batch partially done,
  but never a half-written family; just run commit again.
- *Re-run safe* — any family already holding an active new-year enrollment is
  skipped (counted as "already promoted"). The UAT run verified this: a second
  commit found 0 to promote.
- *No one-click undo* — reversing a commit is manual data surgery. That's what
  the preview is for.

The result card shows promoted/graduated/skipped counts, a **View rosters →**
link to `/admin/levels`, and a **Re-run preview** button as the idempotency
proof (expect "All families are already on the new year").

## Step 5 — The after-commit checklist (still yours)

1. **Assign teachers** to the new year's levels at `/admin/levels` — they all
   start empty. Teachers attach to levels (not enrollments), so order doesn't
   matter.
2. **Enter the new class calendar** at `/admin/calendar` per location
   (including the "prasad needed" toggles).
3. **Bump `CURRENT_PRASAD_PIDS`**
   (`apps/portal/src/features/setu/prasad/constants.ts`) to the new year's
   pids — a code change + deploy — then publish fresh prasad proposals from
   `/admin/prasad`. Without the bump, prasad silently keeps running against
   the old year.
4. **Resolve leftover need-attention children** (set grade → re-run preview →
   commit; already-promoted families are skipped automatically).
5. **Verify like a user**: open a teacher's level roster for the new year and
   confirm the promoted kids appear; check a family's child profile shows
   "{old year} Completed / {new year} Active" on the journey strip.
   (`pnpm --filter @cmt/portal inspect:brampton-level` is the read-only
   roster-size checker.)
6. **Bump the test fixtures** (dev task): `seed-e2e-family.ts` (`BV_OID`),
   `seed-test-accounts.ts` (enrollment oids, teacher level picks, prasad pid),
   and the E2E level-id constants in `test-accounts.spec.ts` /
   `prasad.spec.ts` all pin the old year and need the new pids.

## CLI equivalents (same engines, same writes)

For ops/scripted runs — both UAT-guarded (refuse non-`chinmaya-setu-uat`
unless `--allow-prod`):

```bash
pnpm --filter @cmt/portal school-year:start   -- --dry-run   # preview Step 1
pnpm --filter @cmt/portal school-year:start                  # run Step 1
pnpm --filter @cmt/portal school-year:promote -- --dry-run   # preview Step 2
pnpm --filter @cmt/portal school-year:promote                # commit Step 2
# extras: --from 2025-26 --to 2026-27 --limit N --fid CMT-XXXXXXXX
```

One difference vs. the UI: CLI commits don't refresh the portal's per-family
caches (the UI route does), so pages can look stale briefly after a CLI run.

## Reference — the 2025-26 → 2026-27 UAT run (2026-06-07)

- Step 1 created **18 new 2026-27 levels** (10 Brampton + 8 Scarborough).
- Step 2 committed: **512 families · 769 promoted · 23 graduated · 24 need
  attention** (all Shishu Pre-K, deliberately left for registration).
- Two-grades-per-level verified on real data: Level 2→Level 2: 51 kids,
  Level 2→Level 3: 48; Pre-Level 1→Pre-Level 1: 31, Pre-Level 1→Level 1: 52.
- Re-run: 0 to promote (idempotency confirmed).
- ⚠️ **Known UAT-only state quirk**: on 2026-06-09 the legacy roster backfill
  was re-run to restore teacher rosters for development; it re-asserted
  2025-26 grades and re-activated 2025-26 enrollments *after* the rollover —
  so UAT currently has both years active for many families. This is a dev
  convenience, not a rollover bug; prod will run the sequence once, in order.

## Quick reference

| Who/what | Where | Does |
|---|---|---|
| Admin | `/admin/school-year` | Step 1 Start (clone offerings/levels/periods) → Step 2 Preview → fix grades → Commit |
| Admin | need-attention rows / `/welcome/family/{fid}/members/{mid}` | Set grade (ladder values only; never for Shishu-age kids) |
| Admin | `/admin/levels`, `/admin/calendar`, `/admin/prasad` | Post-rollover: teachers, calendar, prasad re-publish |
| Engine | `decidePromotion` (shared-domain) | advance · graduate · shishu-stays · shishu-aged-out · needs-grade |
| Data | `members.schoolGrade`, `enrollments/{fid}-{oid}` | Grade +1; old enrollment cancelled `promoted-{year}` + snapshots; new active enrollment with `pid` |

**Statuses after a rollover:** old enrollment `cancelled` (reason
`promoted-{year}`, snapshots frozen) · new enrollment `active`
(`enrolledVia:'promotion'`) · graduate: old year closed, nothing new ·
need-attention family: old year still `active`, waiting for a fix + re-run.

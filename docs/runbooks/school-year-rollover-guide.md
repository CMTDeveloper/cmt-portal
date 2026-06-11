# School-year rollover — how it works and how to run it

**What this is:** the once-a-year job of moving every Bala Vihar family from
the ending school year into the new one.

When you run it, each child's grade moves up one step, Grade 12 students
graduate, the old year's enrollments are closed (with history kept), and new
active enrollments are created for the new year. The whole thing is two
guided buttons on the **School year rollover** page (`/admin/school-year`),
with a preview step that changes nothing before anything is saved.

---

## How it works (read this first)

- **Promotion follows the child's grade, never their level.** A child's
  record stores only their school grade — not a level. Their level is always
  worked out fresh from the new year's grade bands. That's why levels that
  hold two grades just work: Brampton Level 2 holds Grades 2–3, so a child
  going from Grade 2 to 3 *stays* in Level 2, while a child going from
  Grade 3 to 4 *moves* to Level 3 — no special handling needed.
- **The grade ladder** is `JK → SK → 1 → 2 → … → 12` (14 steps). The system
  understands different spellings ("Grade 3", "Gr. 3", and "3" all match),
  and after the rollover every grade is saved in the standard form.
- **History is kept, not rewritten.** When the old year is closed, the system
  saves a snapshot of the grade and level each child finished with. The
  child's profile shows their full "Bala Vihar journey" across the years.

### What happens to each child (the five outcomes)

| Outcome | When | Effect |
|---|---|---|
| **Advance** | Has a grade on the ladder below 12 | Grade moves up one step; enrolled in the new year; level worked out from the new grade |
| **Graduate** | Grade 12 | Year closed with a snapshot; no new enrollment; drops off rosters; grade unchanged |
| **Shishu stays** | No grade, age 18–59 months (from the birth month/year on file) | Re-enrolled in Shishu for the new year; no grade written |
| **Shishu aged out** | No grade, age 60 months or more | **Needs attention** — a person must set JK/SK |
| **Needs grade** | No grade and no usable birth date, or a grade that isn't on the ladder ("kindergarten", "13") | **Needs attention** — fix the grade, then run again |

A family where *every* child needs attention is left completely untouched —
its old-year enrollment stays **active**, so running the rollover again picks
the family up after you fix the data. Nobody gets stranded.

---

## Step 0 — Before you start

1. **One-time tech setup**: before the rollover's first run in production,
   the tech team has to deploy a database index. ⚠️ There is an important
   safety warning for them about how to deploy it — see the **Notes for
   developers** section at the end of this guide.
2. **Grades on file**: the cleaner the grade data, the shorter the
   need-attention list will be. You can fix grades during the flow (see
   Step 3), so this doesn't block you.
3. **You need the admin role** — only admins can open the page or run any of
   the steps.

## Step 1 — "Start {next year}" (set up the new year's shell)

Open **School year rollover** (`/admin/school-year`). The header shows
**Active year → Next year**; the Next-year card reads "Ready" once Step 1
has run.

Click **Start 2026-27** (or whatever the next year is). For each location,
this copies the old year's setup into the new year:

- **Offerings** — each location's Bala Vihar offering is copied to the new
  year, with start and end dates shifted exactly one year and pricing tiers
  carried over.
- **Donation periods** — a matching entry so the legacy admin dropdowns keep
  working.
- **Levels** — same names, grade bands, curriculum, and order — but with
  **no teachers assigned**. Re-assigning teachers is deliberately a manual
  step for after the rollover.

**Safe to run again, by design:** anything that already exists is skipped,
never overwritten — so the **Re-sync** button is always safe and will never
wipe out teachers you've already assigned to the new year's levels. The
pop-up message tells you what was created and what was kept.

What Step 1 does **not** do: the new year's class calendar (enter it on the
class calendar page, `/admin/calendar`) and teacher assignments (done in
**Level management**, `/admin/levels`).

## Step 2 — Preview the promotion (nothing is saved)

Step 2 stays locked until Step 1 is done. Click **Preview run**. The portal
finds every family with an active old-year Bala Vihar enrollment and works
out each child's outcome. You see:

- **Three stat blocks** — *moving up* (with an "incl. N Shishu continuing"
  sub-line), *graduate*, and *need attention*.
- **"Where students move"** — bars for each level-to-level move
  (e.g. "Level 2 → Level 3: 48"), so you can sanity-check class sizes before
  committing.
- **Graduating (N)** — a collapsible list of the Grade 12 names.
- **Need attention (N)** — open by default; each row shows the child, the
  reason ("no grade set" / "aged out of Shishu"), and two actions.

The banner says it plainly: *"Nothing has changed yet — this is a preview."*
You can click **Refresh preview** to run it again at any time.

## Step 3 — Fix the "Need attention" rows

There are two ways, both admin-only, and both do exactly the same thing:

1. **Right on the row**: pick a grade from the **"Set grade…"** dropdown
   (ladder values only — JK, SK, Grade 1–12) and click **Save**. The preview
   refreshes by itself and the fixed child drops out of the list.
2. **From the child's page**: the **Review →** pill opens the child's member
   page (`/welcome/family/{fid}/members/{mid}`), where admins see an
   **"Admin · Set grade"** editor below the child's profile. (Plain
   welcome-team volunteers see the same page read-only.)

**Shishu note:** a Shishu-age child is promoted **by age, not grade** — only
set a grade once they're genuinely in JK or older. (The grade dropdown
deliberately has no Shishu option.) In the 2025-26→2026-27 trial run, all 24
need-attention children were Shishu Pre-K and were *intentionally left out* —
they're handled at normal registration, not by forcing grades on them.

You don't have to clear the whole list: you can commit with attention rows
still showing. Those families stay on the old year, and a later run promotes
them once they're fixed.

## Step 4 — Commit

Click **Promote N students →**. A confirmation dialog spells out the deal:
*"This advances grades and closes the {year} enrollments. Every child's
history is preserved. This can't be undone with one click."*

When you confirm, the portal handles each family one at a time, and each
family is updated all-or-nothing. For every family:

1. each advancing child's grade is moved up to the next step;
2. the old enrollment is closed, marked as promoted to the new year, with a
   snapshot of the grade and level each child *finished* with;
3. a new **active** enrollment is created under the new year, marked as
   created by promotion — with the promoted children, the new pricing, and a
   snapshot of the grade and level each child is *starting* with.

Families whose only children graduated get their year closed but no new
enrollment. Need-attention-only families are left alone (still active on the
old year).

**Safety, in plain terms:**
- *No half-finished families* — if something crashes mid-run, the batch can
  be partly done, but no single family is ever left half-updated. Just run
  commit again.
- *Safe to run again* — any family that already has an active new-year
  enrollment is skipped (counted as "already promoted"). The trial run
  proved this: a second commit found 0 families to promote.
- *No one-click undo* — reversing a commit means the tech team fixing data
  by hand. That's what the preview is for.

The result card shows the promoted / graduated / skipped counts, a
**View rosters →** link to **Level management** (`/admin/levels`), and a
**Re-run preview** button as proof it's safe to run again (expect "All
families are already on the new year").

## Step 5 — The after-commit checklist (still yours)

1. **Assign teachers** to the new year's levels in **Level management**
   (`/admin/levels`) — they all start empty. Teachers attach to levels (not
   enrollments), so the order you do this in doesn't matter.
2. **Enter the new class calendar** at `/admin/calendar` for each location
   (including the "prasad needed" toggles).
3. **Ask the tech team to point the prasad module at the new year** — it's a
   small code change plus a deploy (details in **Notes for developers**).
   Then publish fresh prasad proposals from the prasad admin page
   (`/admin/prasad`). Without this change, prasad silently keeps running
   against the old year.
4. **Resolve any leftover need-attention children**: set the grade, run the
   preview again, then commit again. Families already promoted are skipped
   automatically.
5. **Check it like a real user**: open a teacher's level roster for the new
   year and confirm the promoted kids appear; open a family's child profile
   and check the journey strip shows "{old year} Completed / {new year}
   Active". (The tech team also has a roster-size checking tool — see
   **Notes for developers**.)
6. **Ask the tech team to update the test fixtures** — several test setups
   pin the old year and need updating after every rollover (the list is in
   **Notes for developers**).

## Reference — the 2025-26 → 2026-27 trial run (2026-06-07, UAT)

- Step 1 created **18 new 2026-27 levels** (10 Brampton + 8 Scarborough).
- Step 2 committed: **512 families · 769 promoted · 23 graduated · 24 need
  attention** (all Shishu Pre-K, deliberately left for normal registration).
- Two-grades-per-level confirmed on real data: Level 2→Level 2: 51 kids,
  Level 2→Level 3: 48; Pre-Level 1→Pre-Level 1: 31, Pre-Level 1→Level 1: 52.
- Run again: 0 to promote (confirmed safe to re-run).
- ⚠️ **Known quirk in the test environment (UAT) only**: on 2026-06-09 the
  tech team re-ran the legacy roster import to restore teacher rosters for
  development work. That re-applied 2025-26 grades and re-activated 2025-26
  enrollments *after* the rollover — so UAT currently has both years active
  for many families. This is a development convenience, not a rollover bug;
  production will run the sequence once, in order.

## Quick reference

| Who | Where | Does |
|---|---|---|
| Admin | **School year rollover** (`/admin/school-year`) | Step 1 Start (copy offerings/levels/periods) → Step 2 Preview → fix grades → Commit |
| Admin | Need-attention rows, or the child's member page (`/welcome/family/{fid}/members/{mid}`) | Set the grade (ladder values only; never for Shishu-age kids) |
| Admin | `/admin/levels`, `/admin/calendar`, `/admin/prasad` | After the rollover: teachers, calendar, prasad re-publish |

**What things look like after a rollover:** the old year's enrollment is
closed and marked as promoted, with the history snapshots frozen · the new
year's enrollment is active and marked as created by promotion · a graduate's
old year is closed with nothing new created · a need-attention family stays
active on the old year, waiting for a fix and a re-run.

---

## Notes for developers

The technical companion to the guide above. Specs:
`docs/superpowers/specs/2026-06-07-bala-vihar-school-year-rollover-design.md`
(+ the Set-grade follow-up plan
`docs/superpowers/plans/2026-06-09-rollover-set-grade.md`).

### Firestore index prerequisite (Step 0)

The rollover discovers families via an `enrollments(oid, status)`
collection-group query. The composite index is in `firestore.indexes.json`
and deployed to UAT. At prod cutover it must be deployed to 715b8 first —
⚠️ **never with `--force`** (shared project; a forced deploy deletes the
door-app's indexes).

### Access & endpoints

- The `/admin/school-year` page and all three rollover APIs are admin-only.
- Both Set-grade paths in Step 3 (the inline row dropdown and the
  "Admin · Set grade" editor on the member page) write the same admin
  set-grade endpoint.

### Data details

- Shishu age is computed from `birthMonthYear` (18–59 months = stays;
  ≥ 60 months = aged out).
- Step 1 clones offerings as e.g. `bv-brampton-2025-26` →
  `bv-brampton-2026-27`; new-year levels are created with
  `teacherRefs: []`.
- Commit runs **one atomic Firestore transaction per family**:
  `members.schoolGrade` is bumped to the next rung; the old enrollment is set
  `cancelled` with reason `promoted-{newYear}` and per-child finishing
  grade/level snapshots; a new `active` enrollment is created under the new
  year's offering with `enrolledVia: 'promotion'`, the new pricing snapshot,
  and per-child starting grade/level snapshots.
- Statuses after a rollover: old enrollment `cancelled` (reason
  `promoted-{year}`, snapshots frozen) · new enrollment `active`
  (`enrolledVia:'promotion'`) · graduate: old year closed, nothing new ·
  need-attention family: old year still `active`, waiting for a fix + re-run.

| Layer | Where | Does |
|---|---|---|
| Engine | `decidePromotion` (shared-domain) | advance · graduate · shishu-stays · shishu-aged-out · needs-grade |
| Data | `members.schoolGrade`, `enrollments/{fid}-{oid}` | Grade +1; old enrollment cancelled `promoted-{year}` + snapshots; new active enrollment with `pid` |

### Prasad pointer bump (Step 5.3)

Bump `CURRENT_PRASAD_PIDS`
(`apps/portal/src/features/setu/prasad/constants.ts`) to the new year's
pids — a code change + deploy — then the admin publishes fresh prasad
proposals from `/admin/prasad`. Without the bump, prasad silently keeps
running against the old year.

### Verification helper (Step 5.5)

`pnpm --filter @cmt/portal inspect:brampton-level` is the read-only
roster-size checker.

### Test-fixture bumps (Step 5.6)

`seed-e2e-family.ts` (`BV_OID`), `seed-test-accounts.ts` (enrollment oids,
teacher level picks, prasad pid), and the E2E level-id constants in
`test-accounts.spec.ts` / `prasad.spec.ts` all pin the old year and need the
new pids after every rollover.

### CLI equivalents (same engines, same writes)

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

# Seva Hours — design (umbrella spec)

**Date:** 2026-06-05
**Status:** Approved direction (CMT Developer / Vaibhav). Umbrella spec; built slice by slice (A→D), each its own plan.

## Goal

Track a **20-hours-per-year seva (volunteer service) requirement** for **every
registered family**, fulfilled through **seva opportunities** that admin/welcome-team
post, families sign up for, and admin/welcome-team confirm — hours then accrue
automatically toward the family's yearly total. Enforcement is **track & remind
only** (no blocking) in v1.

## Locked decisions

- **Enforcement:** track & remind only — dashboard progress + reminders, nothing blocked. Data model is built so real gating (e.g. re-enrollment) can layer on later.
- **Scope:** every registered family (not just enrolled families). ⇒ a **global seva-year**, not one derived per-enrollment.
- **Recording model:** seva **opportunities + sign-up + confirmation** (the richer model), not a plain admin ledger.
- **Hours value:** each opportunity carries a `defaultHours`; the confirmer can **adjust the actual hours awarded** at confirmation.
- **Attribution:** one **family total** vs 20; each signup may **optionally credit a member** (`mid`), tying into the volunteering-skills profiles.
- **Delivery:** one umbrella spec; implement + ship slices A→D in order.

## Boundary — this is NOT the removed Events feature

The public **Events** feature was deliberately removed from the portal (events now
live at events.chinmayatoronto.org — see CLAUDE.md). **Seva** is a *separate,
internal* concept: admin/welcome-team-posted volunteer slots for the portal's own
families. Everything here is named `seva`, never `events`, and shares no code with
the deleted feature.

## Roles & access

- **Admin AND welcome-team** create/edit/close opportunities, view signup rosters, and confirm completions. (Welcome-team already has elevated front-desk powers — calendar publishing, teacher assignment — so this fits.) Management UI lives under `/welcome/seva/*` because `isWelcomeTeam` already includes admin (role.ts: admin inherits welcome-team), so one surface serves both.
- **Admin only** edits the requirement config (the 20-hr target + current seva-year) — it's a policy lever.
- **Families** (any setu family role) browse open opportunities and sign up / cancel at `/family/seva`.

## Data model

### Config — `app_config/seva_requirement`
`{ hoursPerYear: number (default 20), currentSevaYear: string e.g. "2025-26", updatedAt, updatedBy }`.
A **global** seva-year (the requirement spans all families, enrolled or not, so it
can't be derived from a program enrollment). Reuses the school-year string format
(`"2025-26"`) already used by offerings/enrollments. Read falls back to
`{ hoursPerYear: 20, currentSevaYear: <none> }` when unset; mirrors the
`getVolunteeringSkillOptions` read-with-default pattern.

### `seva_opportunities/{oppId}`
```
{ oppId, title, description, date: Date, location: string,
  defaultHours: number (>0), capacity: number | null (null = unlimited),
  sevaYear: string (stamped from config at create),
  status: 'open' | 'closed',
  createdAt, createdBy, updatedAt, updatedBy }
```

### `seva_signups/{signupId}` — top-level collection
Deterministic id `${oppId}__${fid}` ⇒ one signup per family per opportunity
(idempotent; a cancelled signup is reactivated on re-signup).
```
{ signupId, oppId, fid, mid: string | null (optional member credit),
  sevaYear: string (DENORMALIZED from the opportunity — lets the family
            yearly-total query avoid a join),
  status: 'signed-up' | 'completed' | 'no-show' | 'cancelled',
  hoursAwarded: number (0 until completed; defaultHours at confirm, adjustable),
  signedUpAt, signedUpByMid,
  confirmedAt: Date | null, confirmedBy: string | null }
```

### Derived — family seva progress
`hoursThisYear(fid) = Σ hoursAwarded` where `fid == fid AND sevaYear == currentSevaYear AND status == 'completed'`. Computed on read (dashboard, compliance) — same approach as the donations card. Target = config `hoursPerYear`.

### Firestore indexes (firestore.indexes.json — deploy to **UAT only**, never `--force` prod)
- `seva_signups (fid ASC, sevaYear ASC, status ASC)` — family yearly total.
- `seva_signups (oppId ASC, status ASC)` — per-opportunity roster.
- `seva_opportunities (sevaYear ASC, status ASC, date ASC)` — open-opportunities list.

## Flows

**Create → sign up → confirm → accrue:**
1. Admin/welcome creates an opportunity (stamped with `currentSevaYear`).
2. Family opens `/family/seva`, sees open opportunities for the current year, signs up (optionally crediting a member). Capacity, if set, blocks once full.
3. Admin/welcome opens the opportunity's signup roster and marks each signup **completed** (accept/adjust `hoursAwarded`) or **no-show** (0 hrs).
4. The family's seva total reflects confirmed hours; the dashboard card shows **"Seva hours · X of 20"** and a reminder when short.

**Lifecycle:**
- Opportunity: `open` (accepting) → `closed` (admin) ; "past" derived from `date`.
- Signup: `signed-up` → `completed` | `no-show` (confirmer) ; family may `cancel` before confirmation. Only `completed` counts toward hours.

## API surface

**Family — `/api/setu/seva/*` (gated `isSetuFamily`, added before the manager-only catch-all):**
- `GET /api/setu/seva/opportunities` — open opportunities for current seva-year + this family's signup status on each.
- `GET /api/setu/seva/my` — this family's signups + computed hours total + target.
- `POST /api/setu/seva/signups` — `{ oppId, mid? }`; binds `fid` from session, stamps `sevaYear` from the opportunity, enforces capacity.
- `POST /api/setu/seva/signups/{id}/cancel` — family cancels its own signup (pre-confirmation only).

**Management — `/api/welcome/seva/*` (gated `isWelcomeTeam`, which includes admin):**
- `GET/POST /api/welcome/seva/opportunities` (+ `[oppId]` `PATCH`/close).
- `GET /api/welcome/seva/opportunities/{oppId}/signups` — roster.
- `POST /api/welcome/seva/signups/{signupId}/confirm` — `{ status: 'completed'|'no-show', hoursAwarded? }`.
- `GET /api/welcome/seva/compliance` — families vs target for the current year.

**Config — admin only:**
- `GET/PUT /api/admin/seva/requirement` — `{ hoursPerYear, currentSevaYear }`.

**canAccessRoute additions:** `/api/setu/seva/*` → `isSetuFamily` (before the `/api/setu/*` catch-all); `/api/welcome/seva/*` → `isWelcomeTeam`; `/api/admin/seva/requirement` stays admin-only via the generic `/api/admin/*` rule. Pages: `/family/seva` (isSetuFamily, via `/family/*`), `/welcome/seva/*` (isWelcomeTeam, via `/welcome/*`).

## Surfaces

- **Family `/family/seva`:** open opportunities (sign up / cancel), "My signups" with statuses, and a progress header (X of 20).
- **Family dashboard card:** "Seva hours · X of 20" progress (mirrors the donation card) + a short reminder when short + link to `/family/seva`.
- **Management `/welcome/seva`:** opportunity list (create/edit/close) + `/welcome/seva/[oppId]` roster with confirm actions; `/welcome/seva/compliance` report.
- **Welcome family-detail (`/welcome/family/[fid]`):** show the family's seva hours for the current year.

## Slice decomposition (each ships independently; its own plan)

- **Slice A — Foundation + opportunity management.** Schemas (config, opportunity, signup) + the seva-year/requirement config read+write (admin) + opportunity CRUD APIs + `/welcome/seva` list & create/edit form + canAccessRoute + indexes. *Deliverable:* admin/welcome can post and manage opportunities.
- **Slice B — Family browse + sign-up.** `/family/seva` page; `GET /api/setu/seva/opportunities`, `GET /api/setu/seva/my`, `POST /api/setu/seva/signups`, cancel; capacity enforcement; canAccessRoute `/api/setu/seva/*`. *Deliverable:* families can see and sign up for opportunities.
- **Slice C — Confirmation + hours accrual.** `/welcome/seva/[oppId]` roster; confirm API (completed/no-show + hours); denormalized `sevaYear` + the family yearly-total query. *Deliverable:* confirmed seva turns into hours.
- **Slice D — Surfacing & compliance.** Dashboard "Seva hours" card + reminder; `GET /api/welcome/seva/compliance` + `/welcome/seva/compliance` report; seva hours on welcome family-detail; admin requirement-config editing UI. *Deliverable:* progress + compliance visible everywhere.

## Edge cases & rules

- **Capacity:** if set, block signup when `count(signed-up + completed) >= capacity`.
- **Double signup:** prevented by the deterministic `${oppId}__${fid}` id; re-signup after cancel reactivates the same doc.
- **Cancel/no-show:** cancelled and no-show signups award 0 and don't count.
- **Year rollover:** admin updates `currentSevaYear`; new opportunities stamp it; dashboard shows the new year (resets to 0); prior-year history retained.
- **Member credit:** optional `mid`; if that member is later removed, the signup keeps the historical `mid` and the UI degrades gracefully.
- **Unenrolled families:** still get a seva card (0 of 20) and can sign up — per the "every family" scope.

## Cross-cutting: mobile-app readiness + mobile view (ALL slices)

A native mobile app will consume these APIs later, so every slice builds them mobile-consumable:
- **Header-session auth, not cookies.** Handlers derive identity via `readSessionFromHeaders(req)` (the `x-portal-*` headers the middleware injects from EITHER the `__session` cookie OR an `Authorization: Bearer <ID token>`), never `getCurrentFamily()`/`cookies()` directly — so a Bearer-only mobile client works. (Especially the Slice B family signup route.)
- **Cross-origin clean** (middleware `applyCors` covers it), **JSON-only with ISO-string dates** and a consistent `{ data }` / `{ error }` envelope, numbers as numbers.
- **One shared contract:** request/response shapes live in `@cmt/shared-domain` Zod schemas, imported by both web and mobile.
- **Real mobile UI:** every screen ships a true mobile layout (`block md:hidden`) + desktop (`hidden md:block`), verified at ~375px.

## Out of scope (v1 — YAGNI)

- Enforcement teeth (blocking enrollment/actions) — track & remind only.
- Free-form family self-logging *without* an opportunity (all hours flow through opportunity + confirmation).
- Public event registration (separate — events.chinmayatoronto.org).
- Recurring opportunities, waitlists, email reminders, CSV export — possible future.

# Slice 4 — Teacher Views + Attendance (Design)

**Date:** 2026-05-29
**Status:** Design — pending review (open questions in §4 block the schema)
**Owner:** CMT Developer
**Related:** [2026 redesign brief §4.2 + §6.3](./2026-05-16-portal-2026-redesign-brief.md) · [Slice 2 auth/family](./2026-05-22-slice-2-setu-auth-family-api-design.md) · [Slice 3 donations](./2026-05-26-slice-3-donations-checkout-receipts-design.md)

---

## 1. Goal

Bring the **teacher + attendance** experience into the Setu family/member/enrollment model. After this slice, a Bala Vihar sevak can, on their phone during Sunday class:

1. See the class(es) they're assigned to.
2. Take attendance for today — one tap per student, present / absent / late.
3. See a student's attendance history + a safety-critical allergy/emergency banner.
4. See visiting (guest) students and mark them present.
5. Add an unregistered child on the spot → fires a parent invite + auto-enrolls the family on first attendance (wiring the `enrollFamilyOnFirstAttendance` helper already shipped in Slice 3b).

This is the **last pre-launch gate** — per the release strategy, families aren't announced until Slices 2 + 3 + 4 (at least teacher core) are done.

## 2. Relationship to the legacy check-in code

The portal already contains a **ported legacy check-in** tree (`features/check-in/`, `app/check-in/*`, `app/api/check-in/teacher/*`) from Slice B. It works against the **RTDB roster** (student `sid`, grade-keyed `classId`, `check_in_events` collection) — a different data model from Setu (`members/{mid}`, `enrollments`, Firestore).

**Decision: Slice 4 builds a NEW Setu-native teacher/attendance surface under `/teacher/*` + `/api/setu/teacher/*`, keyed by member `mid` and the Setu enrollment/period model. It does NOT extend the legacy `/check-in/teacher/*` tree.** The legacy tree keeps running in parallel (kiosk + existing sevaks) until the Slice 5 cutover (`NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK`). We reuse the legacy code as a **UX reference** (the attendance-marker three-state pattern, sticky-save, CSV export) but re-implement against Setu types.

Rationale: the two data models don't share keys (sid vs mid), the roster sources differ (RTDB vs Firestore), and forcing the legacy grade-keyed `classId` collections onto the Setu model would couple Slice 4 to code we intend to retire.

## 3. Audience

| Role | What they do in Slice 4 |
|---|---|
| **Teacher** (sevak) | See assigned classes, take attendance, view student detail + safety info, manage guests, add-student-on-prompt |
| **Welcome-team** | (already have search) — gains a read view of any class roster + attendance; can assign/reassign teachers (or that's admin — see RBB-2) |
| **Admin** | Configure classes + teacher assignments (admin UI); superset of welcome-team |

Family + family-member roles do **not** access `/teacher/*`.

## 4. ⚠ RESOLVE BEFORE BUILD — class structure unknowns

These shape the schema; only CMT knows the real-world answer. Recommendations given so we can move on sign-off.

> **RESOLVED by CMT 2026-05-29** (curriculum table attached to the answer — Bala Vihar West/Brampton + East/Scarborough 2025-26). The class unit is a **Level**, not a grade. See §4.6 for the seed data.

### RBB-1 — What IS a "class"? → A **Level** (location-specific, admin-configured)

Bala Vihar groups students into named **Levels**, and the level names + grade-bands **differ by location**:

| | Brampton (Bala Vihar West) | Scarborough (Bala Vihar East) |
|---|---|---|
| names | Shishu Vihar, Pre-Level 1, Level 1…7, Parents | Shishu Vihar, Pre-Level A, Level A…E, Parents |
| banding | Level 2 = Gr 2&3 | Level A = Gr 1&2 |

So the **same school grade maps to a different level at a different location** — the grade→level mapping is NOT global; it lives on each level. A class is therefore an **explicit admin-configured entity** (seeded from the curriculum table), one per **(location, level, period)**, carrying its own grade-band, curriculum title, and teachers.

Three level *kinds* drive roster matching (a child's `schoolGrade` alone isn't enough):
- `shishu` — Shishu Vihar (age 1.5–4) → match by age (from `birthMonthYear`), no school grade.
- `pre-level` / `level` — match children whose `schoolGrade` ∈ the level's `gradeBand`.
- `parents` — match **adults** (`members.type==='Adult'`) in enrolled families. (Yes — adults attend a Gita/Dharmashastra class and get attendance too.)

Stable across a semester (the period pins the level set). New semester → new level docs (admin clones + edits).

### RBB-2 — Teacher assignment → **admin OR welcome-team assigns; teachers may be parents or teacher-only**

- Both admin and welcome-team can assign teachers to levels (front-desk flexibility).
- A teacher may be a registered parent (has a family `mid`) **or** teacher-only (no family). Teacher-only sevaks get a lightweight standalone teacher record (a member-shaped doc with no family, or a `teachers/{tid}` doc) — see §5.5. Each level has multiple co-teachers (the curriculum lists 2–6 per level).
- Assignment grants the `teacher` capability to that person's session (mid- or tid-keyed, mirroring `roleAssignments`).

### RBB-3 — Class schedule → **managed class-date calendar, admin/welcome-team published, family-visible** ✓

CMT currently publishes a per-location PDF (e.g. "BV Calendar Brampton 2025-26") before each school year. **Slice 4 replaces the PDF** with an in-portal managed calendar that admin + welcome-team edit and families see on their dashboard (closes the fake "Upcoming" card left there).

From the real PDF, each **calendar entry** is a Sunday with:
- a **kind**: `class` (Regular / First / Short) or `no-class` (with a reason: "Thanksgiving Weekend", "Winter Break", "March Break", …)
- free-text **special events** (festivals, yagnas, "Parent Teacher Meetings", "BV Graduation") — can appear on class **and** no-class days; purely informational.
- an optional `shortClass` flag ("Regular Class (Short Class)").

Plus a per-location **weekly time schedule** (Brampton: Assembly 10:00–10:45, Classes 10:30–12:00, Tabla & Vocals 12:15–1:15) shown as a header.

The calendar spans the **school year** (Sep–Jun), crossing both donation-period semesters (Fall + Winter/Spring). Entries are keyed by `(location, date)` — period-agnostic; the period for attendance linkage is derived from the date. **"Today's class"** = a `class`-kind entry for today's date at the teacher's location → drives which dates attendance can be taken. Schema in §5.6.

### RBB-4 — Teacher auth → **Setu OTP + teacher capability** ✓

Teachers sign in with the same email/phone OTP as families. A `teacher` capability is granted per-person (mid/tid-keyed), so attendance carries a real per-sevak audit trail. A parent-and-teacher gets both `family-manager` + `teacher`. Replaces the legacy shared `TEACHER_PASSPHRASE`.

### RBB-5 — Attendance statuses → **present / absent / late, + derived `unaccounted`** ✓

Teacher taps one of `present | absent | late`. An enrolled student in the level with **no** event for a class date is **`unaccounted`** (derived, not stored) — drives a "who's unmarked" view for the teacher to chase before leaving.

### 4.6 — Seed data (from the CMT 2025-26 curriculum table)

Levels to seed per location per period (West = Brampton, East = Scarborough; Mississauga/Markham TBD if they run Bala Vihar):

**Brampton (West):** Shishu Vihar (1.5–4y · Devatas) · Pre-Level 1 (JK/SK · Bala Ramayana) · Level 1 (Gr 1 · Krishna Krishna) · Level 2 (Gr 2–3 · Hanuman) · Level 3 (Gr 4–5 · Symbolism in Hinduism) · Level 4 (Gr 6–7 · Vibhishana Gita) · Level 5 (Gr 8–9 · Hindu Culture) · Level 6 (Gr 10 · Mahabharata) · Level 7 (Gr 11–12 · Essence of Gita for Youth) · Parents (Adults · Gita)

**Scarborough (East):** Shishu Vihar (1.5–4y · Devatas) · Pre-Level A (JK/SK · Alphabet Safari) · Level A (Gr 1–2 · Hanuman) · Level B (Gr 3–4 · Krishna Krishna) · Level C (Gr 5–6 · India) · Level D (Gr 7–8 · Yatho Dharma) · Level E (Gr 9–12 · Essence of Gita for Youth) · Parents (Adults · Dharmashastra)

Teacher names from the curriculum table seed the initial `teacherAssignments` once those sevaks have Setu accounts (names → matched to member/teacher records during onboarding; not auto-linked). A `scripts/seed-bala-vihar-levels.ts` (mirroring the donation-periods seed) loads these per active period.

## 5. Data model — Firestore

### 5.1 `levels/{levelId}` (a class = a Level at a location for a period)
```ts
type LevelDoc = {
  levelId: string;              // `{location}-{levelSlug}-{pid}` e.g. brampton-level-2-bv-brampton-fall-2026
  programKey: 'bala-vihar';
  location: Location;
  levelName: string;            // "Level 2" (West) / "Level A" (East) / "Shishu Vihar" / "Parents"
  levelKind: 'shishu' | 'pre-level' | 'level' | 'parents';
  order: number;                // display order within a location (Shishu=0 … Parents=last)
  gradeBand: string[];          // school grades this level covers, e.g. ['Gr 2','Gr 3']; [] for shishu/parents
  ageLabel: string;             // "Gr 2 & 3" / "1.5 to 4 years" / "All Adults" (display)
  curriculum: string;          // "Hanuman" / "Gita" (display)
  pid: string;                  // → donationPeriods (the semester)
  periodLabel: string;          // snapshot
  teacherRefs: string[];        // mids/tids of assigned teachers (denormalized for "my levels")
  enabled: boolean;
  createdAt; createdBy; updatedAt; updatedBy;
};
```
Roster matching by `levelKind` (see §6) — `gradeBand` for level/pre-level, age for shishu, member-type=Adult for parents. The grade→level mapping is **per-location** (it lives on each level's `gradeBand`), because West and East band grades differently.

### 5.2 `teacherAssignments/{ref}` (ref = mid for parent-teachers, tid for teacher-only)
```ts
type TeacherAssignmentDoc = {
  ref: string;                  // member mid OR standalone teacher tid
  levelIds: string[];          // levels this teacher is assigned to
  updatedAt; updatedByUid;
};
```
Mirrors `roleAssignments/{mid}` (Slice 2). Assigning grants the `teacher` capability to that person's session (via the existing addCapability path). Admin **and** welcome-team can write these (RBB-2).

### 5.2b `teachers/{tid}` (teacher-only sevaks, no family)
```ts
type TeacherDoc = {
  tid: string; firstName: string; lastName: string;
  email: string | null; phone: string | null;   // for OTP sign-in (contactKeys entry like members)
  createdAt; createdByUid;
};
```
A sevak who is also a parent uses their existing `mid` and needs no `teachers/` doc — the teacher capability attaches to their member. Teacher-only sevaks get a `tid` here + a `contactKeys` entry so the existing OTP path resolves them to a teacher session.

### 5.3 `attendanceEvents/{aid}`
```ts
type AttendanceEventDoc = {
  aid: string;                  // `{levelId}-{mid}-{yyyy-mm-dd}` — composite → idempotent, one row per student per class-day
  levelId: string;
  mid: string;                  // the student member id
  fid: string;                  // denormalized for family-side "my child's attendance"
  pid: string;                  // period, denormalized
  date: string;                 // 'YYYY-MM-DD' (America/Toronto)
  status: 'present' | 'absent' | 'late';
  isGuest: boolean;             // visiting student from another class/location
  markedByUid: string;
  markedByMid: string | null;
  markedAt: Timestamp;
  updatedAt: Timestamp;
};
```
Composite `aid` means re-marking a student the same day overwrites (no dupes). `unaccounted` is NOT stored — derived (a matched member with no event for that date).

### 5.4 Indexes (`firestore.indexes.json`, UAT-only deploy)
- `attendanceEvents (levelId ASC, date DESC)` — take-attendance + level history
- `attendanceEvents (mid ASC, date DESC)` — student attendance history
- `attendanceEvents (fid ASC, date DESC)` — family dashboard "my child's attendance" (replaces the placeholder on `/family`)
- `levels (programKey ASC, location ASC, pid ASC, order ASC)` — admin list
- `levels (teacherRefs ARRAY_CONTAINS, enabled ASC)` — "my levels"
- `classCalendarEntries (location ASC, date ASC)` — calendar list + "today's class" + family upcoming

### 5.5 `classCalendarEntries/{entryId}` (the managed school-year calendar)
```ts
type ClassCalendarEntryDoc = {
  entryId: string;             // `{location}-{yyyy-mm-dd}`
  programKey: 'bala-vihar';
  location: Location;
  date: string;                // 'YYYY-MM-DD' (a class Sunday)
  kind: 'class' | 'no-class';
  classType: 'regular' | 'first' | 'short' | null;   // when kind==='class'
  noClassReason: string | null;                       // when kind==='no-class' e.g. "Winter Break"
  specialEvents: string | null;                       // free text; may appear on class OR no-class days
  enabled: boolean;            // published vs draft
  createdAt; createdBy; updatedAt; updatedBy;
};
```

### 5.5b `weeklySchedules/{location}` (the fixed time header)
```ts
type WeeklyScheduleDoc = {
  location: Location;
  rows: Array<{ time: string; label: string }>;   // e.g. {time:'10:00–10:45 am', label:'Assembly'}
  updatedAt; updatedBy;
};
```

Admin + welcome-team CRUD both. A `scripts/seed-bala-vihar-calendar.ts` loads the 2025-26 Brampton calendar from the PDF as the first dataset (East/Scarborough + Mississauga added via the admin UI or their own seed).

## 6. Roster derivation (per level kind)

A level's roster = enrolled members at that location matching the level kind. Computed, not stored — stays consistent as families enroll / edit members / change grade.

1. Find families enrolled in the level's `pid` at the level's `location` (`enrollments` collectionGroup where `pid == X, status == 'active'`, joined to family `location`).
2. Match members per `levelKind`:
   - **`level` / `pre-level`** → children (`type==='Child'`) whose `schoolGrade` ∈ `level.gradeBand`.
   - **`shishu`** → children aged 1.5–4 (derive from `birthMonthYear`); typically no school grade yet.
   - **`parents`** → adults (`type==='Adult'`) in the enrolled family.
3. Merge with `attendanceEvents` for the selected date to show current marks; matched members with no event = `unaccounted`.

**Edge cases to handle:** a child whose `schoolGrade` matches no level at their location (data gap → surface in a welcome-team "unassigned students" view); a family enrolled but child grade blank (prompt to complete profile). Because banding is per-location, roster logic reads `gradeBand` off the level doc — never a hardcoded grade→level map.

## 7. Take-attendance flow (the core UX)

`/teacher/levels/[levelId]/attendance?date=YYYY-MM-DD` (defaults to today, Toronto).

1. Server loads roster (§6) + existing `attendanceEvents` for the date.
2. Mobile-first list, one row per student: avatar, name, grade, three-state toggle (present/absent/late). Big tap targets. Safety: a child with allergies/emergency info shows a red dot → tap reveals the banner.
3. Sticky footer: "`12 / 18 marked` · Save attendance". Optimistic UI; save batches all marks.
4. `POST /api/setu/teacher/attendance` body `{ levelId, date, marks: Record<mid, status> }` → upserts `attendanceEvents` (composite aid) in a batched write. Teacher capability + must be assigned to `levelId`.
5. **First-attendance auto-enroll:** if a marked child's family has no active enrollment for the period, call `enrollFamilyOnFirstAttendance({ fid, pid, markedByTeacherUid })` (Slice 3b helper) inside the same flow — pins the donation snapshot to the current period.
6. Microcopy on save: "Thank you for taking attendance today." (brief §9 tone).

## 8. Student detail (teacher view)

`/teacher/students/[mid]` — read view:
- Attendance % + calendar/heatmap of marks for the period.
- Parent contact (tap to reveal phone/email from the manager member).
- **Allergy + emergency-contact banner — always visible, color + icon** (brief §9 safety-first). Pulled from `MemberDoc.foodAllergies` + `emergencyContacts`.

## 9. Guest list + add-student-on-prompt

- **Guest list** (`/teacher/levels/[levelId]/guests`): children marked present at this location/date who belong to a *different* level (visiting). One-tap "mark guest attendance" → `attendanceEvent` with `isGuest:true`.
- **Add student on prompt** (sheet from take-attendance): child first/last + grade + parent email/phone → creates a pending member + fires the Slice 2d invite to the parent + marks the child present (guest). Shows a "pending invite" badge until the parent completes registration.

## 10. Endpoint inventory
| Method | Path | Auth |
|---|---|---|
| GET | `/api/setu/teacher/levels` | teacher (own levels) |
| GET | `/api/setu/teacher/levels/:levelId/roster?date=` | teacher (assigned) |
| POST | `/api/setu/teacher/attendance` | teacher (assigned) |
| GET | `/api/setu/teacher/students/:mid` | teacher (student in their class) |
| POST | `/api/setu/teacher/guests` | teacher |
| POST | `/api/setu/teacher/add-student` | teacher (→ invite + guest mark) |
| GET | `/api/admin/levels` + POST/PATCH | admin |
| POST | `/api/admin/teacher-assignments` | admin **+ welcome-team** (RBB-2) |
| GET | `/api/setu/calendar?location=` | any signed-in (families see published entries) |
| GET/POST/PATCH/DELETE | `/api/admin/calendar` | admin + welcome-team (manage entries + weekly schedule) |

All via `readSessionFromHeaders` + role helpers (the `isTeacher` helper + assignment check). New `canAccessRoute` gates for `/teacher/*` + `/api/setu/teacher/*`. The calendar GET is readable by any signed-in family (published entries only); writes are admin + welcome-team.

## 11. Family-side payoff (closes two placeholders)

1. **Attendance** — wire the `/family` dashboard + `/family/members/[mid]` attendance card to real `attendanceEvents (fid/mid)` data, replacing the "attendance with check-in soon" placeholder.
2. **Schedule/calendar** — the managed calendar (§5.5) powers a real **Upcoming** card on the dashboard (next class date, no-class notices, special events) + a full `/family/calendar` schedule page, replacing both the fake "Upcoming events" card AND the per-year PDF. This is the family-facing half of the RBB-3 calendar.

## 12. Sub-slices
- **4a — Levels + teacher assignment** (admin schema + UI; `isTeacher` capability wiring) — foundation.
- **4b — Class calendar** (admin/welcome publish + weekly schedule; seed 2025-26 from PDF; family `/family/calendar` + dashboard Upcoming card). Independent of 4a — can run in parallel. Gates valid attendance dates for 4c.
- **4c — Roster + take attendance** (the core teacher flow + auto-enroll wire; uses 4a levels + 4b calendar dates) — biggest.
- **4d — Student detail + safety banner.**
- **4e — Guest list + add-student-on-prompt** (reuses Slice 2d invite).
- **4f — Family-side attendance surfacing** (closes the dashboard attendance placeholder).
- **4g — Welcome-team/admin level + attendance read views.**

## 13. Risks
| Risk | Mitigation |
|---|---|
| Class model wrong (RBB-1) forces a schema rewrite | Resolve RBB-1 before 4a; roster-derivation isolates the "what's a class" decision to one query |
| Grade→class mapping drift (a child's `schoolGrade` is free-text-ish) | Normalize grade labels; admin can correct via welcome-team edit |
| Teachers double-marking / offline lobby wifi | Composite `aid` makes saves idempotent; optimistic UI + retry |
| Auto-enroll on first attendance surprises families with a donation snapshot | It's the documented rule (brief §5); donation stays *suggested*, never charged |
| Reusing legacy check-in confusingly | Slice 4 is Setu-native under `/teacher/*`; legacy `/check-in/*` untouched until Slice 5 cutover |

## 14. Next step
Resolve RBB-1…5 (the §4 questions), then write the implementation plan + start 4a. 4a (classes + assignment) is the unblocker; 4b (take attendance) is the heart of the slice.

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

### RBB-1 — What IS a "class"?

- **Recommendation:** a class = **(programKey, location, gradeLabel)** for a given **donation period** (semester). e.g. "Bala Vihar · Brampton · Grade 2 · Fall 2026". Students in it = enrolled children (`members.type==='Child'`) at that location whose `schoolGrade` matches, for families enrolled in that period.
- **Alternatives:** (a) grade-*bands* ("Grades 1–2") if CMT combines grades; (b) named classes ("Sandeepany Group A") decoupled from grade.
- **Why it matters:** determines whether a class is auto-derived from `(location, schoolGrade, period)` or an explicitly-created admin entity with manual student assignment.
- **Question for you:** Does CMT group Bala Vihar by single grade, by grade-band, or by named groups? Are groupings stable across a semester?

### RBB-2 — How are teachers assigned to classes?

- **Recommendation:** an admin screen (`/admin/teachers`) assigns a teacher (a member `mid`, or a standalone teacher account) to one or more classes. Stored in a new `teacherAssignments/{mid}` doc (mid-keyed, mirroring how admin/welcome-team roles live in `roleAssignments/{mid}` from Slice 2). A teacher can teach multiple classes; a class can have multiple teachers (co-teachers).
- **Question for you:** Who assigns teachers — admin only, or welcome-team too? Are teachers always also family members (have a `mid`), or can a sevak be teacher-only (no family)?

### RBB-3 — Class schedule / "today's class"

- **Recommendation:** Bala Vihar runs **Sundays** within the period's `[startDate, endDate]`. "Today's class" = the most recent/!current Sunday in range. No per-week calendar entity in v1 — attendance is keyed by calendar date. A simple `classMeetings` list (admin-managed exceptions like "no class — holiday") is a follow-up.
- **Question for you:** Is it always Sunday? Do you need a managed class calendar (specific dates, holiday skips) in v1, or is "any date the teacher takes attendance" enough?

### RBB-4 — Teacher authentication

- **Recommendation:** teachers sign in with the **same Setu OTP** (email/phone) as families. A `teacher` capability is added to their session via `roleAssignments/{mid}` (extends the multi-role `extraRoles` mechanism from Slice 2). A sevak who is also a parent gets both `family-manager` + `teacher`. Teacher-only sevaks (no family) get a minimal member record or a standalone teacher record (depends on RBB-2).
- **Question for you:** OK to reuse Setu OTP for teachers (vs the legacy `TEACHER_PASSPHRASE` shared login)? Recommended yes — per-person accounts give real audit trails on who marked attendance.

### RBB-5 — Attendance statuses

- **Recommendation:** `present | absent | late` per the brief §6.3.3. The legacy model also has `uninformed` (absent without notice) — useful for the "who's unaccounted for" view. Keep all four: teacher taps present/absent/late; `uninformed` is a derived/default state for enrolled students never marked.
- **Question for you:** Three states (present/absent/late) or keep the legacy fourth (`uninformed`) for the unaccounted view?

Defaults assumed below: RBB-1 = (program, location, grade, period); RBB-2 = admin-assigns, teachers are members; RBB-3 = Sundays, no managed calendar v1; RBB-4 = Setu OTP + teacher capability; RBB-5 = present/absent/late + derived uninformed.

## 5. Data model — Firestore (assuming the §4 defaults)

### 5.1 `classes/{classId}`
```ts
type ClassDoc = {
  classId: string;              // `{programKey}-{location}-{gradeSlug}-{pid}` e.g. bala-vihar-brampton-gr2-bv-brampton-fall-2026
  programKey: 'bala-vihar';
  location: Location;
  gradeLabel: string;           // "Grade 2" (or band "Grades 1-2" per RBB-1)
  pid: string;                  // → donationPeriods (the semester)
  periodLabel: string;          // snapshot
  teacherMids: string[];        // denormalized for fast "my classes" lookup
  enabled: boolean;
  createdAt; createdBy; updatedAt; updatedBy;
};
```

### 5.2 `teacherAssignments/{mid}`
```ts
type TeacherAssignmentDoc = {
  mid: string;                  // the teacher's member id
  classIds: string[];          // classes this teacher is assigned to
  updatedAt; updatedBy;
};
```
Mirrors `roleAssignments/{mid}` (Slice 2). Granting a teacher assignment also adds the `teacher` capability to their session claims (via the existing addCapability path).

### 5.3 `attendanceEvents/{aid}`
```ts
type AttendanceEventDoc = {
  aid: string;                  // `{classId}-{mid}-{yyyy-mm-dd}` — composite → idempotent, one row per student per class-day
  classId: string;
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
Composite `aid` means re-marking a student the same day overwrites (no dupes). `uninformed` is NOT stored — it's derived (enrolled child in the class with no event for that date).

### 5.4 Indexes (`firestore.indexes.json`, UAT-only deploy)
- `attendanceEvents (classId ASC, date DESC)` — take-attendance + class history
- `attendanceEvents (mid ASC, date DESC)` — student/family attendance history
- `attendanceEvents (fid ASC, date DESC)` — family dashboard "my child's attendance" (replaces the placeholder we left on `/family`)
- `classes (programKey ASC, location ASC, pid ASC)` — admin list
- `classes (teacherMids ARRAY_CONTAINS, enabled ASC)` — "my classes"

## 6. Roster derivation

A class roster = enrolled children matching the class. Given the §4-default model:
1. Find families enrolled in the class's `pid` (query `enrollments` collectionGroup where `pid == X, status == 'active'`).
2. For each, the children (`members.type==='Child'`) whose `schoolGrade` maps to the class `gradeLabel` and whose family `location` matches.
3. Merge with `attendanceEvents` for the selected date to show current marks.

Roster is computed, not stored — keeps it consistent as families enroll/edit members. (If RBB-1 → named groups with manual assignment, we'd instead store `classId` on the member or a `classMembers` join — flag during sign-off.)

## 7. Take-attendance flow (the core UX)

`/teacher/classes/[classId]/attendance?date=YYYY-MM-DD` (defaults to today, Toronto).

1. Server loads roster (§6) + existing `attendanceEvents` for the date.
2. Mobile-first list, one row per student: avatar, name, grade, three-state toggle (present/absent/late). Big tap targets. Safety: a child with allergies/emergency info shows a red dot → tap reveals the banner.
3. Sticky footer: "`12 / 18 marked` · Save attendance". Optimistic UI; save batches all marks.
4. `POST /api/setu/teacher/attendance` body `{ classId, date, marks: Record<mid, status> }` → upserts `attendanceEvents` (composite aid) in a batched write. Manager... teacher-only + must be assigned to `classId`.
5. **First-attendance auto-enroll:** if a marked child's family has no active enrollment for the period, call `enrollFamilyOnFirstAttendance({ fid, pid, markedByTeacherUid })` (Slice 3b helper) inside the same flow — pins the donation snapshot to the current period.
6. Microcopy on save: "Thank you for taking attendance today." (brief §9 tone).

## 8. Student detail (teacher view)

`/teacher/students/[mid]` — read view:
- Attendance % + calendar/heatmap of marks for the period.
- Parent contact (tap to reveal phone/email from the manager member).
- **Allergy + emergency-contact banner — always visible, color + icon** (brief §9 safety-first). Pulled from `MemberDoc.foodAllergies` + `emergencyContacts`.

## 9. Guest list + add-student-on-prompt

- **Guest list** (`/teacher/classes/[classId]/guests`): children marked present at this location/date who belong to a *different* class (visiting). One-tap "mark guest attendance" → `attendanceEvent` with `isGuest:true`.
- **Add student on prompt** (sheet from take-attendance): child first/last + grade + parent email/phone → creates a pending member + fires the Slice 2d invite to the parent + marks the child present (guest). Shows a "pending invite" badge until the parent completes registration.

## 10. Endpoint inventory
| Method | Path | Auth |
|---|---|---|
| GET | `/api/setu/teacher/classes` | teacher (own classes) |
| GET | `/api/setu/teacher/classes/:classId/roster?date=` | teacher (assigned) |
| POST | `/api/setu/teacher/attendance` | teacher (assigned) |
| GET | `/api/setu/teacher/students/:mid` | teacher (student in their class) |
| POST | `/api/setu/teacher/guests` | teacher |
| POST | `/api/setu/teacher/add-student` | teacher (→ invite + guest mark) |
| GET | `/api/admin/classes` + POST/PATCH | admin |
| POST | `/api/admin/teacher-assignments` | admin (RBB-2) |

All via `readSessionFromHeaders` + role helpers (the `isTeacher` helper + assignment check). New `canAccessRoute` gates for `/teacher/*` + `/api/setu/teacher/*`.

## 11. Family-side payoff (closes a Slice 3 placeholder)

Once attendance exists, wire the `/family` dashboard + `/family/members/[mid]` attendance card to real `attendanceEvents (fid/mid)` data — replacing the "attendance with check-in soon" placeholder left in the dashboard wiring. Small, but it completes the family story.

## 12. Sub-slices
- **4a — Classes + teacher assignment** (admin schema + UI; `isTeacher` capability wiring) — foundation.
- **4b — Roster + take attendance** (the core teacher flow + auto-enroll wire) — biggest.
- **4c — Student detail + safety banner.**
- **4d — Guest list + add-student-on-prompt** (reuses Slice 2d invite).
- **4e — Family-side attendance surfacing** (closes the dashboard placeholder).
- **4f — Welcome-team/admin class + attendance read views.**

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

# Slice 1 — Family dashboard simplification + enrollment triggers (design)

**Date:** 2026-07-06 · **Status:** Approved in principle (call + mockups + answers 2026-07-06); spec under review · **Review artifact:** the polish-review page (v3, all decisions locked).

This is **Slice 1 of 3** from the 2026-07-06 polishing call. Slice 2 = disclaimers; Slice 3 = admin/teacher polish. Launch target: **Aug 3** (UAT end-to-end by Jul 15).

## Problem

Two things from the call:

1. **The dashboard shows too much.** Bala Vihar status, donation, family, Seva, programs, calendar, Prasad, and a yellow email/phone nudge are all scattered across separate boxes. A family can't tell the "Donation pending" box relates to Bala Vihar. The owner wants the family surface reduced to exactly what matters right now: **accurate family info, enrollment, donation** — everything else hidden.
2. **The enrollment rule (shipped 2026-07-02 for issue #23) is too strict.** Today a family that clicks **Enroll** but hasn't attended or paid shows "Registered", not "Enrolled". The owner wants a deliberate Enroll click to count as Enrolled immediately.

## Goal

A family dashboard of **three stacked blocks — Family · Action Items · one Bala Vihar section — and nothing else**, matching the owner's mockups (layout only; their invented text is ignored). Plus an amended enrollment rule where a manual Enroll click or first attendance both confirm enrollment, with donation status tracked independently.

## Scope

**In (Slice 1):** enrollment-trigger amendment; dashboard rebuild (mobile + desktop) to the 3-block layout; move donate into the BV section; remove the email/phone nudge; hide Seva/Prasad/programs/calendar from the dashboard; profile-completeness shown on the profile page; mobile dashboard-API parity.

**Out:** disclaimers (Slice 2 — but the Action Items panel is built to accept a "disclaimers" item later); admin level/teacher changes + attendance Present/Absent-only + the two admin bugs (Slice 3); anything the portal can't populate today — **room number, class time, "Classroom Updates" panel, medical-info upload** (owner: images are examples, ignore their text).

## Part A — Enrollment triggers (amends issue #23)

The rule from #23 lives in one pure predicate, `apps/portal/src/app/family/_helpers/enrollment-confirmation.ts`:

```ts
// TODAY
isEnrollmentConfirmed(enr: Pick<EnrollmentWithOffering,'eid'>, { attendedCount, donations, legacyPaid })
  = attendedCount > 0 || legacyPaid || donations.some(completed && eid === enr.eid)
```

**Amendment:** a deliberate/engaged enrollment also confirms. The enrollment doc already records how it was created — `enrolledVia: 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion'` (`schemas/enrollment.ts:22`).

```ts
// NEW — widen the enrollment param to include enrolledVia
isEnrollmentConfirmed(enr: Pick<EnrollmentWithOffering,'eid'|'enrolledVia'>, inputs)
  = enr.enrolledVia === 'family-initiated'   // family clicked Enroll (even $0 paid)
  || enr.enrolledVia === 'first-attendance'  // a kid attended → auto-enrolled
  || inputs.attendedCount > 0                // attendance recorded (robustness)
  || inputs.legacyPaid
  || inputs.donations.some(d => d.status === 'completed' && d.eid === enr.eid);
```

Resulting three-state `bvState` (unchanged mechanism, `dashboard-model.ts`):
- **Enrolled** — any confirming trigger above.
- **Registered** — an active BV enrollment created by **`promotion` or `welcome-team`** (rollover/backfill) with **no** attendance, donation, or legacy-paid. This is the only state that survives the amendment; it's the #23 "we carried you forward, please confirm" state.
- **Not enrolled** — no active BV enrollment.

**Donation status is independent** and already correct: a family can be Enrolled (via click or attendance) with donation **Pending**; it flips to **Complete** on payment. Enrolled ≠ paid.

**Mobile contract:** `bvState` semantics widen (more families read `enrolled`); values unchanged. Additive note in `MOBILE_API_CHANGELOG.md`.

## Part B — Dashboard target layout

Rebuild `apps/portal/src/app/family/page.tsx` (both the `block md:hidden` mobile branch and the `hidden md:block` desktop branch). Same theme + fonts (`.csp` tokens). Three blocks, in order:

**1. Header + Family card.** "Hari OM, {first name}." with **Children N · Adults N** counts; a **Family** card showing the child/adult split and a **Manage Family** button → the existing `/family/members` page. (Counts derive from members: `type === 'Child' | 'Adult'`.)

**2. Action Items.** A panel listing only real, actionable items; hidden when empty:
- **Donation pending** → "Complete your Bala Vihar donation" → `[Donate]` (`model.donateUrl`), shown when `bvState !== 'none'` and donation not complete and portal-managed (`model.donation.showGive`).
- **Disclaimers to accept** — Slice 2 adds this item; the panel is built to accept it now (empty until then).
- (Profile completeness is enforced by the existing `/complete-profile` gate before the dashboard renders, so it is normally already complete — the panel shows a "finish your profile" item only if an *optional*-but-encouraged field path ever surfaces one; otherwise omit.)

**3. Bala Vihar section.** One bordered section headed "Bala Vihar" + the three-state pill, containing:
- **Enrollment & Donation** — Academic Year (term label), Registration (Enrolled/Registered), Donation status (Pending/Complete/Off-portal), and the **Complete Donation** button (moved here from the desktop header). No donate button anywhere else on the dashboard.
- **Attendance** (per enrolled child) — e.g. "Aarav 4/5" using `getFamilyBalaViharAttendance`'s per-child present/total, with a "view full attendance" link to the child profile. Data exists.
- **Class Assignments** (per enrolled child) — child → **Level name** (denormalized on the enrollment: `perMember[mid].levelName`, `schemas/enrollment.ts:9`) + **teacher name(s)** (resolve `level.teacherRefs` → member names). Room/time are NOT built.

**Removed from the dashboard:** the email/phone nudge (`ContactsNudge`), the Seva card, the Prasad card, the "other programs" cards, and the Upcoming/calendar card. The desktop header "Programs" + "Give donation" buttons go too (donate moves into the BV section; Programs remains reachable from the left nav).

## Part C — Hides (nav / feature flags)

- **Seva** and **Prasad**: hidden from families entirely (dashboard + left-nav + routes) behind feature flags (`NEXT_PUBLIC_FEATURE_SETU_SEVA`, `NEXT_PUBLIC_FEATURE_SETU_PRASAD`), **OFF** by default, following the existing `flags.ts` literal-`process.env` pattern. Admin-side Seva/Prasad config is untouched (admins may still use it; families just don't see it).
- **Programs**: stays in the left nav (owner: "left side I'm not touching… programs let it be on the left"); only removed from the dashboard.
- **Calendar**: removed from the dashboard; the family calendar becomes an **external link to the yearly PDF** on the Chinmaya Toronto site (owner decision B8) rather than a maintained in-portal calendar. (The nav "Calendar" entry either links out or is removed — decide during build; low-risk.)

## Part D — Profile completeness on the profile page

On the **My Family / member profile** surface (`/family/members` and the per-member profile), show whether each member's information is complete (using the existing required-fields matrix, `@cmt/shared-domain/setu/member-required-fields`) — a small "Complete / Missing info" indicator + a jump to edit. This replaces the removed dashboard nudge; no dashboard banner.

## Part E — Mobile API parity

`GET /api/setu/dashboard` gains the new dashboard's data additively: per-child **class assignments** (level + teacher names) and **attendance ratios**, and an **action-items** array. `bvState` semantics widen per Part A. Dated, SHA-keyed `MOBILE_API_CHANGELOG.md` entry; the mobile app mirrors the same 3-block layout.

## Testing

- **Unit:** `enrollment-confirmation.test.ts` — family-initiated → confirmed; first-attendance → confirmed; promotion+no-engagement → not confirmed; existing donation/attendance/legacy cases still pass. `dashboard-model.test.ts` — bvState/pill for the new triggers; Action Items derivation; class-assignment + attendance shaping. Route test for the dashboard API's new fields (N=2 children).
- **Deployed-UAT E2E** (Playwright `setu`): a seeded family that **clicked Enroll but hasn't paid** shows **Enrolled** + donation **Pending** + the Complete Donation button inside the BV section; the dashboard shows the Family card + Manage Family and does **not** render Seva/Prasad/programs/calendar or the email/phone nudge; a promotion-only family still shows **Registered**. Reuse the issue #23 seed fixture (extend for enrolledVia + a level+teacher assignment).

## Deferred / open

- Action Items is thin until Slice 2 adds the disclaimer item — acceptable (donation is the main one).
- Teacher-contact-on-click (phone/email popup from a class assignment) — nice-to-have; ship level+teacher-name first, add contact reveal if cheap.
- Calendar nav exact treatment (link-out vs remove) — decide during build.
- Class Assignments needs a teacherRef→name resolution (level docs + member lookup); if that read proves heavy for the dashboard, ship **level-name only** first and add teacher names as a fast follow.

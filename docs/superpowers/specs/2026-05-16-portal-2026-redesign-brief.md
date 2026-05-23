# Chinmaya Setu Portal — 2026 Redesign Brief

**Date:** 2026-05-16
**Status:** Design brief (for claude design)
**Owner:** CMT Developer

---

## 1. Snapshot

You are designing the visual + interaction layer for **Chinmaya Setu**, the unified family portal for Chinmaya Mission Toronto (CMT). The portal launches in 2026 as a single internet-accessible but registration-gated web app at `setu.chinmayatoronto.org` (working URL — final TBD). It absorbs the existing standalone family check-in app and replaces fragmented spreadsheets/forms with one **family-centric** record system.

> ⚠ Events registration is **NOT in scope** for this portal. It already lives at https://events.chinmayatoronto.org/. The portal may surface a link to that domain in nav, but no event flows are designed here.

The product priorities, in order:
1. **Bala Vihar enrollment, attendance, and donations** — the only program live at go-live.
2. **Family profile + member management** — foundation for everything else.
3. **Teacher + Welcome-team tooling** — class roster, attendance, guest list.

Everything else (Tabla, Dance, OM Chanting, Gita Chanting, workshops) is a future "Program" using Bala Vihar as the reference model — design with that extensibility in mind, but don't build screens for it now.

---

## 2. Brand & visual direction

**Direction locked: "Cool Mist · Orange CTA" (22 May 2026).** Source of truth is `packages/ui/src/styles/tokens.css` — full `--setu-*` palette installed there.

**Palette (key tokens):**
| Role | Token | Hex | Use |
|---|---|---|---|
| Page bg | `--setu-bg` | `#f3f6f8` | Cool-mist page background |
| Surface | `--setu-surface` | `#ffffff` | Cards, sheets, popovers |
| Surface-2 | `--setu-surface-2` | `#e3edf1` | Recessed/hover, day chips |
| Ink | `--setu-ink` | `#0f1a22` | Primary text (slight teal bias) |
| Body | `--setu-body` | `#3a4a56` | Body copy |
| Muted | `--setu-muted` | `#7a8a96` | Captions, dividers |
| **Accent (CTA)** | `--setu-accent` | `#d96642` | **Coral orange — primary CTA fill** |
| Accent hover | `--setu-accent-hover` | `#c2562f` | CTA hover state |
| Accent deep | `--setu-accent-deep` | `#a23f1e` | Text-on-tint, focus rings |
| Accent soft | `--setu-accent-soft` | `#fde2d3` | Tint bg for badges/callouts |
| Info | `--setu-info` | `#3a7e88` | Teal — "Enrolled" badges, info chips |
| Info deep | `--setu-info-deep` | `#1f4a52` | Headings + secondary chrome |
| Info soft | `--setu-info-soft` | `#d6e8eb` | Teal badge/tag bg |
| OK / Warn / Err | `--setu-ok/warn/err` | `#3d7a5a` / `#a06410` / `#8a3030` | Status colors (each with `-soft` companion) |

**Radii:** `--setu-radius` `14px` (cards/sheets) · `--setu-radius-sm` `10px` (buttons/inputs/pills) · `--setu-radius-xs` `6px` (chips).
**Elevation:** three shadow tokens (`--setu-elev-1/2/3`) tuned to the ink color. **Focus ring** uses the soft accent (`var(--setu-focus-ring)`).

**Aesthetic anchors:**
- **Cool, calm, modern Indian-Canadian.** Cool-mist neutrals carry the chrome; the coral CTA is the only warm color in the system — that contrast is the whole point.
- Inspiration: Linear (decisive type, calm chrome), Notion Calendar (density without noise), Stripe Atlas (form polish for donations).
- Generous whitespace, soft shadows, 10–14px rounded corners.
- Sparing use of OM/lotus/diya motifs — at most one ornamental flourish per surface (e.g., a watermark on the dashboard hero). Do not turn the UI into a religious-imagery collage.
- Photography: use real CMT class/event photos where space allows, but never let them dominate. Cool-mist palette + warm CTA means photos with warm tones will pop — use that intentionally.

**Typography:**
- Design direction: **Geist** (display + body) and **Geist Mono** (rare technical use). The `--setu-font-display/body/mono` tokens hold this direction.
- Implementation note: actual rendered fonts currently come from `next/font` in `apps/portal/src/app/layout.tsx` (today: Inter + Merriweather). Switching to Geist requires updating layout.tsx to load it via `next/font` — that's a follow-up, not part of the design pass.
- Indian/Sanskrit terms (Bala Vihar, sevak, dakshina) styled with subtle italic + same color as body — do NOT use a separate "exotic" font.

---

## 3. Tech & component stack you're designing for

The dev environment is fixed; the design must compose from these primitives:

- **Next.js 16 (App Router)** + **React 19**
- **Tailwind CSS** (v3 — token-driven via the CSS variables above)
- **shadcn/ui** — these components are already installed and ready to compose:
  `alert`, `avatar`, `button`, `card`, `dialog`, `form`, `input`, `label`, `separator`, `sheet`, `skeleton`, `sonner` (toast).
  Anything beyond this list should be flagged explicitly so the dev team can add it (likely candidates we'll need: `table`, `tabs`, `select`, `checkbox`, `radio-group`, `popover`, `command`, `calendar`, `badge`, `tooltip`, `dropdown-menu`).
- **Firebase Auth** for sessions (passwordless email link or phone OTP — your call to recommend).
- Mobile-first; sevaks take attendance on phones in the lobby. Tablet (iPad) is a heavy second target for teachers.

---

## 4. The three audiences

Design distinct dashboards for each, but reuse layout shell and primitives.

### 4.1 Family (primary user — ~95% of traffic)
A parent or family manager. Visits the portal a few times per semester to enroll, donate, check attendance, and update member info. Comfortable with web forms but not power users. Often on mobile.

**They need to:**
- Register a new family OR join an existing family (dedupe-aware).
- Manage household members (add child, update emergency contacts, set allergies).
- Enroll in Bala Vihar; see their suggested donation; pay it.
- See their children's attendance history.
- Invite their spouse/other parent to co-manage the family.
- See donation receipts (tax purposes — Canadian charity).

### 4.2 Bala Vihar Teacher (~30 users)
A volunteer sevak assigned to one or more classes (grade level + location). Uses the portal weekly on a phone or tablet during Sunday class. Needs zero-friction attendance.

**They need to:**
- See assigned classes.
- Take attendance for today (mark present/absent/late per student; should be one-tap-per-row).
- See per-student attendance stats (% attendance, recent absences).
- See the guest list (visiting students/families today).
- Add a student on the spot when an unregistered child shows up — this should trigger an invite email/SMS to the parent.

### 4.3 Welcome & Registration team (~5 users)
Front-desk volunteer. Superset of teacher capabilities + can access any family record + can correct registration mistakes. Often at a check-in kiosk in the lobby.

**They need to:**
- Search/look up any family by name, phone, or email.
- See family roster + program enrollments at a glance.
- Edit family records (correct typos, merge duplicates if dedupe failed).
- See "needs attention" queue (failed payments, unverified emails, duplicate-suspects).
- Configure donation periods (admin sub-role — see §6.5).

---

## 5. Core data concepts (so visuals reflect the model)

| Concept | One-line definition |
|---|---|
| **Family** | A household. Identified by **FID** (Family ID), the primary key everywhere. |
| **Member** | A person in a family. Has its own **MID** (Member ID). Type = Adult or Child. |
| **Family Manager** | Boolean on a member. At least one per family. Can edit family + invite others. |
| **Program** | A Mission offering (Bala Vihar, Tabla, etc.). Bala Vihar is the only one at launch. |
| **Enrollment** | Family-in-Program record. Includes `enrollmentPeriod` snapshot for donation pricing. |
| **Donation Intent** | Suggested donation amount, locked at the period the family first attended. |
| **Attendance event** | One student's presence on one class day. |
| **Donation Period** | Admin-configured pricing tier (e.g., "Brampton Fall Semester 2026: $500"). |

**Key business rules to surface in UI:**
- During registration, a contact match (email OR phone) against an existing family **blocks new family creation** and instead surfaces a "Join {FamilyName}?" prompt.
- A family that hasn't enrolled but attends class is **auto-enrolled on first attendance**, and the donation intent is pinned to that period's rate — even if they pay later when rates are lower.
- Legacy Bala Vihar families have **existing FIDs** that must be carried over. The new portal generates a fresh FID for every family at registration/migration time and stores the old one as `legacyFid` on the family record. **Both must be searchable** in welcome-team lookup (6.4.1) — a sevak typing the old FID into the search bar must still find the family. Surface both IDs on the family card (new FID prominent, legacy FID as secondary metadata). The migration story is separate; just don't design a UI that prevents this.

---

## 6. Screens to design

Numbered for reference. ★ = critical for go-live, ☆ = nice-to-have.

### 6.1 Public / auth shell
- **6.1.1 ★ Landing / sign-in.** Single page. Hero, brief mission statement, prominent "Sign in or register" CTA. Footer with links to chinmayatoronto.org and events.chinmayatoronto.org. Honest about being members-only.
- **6.1.2 ★ Sign-in flow.** Passwordless email link or phone OTP. Loading / sent / error states.
- **6.1.3 ★ Registration — step 1: contact.** User enters email + phone. System checks for matches. Two outcomes designed:
  - No match → continue to step 2 (new family).
  - Match found → "We found a family with this contact: **The Patel Family**. [Join this family] / [That's not me — contact admin]".
- **6.1.4 ★ Registration — step 2: family details.** Family name, primary location (Brampton / Mississauga / etc.), set yourself as Family Manager, add at least one child or other adult.
- **6.1.5 ★ Family invite accept.** Landing for invite links. "You've been invited to join the Patel family on Setu."

### 6.2 Family-side
- **6.2.1 ★ Dashboard.** Hero greeting ("Namaste, Aarti"). Cards: My Family (count + avatars), Bala Vihar status (enrolled/not, next class, attendance %), Donation status (paid / pending / amount), Quick actions.
- **6.2.2 ★ My Family — roster view.** List of members with avatar, name, type (Adult/Child), age/grade for children. Buttons: Add member, Invite co-manager. Each row tappable → member detail.
- **6.2.3 ★ Member detail / edit.** All fields per §7 below. Differentiate required vs optional. Distinct layout for Adult vs Child (don't show "School Grade" for an adult, don't show "Volunteering Skills" for a child).
- **6.2.4 ★ Add member.** Same form as detail, in create mode. Reachable from 6.2.2.
- **6.2.5 ★ Bala Vihar enrollment + donation.** Shows current period, suggested amount, what's included, [Enroll & Donate] CTA. Post-enrollment, becomes the "your enrollment" status card.
- **6.2.6 ★ Donation checkout.** Amount (editable up — never down below suggested), payment method (Stripe card / eTransfer instructions / cheque-in-person). Tax receipt confirmation copy.
- **6.2.7 ★ Donation history / receipts.** Year-grouped list with download-PDF per receipt.
- **6.2.8 ☆ Attendance per child.** Calendar heatmap + recent absences list. Read-only.

### 6.3 Teacher-side
- **6.3.1 ★ Teacher dashboard.** Today's classes, quick "Take attendance" CTA per class, recent attendance summary.
- **6.3.2 ★ Class roster.** List of enrolled students with avatar, name, grade, parent contact (tap to reveal). Sortable by name / attendance %.
- **6.3.3 ★ Take attendance.** Optimized for phone. Big tap targets. Three-state toggle per row (Present / Absent / Late). Sticky "Save attendance" footer. Show count `12 / 18 marked`. Offline-tolerant if possible — at minimum, optimistic UI.
- **6.3.4 ★ Student detail (teacher view).** Attendance %, calendar of marks, parent contact, allergies/emergency-contact callout banner (always visible — it's safety-critical).
- **6.3.5 ★ Guest list (today).** Visiting students from other classes/locations; one-tap "Mark as guest attendance."
- **6.3.6 ★ Add student on prompt.** Modal/sheet: child first/last, grade, parent email or phone. Submit → "Invite sent to parent." Show pending-invite badge on roster until parent completes registration.

### 6.4 Welcome team
- **6.4.1 ★ Welcome dashboard.** Search bar (family by **name / email / phone / new FID / legacy FID**) as the hero element. Search must match on all five — a legacy-FID hit should display the family with both IDs visible and a small "Legacy ID" pill. Below the search: "Needs attention" queue (failed payments, duplicate-suspects, unverified contacts).
- **6.4.2 ★ Family lookup result.** Family card + member list + program enrollments + donation status. All editable inline (with confirm).
- **6.4.3 ☆ Duplicate-merge tool.** Side-by-side family records with checkboxes per field — choose which to keep, then merge. Destructive; needs confirm.

### 6.5 Admin (welcome team superset)
- **6.5.1 ★ Donation period config.** Table per program × location. Columns: Period name, Start date, End date, Suggested amount. Inline editable. New row at top. (Bala Vihar only for go-live, but design generically.)
- **6.5.2 ☆ Role assignments.** List of users with Teacher / Welcome / Admin badges. Promote/demote with confirm.

### 6.6 Shared chrome
- **6.6.1 ★ App shell.** Top nav (logo, primary nav, profile menu), mobile bottom nav for the family role, persistent sidebar for teacher/welcome roles on desktop.
- **6.6.2 ★ Empty states.** First-time family with no members, teacher with no class today, etc.
- **6.6.3 ★ Error states.** Per-segment React error boundaries — design a friendly "Something went wrong" with retry + contact link.
- **6.6.4 ★ Loading skeletons** for each list/dashboard.

---

## 7. Member field spec (drives forms 6.2.3 and 6.2.4)

| Field | Required for | Type / notes |
|---|---|---|
| Member ID (MID) | (auto) | System-generated, displayed read-only |
| First Name | All | Text |
| Last Name | All | Text |
| Gender | All | Male / Female / Prefer not to say |
| Member Type | All | Adult / Child (drives conditional fields) |
| Food Allergies | All | Free text, with "None" preset chip |
| Emergency Contact 1 | All | Relation + Phone + Email (sub-form) |
| Emergency Contact 2 | All | Relation + Phone + Email (sub-form) |
| Family Manager | All | Toggle (Adults only can be manager) |
| Joined Date | All | Date — defaults to today on create |
| Email | Adult required, Child optional | Email validation |
| Phone | Adult required, Child optional | Canadian phone format |
| Volunteering Skills | Adult only (optional) | Multi-select from preset list (TBD: cooking, driving, AV, teaching, …) |
| School Grade | Child only (optional) | Pre-K through Gr 12 |
| Birth Month & Year | Child only (optional) | Month picker + year picker (not full DOB — privacy) |

---

## 8. Constraints & non-goals

**Constraints:**
- Must work on iPhone SE (375px) and up.
- Must be accessible (WCAG 2.1 AA): visible focus, ≥4.5:1 contrast, keyboard-navigable, semantic landmarks.
- Lighthouse Performance ≥ 90 on the family dashboard.
- All copy in English (Hindi/Sanskrit terms inline as italics).
- Must not depend on a component library outside shadcn/ui without flagging it.
- Donation flows must clearly communicate that this is a charitable donation (Canadian-registered charity), not a fee for service.

**Non-goals (do NOT design these):**
- Event registration UI (lives at events.chinmayatoronto.org).
- Public-facing program catalog / marketing pages (chinmayatoronto.org handles this).
- Multi-language support (English only at launch).
- Native mobile app (responsive web is the plan).
- Social/community features (forums, chat, etc.).
- Payment-processor admin tools (Stripe dashboard handles ops).

---

## 9. Tone & copy direction

- **Warm and welcoming**, addressing users by first name. "Namaste, Aarti."
- **Plain English**, no jargon. "Donation suggestion" not "dakshina recommendation engine."
- **Honest about money.** Donation pages clearly state: this is a suggested amount, the program runs on family donations, and giving more is welcome.
- **Acknowledge volunteer effort.** Teacher tools should feel like a thank-you, not a clock-punch. Microcopy like "Thank you for taking attendance today" beats "Attendance saved."
- **Safety-first for kids.** Allergy and emergency-contact info on a child's record should be visually unmissable in the teacher view — color, icon, repetition.

---

## 10. Deliverables I want from claude design

1. **High-fidelity mocks** of every ★ screen in §6, in both mobile (375w) and desktop (1280w) widths where applicable.
2. **Component composition notes** — for each new pattern, say which shadcn primitive(s) it composes from, or flag if a new primitive is needed.
3. **A short design-tokens doc** if you propose any additions to the palette/typography/spacing scale.
4. **Interaction notes** for the multi-step flows (registration dedupe in 6.1.3, attendance taking in 6.3.3, donation checkout in 6.2.6) — describe state transitions, not just static screens.
5. **At least 2 visual directions for the family dashboard (6.2.1)** so we can pick a tone before you commit the rest of the system.

---

## 11. Content management strategy

**Decision: 100% in-portal CMS. No external CMS, ever.** Admins are volunteers; the portal's own admin surface is the only place they edit content. Static legal pages live as MDX in the repo (dev-edited).

### 11.1 Two buckets of "content"

| Bucket | Examples | Where it lives | Who edits |
|---|---|---|---|
| **Structured / transactional** | Donation periods, programs, locations, classes, volunteering-skills list, role assignments, email/SMS templates, announcements, FAQ entries | In-portal admin tables (§6.5) | Welcome team / Admin |
| **Static legal / informational** | About, Terms of Service, Privacy Policy | MDX files under `apps/portal/src/content/` | Dev (PR-reviewable) |

### 11.2 Admin surfaces to add to §6.5

- **6.5.3 ★ Announcements.** Table of announcements with: title, body (**plain text — no rich formatting**), optional image, optional link, audience (All / Families / Teachers / Welcome), start date, end date, severity (info / warning / urgent), enabled toggle. Active announcements render as a dismissible banner on the matching dashboards with **system-applied styling** — the admin only authors content, never visual treatment. Schedulable in advance.
- **6.5.4 ☆ Email & SMS templates.** List of system templates (welcome, family invite, attendance reminder, donation receipt, payment-failed notice). Each has subject + body with mustache-style variables (`{{familyName}}`, `{{amount}}`, `{{programName}}`). Plain text only — no rich-text editor. Provides a "send test" button to the logged-in admin's contact. Templates are seeded from the repo on first deploy and editable afterward.
- **6.5.5 ☆ Volunteering skills + class catalog.** Simple list editors for the dropdown options that drive forms elsewhere (member form, class assignment, etc.).
- **6.5.6 ☆ FAQ entries.** Question + plain-text answer + display order + audience filter. Surfaces on a portal-internal `/help` page.

### 11.3 No external CMS — locked decision

Sanity, Payload, Strapi, Contentful, etc. are explicitly ruled out — now and in the future. The reasons:

- **Single login.** Volunteer admins should never maintain a second account or permission model. Firebase Auth + the portal's role system is the only access layer.
- **Single admin UI.** Transactional data (members, attendance, donations) lives in Firestore. Splitting "records here, content there" creates context-switching for volunteers and bug surface for devs.
- **Low content volume.** Announcements, a handful of email templates, FAQ entries, and a few static pages. Operationally cheap to handle in-portal.
- **No editorial workflow needed.** The mission doesn't have a marketing/content team — admins post announcements as needed, not on a publishing schedule that demands preview/staging/approval.

This rule stands across phases. If a future feature looks like it "wants" a CMS, the answer is: build the admin screen in-portal.

### 11.4 What this means for design

- Anywhere a piece of copy is admin-editable, indicate it in the mocks with a small marker (e.g., a footnote "editable via Admin → Announcements"). This keeps developers from accidentally hardcoding strings the admin expects to control.
- Announcement banners need designed states: info / warning / urgent, dismissible, with optional CTA link and optional inline image. Admin only types text + uploads an image; **all styling is system-defined**.
- Email/SMS template editor should look like a normal form (subject input + textarea), not a rich-text editor — keep it minimal; templates are mostly transactional copy.
- Static-page layouts (About / Terms / Privacy) need a consistent "long-form content" template — generous typography, anchor links for sub-sections, table of contents on desktop.

### 11.5 Phase-1 vs later (parking lot)

For clarity on what NOT to design now:

- **Event registration UI** — owned by the standalone app at events.chinmayatoronto.org. Portal may surface a single nav link to it.
- **Event galleries / event recaps** — planned for a future phase. Not part of phase-1 design. When it arrives, expect a single "Gallery" admin surface (upload photos, group by event, set visibility) — still in-portal.
- **Multi-language** — English only. No internationalization assumptions in the design.
- **Other programs** (Tabla, Dance, OM Chanting, Gita Chanting, workshops) — schema/UI should be extensible to them, but no screens designed for them now.

Phase-1 target = Bala Vihar registration, enrollment, attendance, and donations, with the family/member/admin foundation underneath.

---

## 12. Out-of-band context (read if useful)

- Current codebase: Turborepo monorepo. App: `apps/portal` (Next 16). Shared UI: `packages/ui`. Brand tokens: `packages/ui/src/styles/tokens.css`.
- The existing standalone check-in app (`chinmaya-family-check-in`) is the closest visual reference for what teachers/sevaks expect today — but it's a kiosk experience and feels dated. We're explicitly upgrading.
- The existing event-registration app (`chinmaya-event-registration` → events.chinmayatoronto.org) is staying as-is and is NOT a visual reference.

---

*End of brief. Send mocks + notes back as a single PDF or a Figma link with named frames matching §6 numbers.*

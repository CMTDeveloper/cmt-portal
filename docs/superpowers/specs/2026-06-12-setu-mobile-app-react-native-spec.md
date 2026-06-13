# CMT Setu Mobile App — React Native Blueprint Spec

**Date:** 2026-06-12 · **Status:** Ready to build
**Audience:** an autonomous build agent (Claude Code) creating the mobile app in a NEW repository. This spec is self-contained — you do not need access to the portal repo. Everything here was verified against the portal codebase on 2026-06-12.

---

## 1. What you are building

**Chinmaya Setu** is the family portal of Chinmaya Mission Toronto (CMT). Families register, manage their members, enroll children in programs (Bala Vihar Sunday school, Tabla, etc.), pay a suggested donation (dakshina) by card, confirm their family's **prasad** Sunday, sign up for **seva** (volunteering) opportunities, and follow the class calendar. Volunteer **teachers** take Sunday attendance on their phones.

You are building the **native mobile app** (iOS + Android, React Native) that gives families and teachers the same capabilities as the web portal at `https://cmt-setu.vercel.app`, consuming the portal's existing JSON APIs. The portal stays the system of record — the app is a client, with **no direct Firestore access** (Auth SDK only).

### 1.1 Scope

| In scope (native app) | Out of scope |
|---|---|
| Family: sign-in (OTP + password), registration, invite accept, dashboard, members CRUD, member detail w/ attendance, programs browse + enroll, donate (Stripe), prasad confirm/move, seva browse/sign-up, class calendar, contact + password settings | Admin console (`/admin/*`) and welcome-team tools (`/welcome/*`) — staff use the responsive web portal |
| Teacher: my classes, Sunday attendance marking, visitors/walk-ins, student detail w/ safety info, achievements | Push notifications (portal notifies via email/SMS today — design for it later, don't build it) |
| | Offline writes, payments other than the Stripe flow, donation history screen (removed from the portal by CMT decision 2026-06-04) |

### 1.2 Build phases (each phase ships a usable app)

1. **Phase A — Auth + Family core:** sign-in/out, registration, invite accept, dashboard, members list/detail/add/edit, settings (contacts, password).
2. **Phase B — Programs & money:** programs list, enroll flow, Stripe donate flow, calendar.
3. **Phase C — Community:** prasad card (confirm / pick another Sunday), seva (browse, sign up, cancel, progress).
4. **Phase D — Teacher:** classes list, attendance marking, visitors, student detail, achievements.

---

## 2. Tech stack (mandated)

- **Expo** (latest SDK, managed workflow) + **TypeScript strict** (`exactOptionalPropertyTypes: true` to match the portal's discipline).
- **expo-router** (file-based routing; mirrors the portal's App Router mental model).
- **@tanstack/react-query** for all server state (no Redux). Query keys per endpoint; pull-to-refresh = `refetch`.
- **firebase** (JS SDK, web package) — **Auth only**: `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`, `signInWithCustomToken`, `getIdToken`. No Firestore/Storage imports.
- **react-native-webview** for the Stripe checkout container (navigation-event interception — see §8).
- **zod** for runtime validation of API responses (mirror the schemas in §6; treat a parse failure as an app bug to surface, not swallow).
- Plain `StyleSheet`/inline styles with a `tokens.ts` design-token module (§9). No UI kit — the design system is bespoke and small.
- Testing: **Maestro** flows against UAT for E2E; vitest/jest for pure logic (API client, date helpers).

---

## 3. Environments & configuration

Build and test **only against UAT**:

| Setting | Value |
|---|---|
| API base URL | `https://cmt-setu.vercel.app` |
| Firebase project | `chinmaya-setu-uat` (Auth only from the app) |
| Firebase client config | Ask the portal team for the UAT web-app config values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId — same values the portal uses as `NEXT_PUBLIC_PORTAL_FIREBASE_*`) |

App config lives in `app.config.ts` extras + a typed `env.ts`. Never hardcode the production project (`chinmaya-setu-715b8`) anywhere — production cutover is a separate, deliberate step owned by the portal team.

**Deployment preconditions (verify before debugging "broken" endpoints):** three feature switches on the portal gate whole API families with **404s, not 403s**:
- `NEXT_PUBLIC_FEATURE_SETU_AUTH` → all session-minting routes (verify-code, password-sign-in, register, family GET).
- `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` → the checkout route + donate pages.
- `NEXT_PUBLIC_FEATURE_SETU_TEACHER` → **every** `/api/setu/teacher/*` route (blocked in middleware).

Treat a 404 on a whole family of routes as "feature disabled on this deployment", not "wrong URL".

**UAT sign-in for development:** UAT email/SMS sends are allowlist-gated server-side, so OTP codes only reach allowlisted contacts. Use the **seeded password test accounts** instead (shared password, ask the team; via `POST /api/setu/auth/password-sign-in?mode=mobile`):
`setu-test-parent-brampton@chinmayatoronto.org` (family-manager, 2 kids, BV-enrolled) · `setu-test-member-brampton@…` (family-member) · `setu-test-parent-scarborough@…` (has a proposed prasad fixture) · `setu-test-teacher-brampton@…` / `-scarborough@…` / `-universal@…` (parent-teachers; one level / one level / all levels) · `setu-test-sevak@…` (welcome-team) · `setu-test-admin@…` (admin).

**CORS:** native HTTP sends no `Origin` header, so CORS does not apply to the shipped app. It only matters if you develop with Expo **web** — then the portal's `MOBILE_CORS_ORIGINS` env var must include your dev origin (currently unset; ask the portal team). Do not let CORS questions block native development.

---

## 4. Authentication architecture (already implemented portal-side)

The portal mints **Firebase custom tokens** for mobile. The canonical sequence:

```
1. POST /api/setu/auth/send-code            { type: 'email'|'phone', value }
   → 200 { success: true }   (ALWAYS 200, even for unknown contacts — anti-enumeration)

2. POST /api/setu/auth/verify-code?mode=mobile   { type, value, code: '123456' }
   → 200 { customToken }                          (existing family)
   → 200 { redirectTo: '/register?contact=verified' }  (no family — go to registration, NO credential yet)
   → 400 { error: 'invalid-or-expired' }          (wrong/old code — codes live 10 minutes)

3. firebase: await signInWithCustomToken(auth, customToken)
4. const idToken = await user.getIdToken()
5. Every API call:  Authorization: Bearer <idToken>
```

The **password path** is identical via `POST /api/setu/auth/password-sign-in?mode=mobile` `{ email, password }` → `{ customToken }` (401 `invalid-credentials`, 403 `user-disabled`, shares the OTP rate limiter).

`mode=mobile` may be a query param **or** a body field, on: `verify-code`, `password-sign-in`, `register`, `invite/accept`, `signout`.

### 4.1 Claims, roles, and refresh

- Before minting the token the portal persists custom claims on the Firebase user: `{ role, fid, mid, email|phone, extraRoles? }`. **Every hourly ID-token refresh carries them** — read them client-side from `user.getIdTokenResult().claims`, never from response bodies.
- **Claim variants you must handle:** family `{ role: 'family-manager'|'family-member', fid, mid, … }` · staff `{ role: 'admin' }` / `{ role: 'welcome-team' }` (no fid/mid) · fresh invitee `{ role: 'family', familyId: '' }` (may only call invite endpoints). A parent-teacher keeps their family role and gains `'teacher'` in `extraRoles`.
- **Role gating in the app:** writes (enroll, donate, member add/edit-others/delete, invite send, prasad confirm/move) require `role === 'family-manager'`. Capability checks (teacher) must look at `role` **or** `extraRoles` membership — never a single strict equality.
- **Token refresh:** ID tokens live 1 hour. Refresh proactively (check `getIdTokenResult().expirationTime`) or reactively: on any 401, `getIdToken(true)` once and retry once. After an action that changes roles (e.g. accepting an invite), force `getIdToken(true)`.
- **Sign-out:** `POST /api/setu/auth/signout?mode=mobile` → `{ ok: true }`, then `auth.signOut()` locally. There is no server session to kill for Bearer clients.

### 4.2 Registration & joining a family

- **New family:** after the `redirectTo: '/register?contact=verified'` branch, collect: `email`, `phone`, `familyName`, `location` (one of the 4 CMT locations — fetch the literal list from the team: Brampton, Scarborough are the two active ones), `manager { firstName, lastName, gender }`, `additionalMembers[]`. `POST /api/setu/register?mode=mobile` → `201/200 { fid, mid, customToken }` → sign in with it. Errors: `409 duplicate-contact`, `409 duplicate-contact-in-form`, `429 rate-limited`.
- **Find my family first:** `POST /api/setu/family-lookup` `{ emails?: string[], phones?: string[] }` → `{ match: { fid, name, … } | null }` (rate-limited ~30/window per IP). If matched, the user simply **signs in via OTP with that contact** — the portal lazily attaches/migrates them. ⚠️ **There is NO `/api/setu/family/join` endpoint** (it was removed; an older portal doc still mentions it — ignore that).
- **Invite accept:** invite emails carry a token. App flow: user signs in (OTP — invitees with a pending invite DO receive codes even with no family) → `GET /api/setu/invite/{token}` (any signed-in role) → `{ familyName, inviterName, relation, expiresAt }` or 404/409/410 → `POST /api/setu/invite/accept?mode=mobile` `{ token }` → `200 { mid, fid, customToken }` → `signInWithCustomToken` again (claims changed). 403 means the invite email doesn't match the signed-in contact — show which email was invited.

### 4.3 Error & rate-limit contract (encode exactly)

| Code | Body | Meaning / UX |
|---|---|---|
| 401 | `{ error: 'no-session' }` | Missing/expired token → refresh + retry once, else sign-in screen |
| 401 | `{ error: 'unauthorized' }` | Role denied (middleware uses 401 for this, **not** 403) → hide the feature |
| 403 | `{ error: 'manager-required' \| 'forbidden' \| … }` | Handler-level role denial |
| 400 | `{ error: 'invalid-or-expired' }` | OTP wrong/stale (NOT 401) |
| 429 | `{ error: 'rate-limited' \| 'too-many-requests', resetAt? }` | OTP: 5 sends/contact/15 min (show countdown from `resetAt`). Checkout: 5/min/IP |
| 409 | `{ error: <specific> }` | Conflicts (duplicate contact, last-manager, prasad target-full, …) |
| 404 | `{ error: 'not-found' }` | Real 404 **or** feature flag off (see §3) |

All dates in responses are ISO-8601 strings; calendar/attendance dates are `YYYY-MM-DD` strings in **America/Toronto** terms. Money is **integer CAD dollars**.

---

## 5. Portal-side prerequisites — ✅ SHIPPED 2026-06-12 (commit `e230061`)

The three blocking portal items are now live on UAT and verified end-to-end
over the real Bearer path (`e2e/setu/mobile-bearer.spec.ts`). Build against them
directly — no stubbing needed:

1. ✅ **The 7 cookie-coupled routes now authenticate over Bearer** (`GET
   /api/setu/family`, contacts send-code/verify-code/dismiss-nudge,
   volunteering-skills/dismiss-nudge, auth/set-password, invite/accept).
   Middleware forwards the verified contact as `x-portal-email`/`x-portal-phone`
   and the handlers read the session from those headers. `GET /api/setu/family`
   over Bearer returns 200 — confirmed against deployed UAT.
2. ✅ **`GET /api/setu/dashboard`** — the family-home aggregate (see §6.0 for
   the response shape).
3. ✅ **`GET /api/setu/donations`** + **`POST /api/setu/donations/{did}/status`**
   `{ status: 'completed'|'abandoned' }` (manager-only) — the mobile equivalent
   of the web success/cancel pages (see §8).

Still open (not blocking; build without them): child Bala Vihar **journey** rows
for the member-detail screen, and API versioning (`/api/v1/`) before public
release. Treat the response shapes here as the contract until versioning lands.

### 6.0 GET /api/setu/dashboard response (the mobile home)

```jsonc
{
  "family": { "fid", "name", "location" },
  "currentMid": "CMT-…-02",
  "isManager": false,
  "members": [{ "mid", "firstName", "lastName", "type" }],
  "balaVihar": {
    "isEnrolled", "kidsEnrolled", "termLabel",
    "suggestedAmount", "givenForPeriod", "donationComplete", "donationPct",
    "donationHeading", "isLegacyPeriod", "legacyPaid",
    "attendance": { "attended", "total", "pct", "hasAttendance",
                    "marks": [{ "date": "YYYY-MM-DD", "present": true }] }
  },
  "otherPrograms": [{ "eid", "programKey", "label", "termLabel", "status",
                      "showAttendance", "showDonation" }],
  "upcoming": [{ "entryId", "date", "kind", "classType", "noClassReason",
                 "specialEvents" }],   // next 3 class Sundays
  "seva": { "currentSevaYear": null, "hoursPerYear": 20, "hoursEarned": 0 },
  "prasad": { "date", "status", "reason", "youngestName", "birthMonth", "movable" } // or null
}
```
UI-only fields (CSS colors, donate URLs) are deliberately omitted — build your
own presentation. Any family role may read it.

---

## 6. API contract (verified 2026-06-12)

Base: `https://cmt-setu.vercel.app`. Auth: `Authorization: Bearer <idToken>` on everything except the public auth/registration routes. Generic client: JSON in/out, zod-validate, central error mapper per §4.3.

### 6.1 Family & members

| Route | Auth | Request | Response |
|---|---|---|---|
| `GET /api/setu/family` | any family role | — | `{ family, members: MemberDoc[], currentMid, isManager }` |
| `POST /api/setu/members` | manager | Member fields (below) | `201 { mid }` · `409 contact-already-registered` |
| `PATCH /api/setu/members/{mid}` | manager, or self-edit (own mid; cannot change manager flag) | partial member fields | `{ ok: true }` · `409` last-manager / contact conflicts |
| `DELETE /api/setu/members/{mid}` | manager | — | `{ ok: true }` · `409 last-manager` |
| `GET /api/setu/members/{mid}/profile` | own family or staff | — | `{ profile }` — see §6.1.1 |
| `GET /api/setu/volunteering-skills` | any family role | — | `{ options: string[] }` |
| `POST /api/setu/contacts/send-code` / `verify-code` | any family role | `{ type, value }` / `{ type, value, code }` | `{ success: true }` · 409 `contact-in-use` (add/verify your OWN extra contact) |
| `POST /api/setu/invite/send` | manager | `{ email, relation }` (relation 1–40 chars) | `201 { token }` |

**Member fields:** `type ('Adult'|'Child')`, `firstName*`, `lastName*`, `gender ('Male'|'Female'|'PreferNotToSay')`; Child: `schoolGrade?`, `birthMonthYear? ('MMM YYYY')` **and** `birthMonth? (1–12)` — capture month+year once, send both; `foodAllergies?`; Adult: `email?`, `phone?`, `volunteeringSkills?: string[]`; both: `emergencyContacts: [ec|null, ec|null]` where `ec = { relation*, phone?, email? }` (if any field is filled, `relation` is required). Email/phone are globally unique across all families (409 on conflict).

#### 6.1.1 Member profile (the per-child screen powerhouse)

`GET /api/setu/members/{mid}/profile` returns `{ profile: { mid, fid, firstName, lastName, type, schoolGrade, birthMonthYear, foodAllergies, programs[], pastPrograms[], achievements[], stats: { programCount, overallAttendedPct, hasAnyAttendance } } }` — each `programs[]` entry carries `attendance: { mode: 'teacher'|'check-in'|'none', available, attended, total, attendedPct, marks: [{ date, present }], note }`, **already window-scoped server-side** to the right offering. Use it as-is; do not recompute attendance client-side.

### 6.2 Programs, enrollment, donations

| Route | Auth | Request | Response |
|---|---|---|---|
| `GET /api/setu/programs` | family or staff | — | program list incl. capabilities + open offerings |
| `GET /api/setu/enrollments` | any family role | — | `{ enrollments: [{ eid, oid, programKey, programLabel, termLabel, status, enrolledAt, effectiveSuggestedAmount, enrolledMids, … }] }` |
| `POST /api/setu/enrollments` | manager | `{ oid }` | `201 { eid, suggestedAmount, donateUrl }` (200 if already enrolled — idempotent) · `422 offering-disabled/expired` |
| `DELETE /api/setu/enrollments/{eid}` | manager | — | `{ ok: true }` |
| `POST /api/setu/donations/checkout` | manager | `{ type: 'enrollment', eid, amountCAD, coverFee }` | `200 { url, did }` — see §8 · `422 amount-below-suggested { suggested }` · `400 donor-email-required` · `429` (5/min) · `503 checkout-not-configured` |
| `GET /api/setu/donations` | any family role | — | `{ donations: DonationDoc[] }` (newest first; ISO dates; `status` best-effort) |
| `POST /api/setu/donations/{did}/status` | manager | `{ status: 'completed'\|'abandoned' }` | `{ ok: true, status }` · `404` unknown did / other family · `403 manager-required` — report the Stripe return outcome (see §8) |

Client rules: `amountCAD` integer 1–100000, must be ≥ `effectiveSuggestedAmount` (giving more is fine); `coverFee` adds 2.2% + $0.30 shown live; the signed-in manager needs an email on their member record.

### 6.3 Prasad, seva, calendar

| Route | Auth | Request | Response |
|---|---|---|---|
| `GET /api/setu/prasad` | any family role | — | `{ assignment: { date 'YYYY-MM-DD', status 'proposed'|'assigned'|'cancelled', reason, youngestName, confirmedAt, … } \| null }` |
| `GET /api/setu/prasad/options` | any family role | — | open Sundays with spots left |
| `POST /api/setu/prasad/confirm` | manager | `{ date? }` (omit = confirm suggested in place) | confirmed · `409 already-confirmed / target-full / invalid-target` — capacity re-checked transactionally, handle 409 by refreshing options |
| `POST /api/setu/prasad/move` | manager | `{ date }` | moved · 409s as above; confirmed dates lock 7 days before |
| `GET /api/setu/seva/opportunities` | any family role | — | `{ opportunities[], currentSevaYear (nullable!), hoursPerYear, hoursEarned }` |
| `GET /api/setu/seva/my` | any family role | — | `{ mySignups[] }` |
| `POST /api/setu/seva/signups` | any family role (not just manager) | `{ oppId, mid: string\|null }` (null = whole family) | `201/200 { signupId, status: 'signed-up' }` (200 = already signed up — treat as success) · `409 not-open / already-resolved` |
| `POST /api/setu/seva/signups/{signupId}/cancel` | owner family | — | `{ ok: true }` · `409 not-cancellable` (hours already confirmed) |
| `GET /api/setu/calendar?location=X&programKey=bala-vihar` | any signed-in | `location` REQUIRED (400 otherwise) | `{ location, programKey, entries[], weekly }` — entries have `date, kind 'class'|'no-class', classType, noClassReason, specialEvents, prasadNeeded` |

Null-tolerant UI required: prasad `assignment` may be null (no rotation yet); `currentSevaYear` may be null (module dormant) — hide those cards gracefully.

### 6.4 Teacher (Phase D — all routes 404 unless the teacher flag is on)

| Route | Auth | Request | Response |
|---|---|---|---|
| `GET /api/setu/teacher/levels` | teacher | — | `{ levels: [{ levelId, levelName, location, ageLabel, curriculum }] }` (empty = not assigned yet) |
| `GET /api/setu/teacher/levels/{levelId}/roster?date=YYYY-MM-DD` | teacher of that level | date defaults to most recent Sunday | `{ view: { levelId, levelName, date, total, rows: [{ mid, firstName, lastName, schoolGrade, status 'present'|'late'|'absent'|null, source, checkedInAtDoor, hasSafetyInfo }] } }` |
| `POST /api/setu/teacher/attendance` | teacher of level | `{ levelId, date, marks: { [mid]: 'present'|'late'|'absent' } }` | `{ saved, skipped[] }` — only marked students saved; re-marking overwrites |
| `GET /api/setu/teacher/visitors?levelId&date` | teacher | — | `{ view: { doorVisitors[], confirmed[] } }` |
| `POST /api/setu/teacher/visitors` | teacher | `{ levelId, date, firstName, lastName?, schoolGrade?, parentEmail?, parentPhone? }` | `{ fid, childMid, createdFamily, autoEnrolled, claimable }` ⚠️ creates a real pending family — always capture a parent contact |
| `POST /api/setu/teacher/guests` | teacher | `{ levelId, date, mid, status? }` | `{ aid, autoEnrolled }` |
| `GET /api/setu/teacher/students/{mid}` | teacher with this student on any of their rosters | — | `{ student: { …, foodAllergies, emergencyContacts, summary { attendedPct, present, late, absent, total }, records[], parents[] } }` |
| `POST /api/setu/teacher/achievements` | teacher of student | `{ mid, title (1–80), description? (≤500), programKey? }` | `201 { achId }` |

Date rules: default and navigation are **Sundays in Toronto time**; the app steps ±7 days; block future dates in UI ("This class is upcoming") — the server does not enforce it, so don't let the UI offer it.

---

## 7. Information architecture & navigation

**Family bottom tab bar** (64px + safe-area, mirrors the portal): **Home · Family · Programs · More**. The More sheet: Seva, Prasad, Calendar, Settings (Contacts, Password), Teacher (only when `extraRoles` contains `teacher` AND `GET /api/setu/teacher/levels` doesn't 404), Sign out. Hide the tab bar on form/detail pushes (member edit/new, enroll, donate) and show a **sticky footer CTA** instead — exactly the portal's mobile pattern.

**Stacks:** Auth stack (welcome → contact entry → OTP code → [register | home]); invite deep entry (route `setu://invite/{token}` reserved; v1 may rely on in-app token paste from the email); Teacher stack (classes → attendance → visitors → student).

Screen-by-screen requirements:

- **Home:** greeting by first name; Bala Vihar card ("X of Y Sunday classes", enrolled kids, donation progress — all from `GET /api/setu/dashboard`, §6.0); next-3 upcoming class dates (from calendar API, `kind` + `specialEvents` rendered); prasad card (proposed → "Suggested prasad Sunday {date} — Confirm / Pick another"; assigned → date + countdown); seva progress ("X of Y hours"); program cards. Pull-to-refresh refetches everything.
- **Family:** member list (avatar, name, type, grade, You/Manager tags, allergy badge); add member + invite buttons (manager only). Member detail: identity fields, emergency contacts, per-program attendance with a **heatmap of `marks[]`** (16×16 squares), achievements. Edit/new member forms = §6.1 field rules, sticky-footer Save.
- **Programs:** active programs with open offerings → enroll screen: eligible members shown (server decides — display `enrolledMids` result), dakshina explainer ("suggested, not required" for donation programs; "no donation requirement" otherwise), term picker if multiple offerings, Enroll (manager-only; members see a notice) → on success continue straight into Donate prefilled with `suggestedAmount`.
- **Donate:** amount (integer), quick-pick chips (suggested · 1.5× · 2×, suggested labelled), below-floor inline error ("To give less, please contact the welcome team"), cover-fee checkbox with live fee, summary (Donation / Fee / Total today), February tax-receipt note, "Secured by Stripe". Then §8.
- **Prasad:** status-aware card; "Pick a different Sunday" opens the options list ("3 spots left" per date); handle every 409 by refreshing options with a friendly message.
- **Seva:** goal band ("X of Y hours of seva this year"), open opportunities (date, hours, location, spots left), sign up as whole family or credit a member, My sign-ups with cancel; pending sign-ups never count toward hours — say "You're signed up for N opportunities — thank you".
- **Calendar:** month-grouped class Sundays + weekly time rows; special events called out.
- **Teacher — attendance (the flagship phone screen):** stats strip (Enrolled · Checked-in · Present · Late · Absent · Unmarked), per-row 3-state toggle (48px-tall targets, tap again to unmark), door-check-in pre-seed badge, allergy red dot, sticky save bar with 3px progress fill and live count ("12 present / 6 not marked"), ‹ › Sunday navigation, Visitors entry. Save → "Thank you for taking attendance" (tone matters — see §10).

---

## 8. Stripe donation flow (mobile pattern)

1. `POST /api/setu/donations/checkout` (Bearer works — the server derives the return origin from its own host; no Origin header needed) → `{ url, did }`.
2. Open `url` in a **react-native-webview modal** (not the system browser — you need navigation events).
3. On navigation to `https://<portal>/family/donate/success` → close the modal, treat as success; to `…/donate/cancel` → close, treat as cancelled. Read `?did=` from the URL and confirm it matches.
4. **Report the outcome:** `POST /api/setu/donations/{did}/status` `{ status: 'completed' | 'abandoned' }` (§6.2). This is essential: the portal has **no Stripe webhook**, and the web flow's completion marking needs a browser cookie the app doesn't have — without this call the donation stays `redirected` in the portal even though the card was charged.
5. Success UI: "Thank you for your dakshina" + the annual-tax-receipt note (receipts come from accounting each February; the app never shows receipts).

If the status call itself fails (network), still show the right outcome UI — Stripe/accounting reconcile independently of portal status — and retry the status call opportunistically.

---

## 9. Design system — "Cool Mist · Orange CTA" (locked 2026-05-22)

Cool, calm, modern Indian-Canadian. Cool-mist neutrals; **coral is the only warm color** and is reserved for primary actions — the contrast is the point. Inspiration: Linear, Notion Calendar, Stripe. Generous whitespace, soft shadows, at most one spiritual motif (OM/lotus/diya) per screen.

### 9.1 Tokens (`tokens.ts`)

| Token | Value | Use |
|---|---|---|
| bg | `#f3f6f8` | screen background |
| surface / surface2 | `#ffffff` / `#e3edf1` | cards / insets, code, table headers |
| ink | `#0f1a22` | headings |
| body | `#3a4a56` | body text |
| muted | `#7a8a96` | captions, labels |
| line / line2 | `#dde6ec` / `#c4d2dc` | hairlines / input borders |
| accent | `#d96642` | primary CTA (coral) |
| accentHover / accentDeep | `#c2562f` / `#a23f1e` | pressed / links |
| accentSoft | `#fde2d3` | chips, highlights |
| ok / warn / err | `#3d7a5a` / `#a06410` / `#8a3030` | present / late / absent + statuses (each has a `-soft` tint for backgrounds) |
| info / infoSoft | `#3a7e88` / soft teal | door-check-in, informational |
| radius / radiusSm / radiusXs | 14 / 10 / 6 | cards / buttons+inputs / chips |
| spacing scale | 4, 8, 12, 16, 24, 32, 48, 64 | |

Shadows: cards `0 1px 0 rgba(15,26,34,0.04)`; raised `0 4px 14px rgba(15,26,34,0.06)`. Focus/pressed ring: 3px `accentSoft`.

### 9.2 Type & components

- **Fonts:** Geist (via `expo-font`; fallback system). H1 26–30/600, letter-spacing −0.02em · body 14–15 in `body` color · overline labels 12/600 uppercase · captions 11–13 `muted`. Geist Mono for ids (FID/MID) only.
- **Components to build once:** Card; Pill (999 radius, 11/500); status Chips (`ok/warn/err/info` soft backgrounds); Buttons primary (coral, white text) / secondary (white, line2 border) / ghost (text-accent) — radius 10, padding 11×16, 600/14; Inputs (11×12 padding, line2 border, accent focus ring); BottomTabBar; StickyFooterCTA (border-top, safe-area inset); Sheet (More menu, term picker); EmptyState (52px icon circle, title 16/600, hint 14 muted); ProgressBar (3px); Heatmap square; the breathing-OM loading indicator (subtle 1.6s scale/opacity pulse); Toasts (top, success/error).
- **Icons:** stroke-based line icons, 2px stroke, 16–18px (lucide-react-native is an acceptable match): home, people, grid, dots, calendar, user, heart, shield, bell, chevron, back, plus, check, x, search, edit, mail, phone, card, download, warn, info, receipt.
- **Safe areas everywhere:** top bars, sticky footers, tab bar.

---

## 10. UX principles (from the locked redesign brief)

- Warm and personal: greet by first name. Plain English; no jargon, no Sanskrit beyond program names (define "dakshina" inline on first use).
- Honest about money: donation is suggested, never a fee; nothing in the app gates on payment.
- Acknowledge volunteers: "Thank you for taking attendance", not "Attendance saved".
- **Safety info is visually unmissable**: allergies and emergency contacts use color + icon + repetition (roster dot, banner on student detail).
- One-tap-per-row attendance designed for a phone in a busy lobby; big targets; explicit Save (no surprise autosave).
- Errors are human: rate-limit shows a countdown; capacity races say "That Sunday just filled up — here are the open ones."

---

## 11. Cross-cutting behavior

- **Loading/empty/error triad on every screen** (skeleton or OM pulse; designed empty states; retry button on errors).
- **Offline:** read-only tolerance via react-query cache + "You're offline" banner; queue NO writes (v1); attendance marking keeps local state until Save and warns before discard.
- **Dates:** treat `YYYY-MM-DD` strings as Toronto-local calendar dates; never construct them from device-local `Date` math without the Toronto anchor (`${ymd}T12:00:00Z` noon-UTC trick for day arithmetic).
- **Security:** tokens stay in Firebase SDK persistence; no PII in logs; webview only ever loads the portal origin + Stripe.
- **Accessibility:** all touch targets ≥44px, roles/labels on toggles, dynamic-type tolerant layouts.

---

## 12. Acceptance criteria (Definition of Done per phase)

- **A:** A seeded UAT parent signs in with password, sees their family, adds/edits/deletes a member (manager) while a family-member account is correctly read-only beyond self-edit; OTP flow works for an allowlisted contact incl. the 429 countdown; registration creates a family; invite accept joins one; token expiry mid-session recovers silently (401 → refresh → retry).
- **B:** Parent enrolls in an open offering, lands in donate prefilled, completes a Stripe **test-mode** payment in the webview, sees the thank-you state, the status call records it, and the portal shows the donation completed; below-floor amount blocked client- AND server-side (422 surfaced).
- **C:** Scarborough test parent sees their proposed prasad Sunday and confirms it (or hits 409 already-confirmed on rerun — both fine); seva sign-up + cancel round-trip; calendar renders the published season.
- **D:** Brampton teacher sees exactly their level, marks attendance for a past Sunday, response `{ saved }` matches the marks count, re-marking overwrites; universal teacher sees all levels; visitor quick-add returns `{ claimable: true }` with a parent email; allergy info visibly surfaced on roster + student detail.
- Every phase: Maestro flow recorded against `https://cmt-setu.vercel.app`; no hardcoded prod config; zod parse failures = test failures.

---

## 13. Known portal facts that will bite you if forgotten

1. ~~The 7 cookie-coupled routes 401 over Bearer~~ — ✅ fixed and verified on UAT (§5). `GET /api/setu/family` over Bearer returns 200. No longer a gotcha.
2. Middleware returns **401 for role denials** (`unauthorized`), not 403.
3. OTP verify failure is **400**, not 401. An older portal doc says 401 — this spec wins.
4. `POST /api/setu/family/join` does not exist. Lookup → sign-in is the join path.
5. Magic links in OTP emails are **web-only** (they 303 to the portal with a cookie). Mobile users type the 6-digit code.
6. Donation completion is client-trusted (no Stripe webhook). The status endpoint (§6.2, now shipped) is how you record the outcome — **call it** after the Stripe return, or a charged payment stays "redirected" to staff.
7. Teacher APIs 404 wholesale when the deployment's teacher flag is off; same for auth/donations flags.
8. Seva sign-up returns 200 (not 409) when already signed up — idempotent success.
9. Prasad confirm/move re-validate capacity transactionally — design every confirm path to absorb a 409 and refresh options.
10. `GET /api/setu/calendar` requires `location` — there is no "all locations" call.

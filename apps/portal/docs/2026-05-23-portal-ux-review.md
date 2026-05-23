# Portal UX Review — 2026-05-23

**Reviewer:** designer (UX/UI review agent)
**Scope:** All shipped screens — public flow, family-auth flow, welcome-team flow, shared chrome
**Persona:** Brand-new Bala Vihar family encountering the portal for the first time
**Method:** Static code review of all page files, atoms, and interaction logic

---

## Verdict Summary

| Severity | Count |
|----------|-------|
| Blocker  | 3     |
| High     | 6     |
| Medium   | 7     |
| Low/Nit  | 8     |
| Praise   | 6     |

**Top 3 for user testing readiness:**
1. B1 — Sign-in code-sent state has no OTP entry field (SignInPrototype) and the "New to Setu" promise has no path in SignInReal when family is not found
2. B2 — "Invited by someone? Use your link" button on the landing page is a dead `<button>` — does nothing
3. B3 — "Remove from family" on `/family/members/[mid]` (view page) is a visually prominent button wired to no handler

---

## Blockers

### B1. Sign-in "code sent" state in SignInPrototype has no OTP field, and SignInReal has no path for unknown email

**Files:**
- `apps/portal/src/app/sign-in/page.tsx:50-64` (SignInPrototype sent state)
- `apps/portal/src/app/sign-in/page.tsx:285-316` (SignInReal code state — the real flow)
- `apps/portal/src/app/sign-in/page.tsx:285-288` (New to Setu callout)

**What's wrong (two separate sub-issues):**

Sub-issue A (SignInPrototype, flag-off): The "sent" state shows "Check your inbox" with "Re-send code" and "Use a different address" but offers NO OTP input field anywhere. A user would have no way to actually enter their code. The real flow (SignInReal) does include OTP entry via `<OtpEntry>`, but if the feature flag is still off for any environment, the prototype is broken at step 2.

Sub-issue B (SignInReal — the live flow): The "New to Setu?" callout at line 285 says: _"if we don't find an account we'll walk you through registering your family."_ However, when `send-code` is called for an unknown email/phone, the API returns 200 (the send-code route intentionally does not reveal whether an account exists, for privacy). The user moves to the OTP entry screen. If they enter the code and it fails because there is no session to create (or they're redirected to `/family` which 404s), the user has no path to registration. There is no "Sign up here" or "Register instead" CTA at any point in the real flow.

**Impact:** The most critical new-user entry point is a dead end for unregistered users. The promise ("we'll walk you through registering") is broken.

**Suggested fix:**

For SignInReal: After `verify-code` succeeds and `redirectTo` is `/register` (the server can detect no family exists and redirect there), the user should land at `/register`. Alternatively, add a "Don't have an account? Register here" link below the "New to Setu?" callout that goes directly to `/register`.

```
New to Setu? ─────────────────────────────────────
If we don't find an account we'll walk you
through registering.

[ Register your family → ]  ← add this CTA
───────────────────────────────────────────────────
```

---

### B2. "Invited by someone? Use your link" button on landing page does nothing

**File:** `apps/portal/src/app/page.tsx:53`

```tsx
<button className="btn btn--g" style={{ fontSize: 14 }}>Invited by someone? Use your link</button>
```

This is a `<button>` element (not a `<Link>`) with no `onClick` handler. On the desktop layout, a brand-new user who received an invite link and is trying to use it would naturally click this. It does nothing — no navigation, no modal, no explanation. The mobile layout does not show this button at all (the mobile layout only has "Sign in or register →").

**Impact:** Any invitee who lands on `/` before going to their invite link and sees this button will click it and receive no feedback. This is a silent dead-end at the very top of the funnel.

**Suggested fix:** Either remove the button (invitees should use their link directly), or convert it to an `<input>` that accepts a pasted invite URL and navigates, or link it to `/sign-in` with a note about invite links.

---

### B3. "Remove from family" on member detail page (`/family/members/[mid]`) is a dead button in the flag-off prototype

**File:** `apps/portal/src/app/family/members/[mid]/page.tsx:199` (prototype path, lines 199 and 249)

```tsx
<button className="focus-ring" style={{ ... border: '1px solid var(--err)' ... }}>
  Remove from family
</button>
```

In the flag-off prototype path (both mobile and desktop), "Remove from family" is a visually prominent destructive button with no `onClick` handler and no `disabled` state. In the real (flag-on) path (lines 82-85 and 141-144), the button is also wired to no handler — there is no `onClick`, no `handleRemove` function in the view page. The actual remove logic only exists on the **edit** page (`/family/members/[mid]/edit/page.tsx:157-178`).

This means a manager on the member detail view sees a red "Remove from family" button that does nothing when clicked. This is worse than not showing it — it implies the action is possible and then silently fails.

**Impact:** Destructive UI affordance with no behavior. Confusing and potentially trust-damaging.

**Suggested fix:** Either remove the button from the view page entirely (the edit page is the right location for it), or add `onClick={() => router.push(`/family/members/${mid}/edit`)}` with copy "Remove this member" on the edit page.

---

## High Severity

### H1. Charity registration number is a placeholder — visible in production footer

**Files:**
- `apps/portal/src/app/page.tsx:59`
- `apps/portal/src/app/family/enroll/page.tsx:163`

```tsx
<span>Charity reg. CA-XXX-XXXX</span>
```

Both the landing page footer and the enrollment page show `CA-XXX-XXXX` as the charity registration number. This is a visible placeholder that undermines trust for any family that notices it. It appears in the desktop landing page footer (line 59) and in the donation sidebar on the enrollment page (line 163).

**Suggested fix:** Replace with the real charity registration number or remove the field entirely until confirmed.

---

### H2. Dashboard displays fully hardcoded data — attendance, class schedule, donation — regardless of actual enrollment state

**File:** `apps/portal/src/app/family/page.tsx:57-109` (mobile) and `162-210` (desktop)

The family dashboard shows:
- "Bala Vihar · Enrolled" pill — hardcoded
- "Next: Sun 10:00", "Attendance: 92%", "Kids: 2" — hardcoded stats
- Upcoming classes hardcoded as June 14, 21, 28
- "Donation pending: $500.00" — hardcoded with a $0/$500 progress bar
- The attendance heatmap (desktop) — hardcoded 16-week array with fixed present/absent/future states

All of this renders for any authenticated family, including those not yet enrolled and those who have zero donation history. A brand-new family would see an incorrect "$500 donation pending" and fake attendance data the moment they arrive post-registration.

**Impact:** Major trust issue. A family that has never donated and has never had a child in class will see stale mock data that makes no sense for their situation.

**Suggested fix:** Gate the BV card and donation card behind real data. Show placeholder states ("Not yet enrolled — [Enroll now →]") when data is absent. The attendance heatmap should be data-driven or hidden.

---

### H3. `/family/enroll`, `/family/donate`, and `/family/donations` appear fully functional but perform no real actions

**Files:**
- `apps/portal/src/app/family/enroll/page.tsx` — static, uses `mockEnrollment`
- `apps/portal/src/app/family/donate/page.tsx` — "Give $500 →" button has no handler
- `apps/portal/src/app/family/donations/page.tsx` — receipt download buttons have no handlers; data is fully hardcoded

The enrollment page says "Enroll & continue to donation →" and links to `/family/donate`. The donate page shows a "Give $500 →" `<button>` with no `onClick`. The donations page shows download receipt buttons with no handlers. None of these pages have a "coming soon" notice — they look production-ready.

**Impact:** A family who follows the natural flow (dashboard → enroll → donate) will click "Give $500 →" and nothing will happen. Stripe is mentioned in copy; the family may believe they've been charged.

**Suggested fix:** Add a clearly visible "Coming soon" banner to all three pages, or disable/hide the final-action button with a tooltip. At minimum, the donate button needs a `disabled` state with an explanation.

```
┌──────────────────────────────────────────────┐
│  Online payment coming soon.                  │
│  In the meantime, bring a cheque on Sunday.  │
└──────────────────────────────────────────────┘
```

---

### H4. "That's not me — contact admin" on `/register` goes nowhere

**File:** `apps/portal/src/app/register/page.tsx:295` (RegisterReal, match state)

```tsx
<button className="btn btn--g btn--block" style={{ fontSize: 13 }}>That's not me — contact admin</button>
```

When a family match is found during registration, the user sees the matched family and two options: "Join the [family] family →" or "That's not me — contact admin." The second button has no `onClick` handler and no `href`. There is also no contact information, email address, or next step provided.

**Impact:** If a false match occurs (e.g., shared email, data entry error), the user has no escape path. They either join a family that isn't theirs or they're stuck.

**Suggested fix:** Wire the button to `mailto:info@chinmayatoronto.org` or a contact form URL, or open a simple modal with the admin contact details.

---

### H5. DesktopSidebar always shows "Aarti Patel / Patel · FID 4421" regardless of logged-in user

**File:** `apps/portal/src/features/family/components/atoms.tsx:280-286`

```tsx
<SetuAvatar name="Aarti Patel" size={32}/>
<div style={{ fontSize: 13, fontWeight: 600 }}>Aarti Patel</div>
<div style={{ fontSize: 11, color: 'var(--muted)' }}>Patel · FID 4421</div>
```

The sidebar user identity widget is fully hardcoded with "Aarti Patel" and "FID 4421". This appears on every authenticated desktop screen: `/family`, `/family/members`, `/family/members/new`, `/family/members/[mid]`, `/family/members/[mid]/edit`, `/family/enroll`, `/family/donate`, `/family/donations`.

**Impact:** Every authenticated family on desktop sees another family's name and ID in the sidebar. This is a major trust and privacy signal failure — users will immediately notice their name is wrong.

**Suggested fix:** The sidebar receives no props for user identity currently. It needs a real-data source. Since the sidebar is a client component rendered inside server-component pages, either pass manager name+fid as props from the server page, or create a minimal client-side hook that reads from session/local state.

---

### H6. `/family/members/new` desktop breadcrumb says "The Family" (generic) instead of the actual family name

**File:** `apps/portal/src/app/family/members/new/page.tsx:211`

```tsx
<p style={{ fontSize: 11, ... }}>The Family</p>
```

The desktop header for the "Add member" page shows "The Family" as the family name label — a generic placeholder rather than the actual family name. The page is a client component (`'use client'`) that doesn't have access to the family name without a fetch. This appears above the h1 "Add member".

**Suggested fix:** Either fetch and display the actual family name (it's available from the same `GET /api/setu/family` the edit page uses), or omit the label entirely.

---

## Medium Severity

### M1. Mobile landing page has no "Invited?" affordance — invitees have no entry point

**File:** `apps/portal/src/app/page.tsx:24-28`

The mobile layout has only one CTA: "Sign in or register →". The desktop layout has (a broken) "Invited by someone? Use your link" button. Mobile users who were invited have no affordance at all — they are expected to navigate directly to their invite URL, but if they land on `/` first, there's no guidance.

**Suggested fix:** Under the "Sign in or register →" button on mobile, add a small secondary text link: "Have an invite link? Open it from your email."

---

### M2. Registration step 2 (`/register/family`) shows "Add another member" but the first member isn't required

**File:** `apps/portal/src/app/register/family/page.tsx:354-360`

The label reads "Family members" and the empty state shows only an "Add another member" button (implying there's already at least one). But there are no pre-added members when the form opens — the `additionalMembers` array starts empty. The copy "Add another member" implies a first member already exists; the correct label would be "Add a family member" for the zero state.

**Suggested fix:** Change button copy to "Add a family member" when `additionalMembers.length === 0`, and "Add another member" otherwise.

---

### M3. No confirmation or success state after "Create family & continue →" succeeds

**File:** `apps/portal/src/app/register/family/page.tsx:237-243`

After `POST /api/setu/register` succeeds, the page does `window.location.href = body.redirectTo ?? '/family'`. The redirect is instant with no interim feedback. On slow connections the user may click twice or see a blank flash. There is no toast, loading state text change, or progress indicator during the transition.

**Suggested fix:** Change button copy to "Creating…" while `submitting` is true (this is already done for the disabled state) — actually this IS done at line 466. The issue is subtler: the button re-enables immediately if the redirect is slow. Consider leaving it disabled until navigation completes.

---

### M4. `/invite/[token]` has no "Sign in first" path when the invitee is not yet authenticated

**File:** `apps/portal/src/app/invite/[token]/page.tsx:99-121`
**File:** `apps/portal/src/app/invite/[token]/invite-accept-client.tsx:31-41`

The invite page happily renders the "Accept & join →" button without checking if the user is logged in server-side. When the unauthenticated user clicks "Accept & join →", `acceptInviteClient()` will return `{ ok: false, error: 'no-session' }` and show a toast: "Please sign in first using the email this invite was sent to." This is handled via the error map.

However, the toast is the only feedback — the page does not redirect to sign-in, does not show a prominent sign-in CTA, and does not preserve the invite token for post-auth return. The user must manually remember to go to `/sign-in`, sign in, then come back to the same invite URL.

**Suggested fix:** When the page loads and the server can detect no session (middleware/cookie), replace the "Accept & join" button with a "Sign in to accept this invite →" link that preserves the `?returnTo=/invite/[token]` parameter. Alternatively, show the accept button but on `no-session` error, redirect to `/sign-in?returnTo=/invite/[token]` rather than showing a toast.

---

### M5. Mobile bottom nav "Me" tab is a dead button

**File:** `apps/portal/src/app/family/page.tsx:139-142`

```tsx
<button style={{ ... }}>
  <SetuIcon.user/> Me
</button>
```

The mobile bottom nav has four tabs: Home, Family, Giving, Me. "Me" is a `<button>` with no `onClick` — it goes nowhere. The three other tabs are `<Link>` elements. A user tapping "Me" expecting account settings or profile will get no response.

**Suggested fix:** Either link to a `/family/profile` page (even if placeholder), or remove the "Me" tab until it's implemented.

---

### M6. Welcome-team sidebar "Pending" and "Donation periods" items are disabled but always visible

**File:** `apps/portal/src/features/family/components/atoms.tsx:241-244`

```tsx
const WELCOME_NAV_ITEMS = [
  ['home', 'Search', 'search', '/welcome'],
  ['family', 'Pending', 'people', '/welcome', true],       // disabled
  ['bv', 'Donation periods', 'calendar', '/welcome', true], // disabled
];
```

Both non-search items render with `opacity: 0.5` and a "Soon" label. This is acceptable for internal tooling, but the welcome team is a real operational role that will use this during check-in. Two out of three nav items being non-functional could be confusing. The "Pending" item in particular implies there are pending approvals waiting — a welcome-team sevak might wonder if they're missing something.

**Suggested fix:** Remove disabled items from the welcome-team nav entirely until they're implemented, or rename "Pending" to "Pending check-ins (coming soon)" to reduce ambiguity.

---

### M7. No `error.tsx` visible in the task scope — error recovery paths unknown

The task description notes "Per-segment React error boundaries" as discipline 3. The review files include no `error.tsx` for public routes (`/sign-in/error.tsx`, `/register/error.tsx`, `/invite/error.tsx`). The slice-2d review confirms `/invite/error.tsx` exists. But the family flow pages (`/family/`, `/family/members/`, etc.) were not confirmed to have their own `error.tsx` boundaries during this review.

**Suggested fix (for implementation team):** Audit that every route segment under `/family/` has an `error.tsx`. The user should never see an unhandled Next.js error page when Firestore is slow or returns an unexpected shape.

---

## Low / Nit

### L1. Landing page "About", "Events ↗", "Contact" nav links are dead anchors (`href="#"`)

**File:** `apps/portal/src/app/page.tsx:38-41`

```tsx
<a href="#" style={{ color: 'inherit' }}>About</a>
<a href="#" style={{ color: 'inherit' }}>Events ↗</a>
<a href="#" style={{ color: 'inherit' }}>Contact</a>
```

All three top-nav links on desktop landing go to `#`. Events should link to `https://events.chinmayatoronto.org/` (or `https://chinmayatoronto.org/events/`), Contact to an email or page, About to a page or anchor.

**Suggested fix:** Remove the nav entirely until real links exist, or replace with only the working ones.

---

### L2. Mobile sign-in back button (prototype) missing "Back" text label — icon-only

**File:** `apps/portal/src/app/sign-in/page.tsx:26-28` (prototype mobile)

The mobile back button is `<SetuIcon.back/>` with no visible label and no `aria-label`. In the real flow (SignInReal, line 241-244), the same pattern is used. The desktop version (line 75) shows `← Back` text. Icon-only navigation without aria-label fails accessibility.

**Suggested fix:** Add `aria-label="Back to home"` to all icon-only back link/buttons.

---

### L3. `/register/family` registration does not tell user their email/phone will be their sign-in contact

**File:** `apps/portal/src/app/register/family/page.tsx:347-351`

The manager card shows `{email} · {phone}` but no copy explains that these are what the user will sign in with in future. A user who gave a spouse's email might be confused about how to log in next time.

**Suggested fix:** Add hint text: "You'll sign in with this email or phone number."

---

### L4. Family dashboard desktop "Search" button in header has no route

**File:** `apps/portal/src/app/family/page.tsx:157`

```tsx
<button className="btn btn--s"><SetuIcon.search/> Search</button>
```

The search button in the desktop family dashboard header has no `onClick`. This may be intended for a future global search feature, but as rendered it is a dead affordance.

**Suggested fix:** Remove until implemented, or add a `disabled` state.

---

### L5. Donation page tax receipt says "emailed to aarti@…" — hardcoded mock email

**File:** `apps/portal/src/app/family/donate/page.tsx:95`

```tsx
<div>... Tax receipt will be emailed to aarti@…</div>
```

The order summary hardcodes "aarti@…" as the receipt destination. This is never populated with real session data.

**Suggested fix:** Replace with the actual user's email from session context, or use "your registered email address."

---

### L6. `/family/members/[mid]/edit` mobile "X" close button vs desktop "← Back to member" inconsistency

**File:** `apps/portal/src/app/family/members/[mid]/edit/page.tsx:341-343` (mobile) vs `365-367` (desktop)

Mobile uses `SetuIcon.x` (close/cancel), desktop uses `SetuIcon.back` (back arrow). Both link to the same destination. Using X on mobile implies a modal/sheet dismiss (no state change) while Back implies navigation. Since the form may have unsaved state, the semantics matter.

**Suggested fix:** Use `SetuIcon.back` on both, or add an unsaved-changes confirmation on X if edits have been made.

---

### L7. `AddedMemberRow` in atoms has an edit icon button with no handler

**File:** `apps/portal/src/features/family/components/atoms.tsx:189-193`

```tsx
<button className="focus-ring" style={{ ... color: 'var(--muted)' ... }}>
  <SetuIcon.edit/>
</button>
```

The `AddedMemberRow` edit button has no `onClick`. This component is used in `RegisterFamilyPrototype` (the flag-off version) where "Aarti Patel" and "Diya Patel" appear with edit icons that do nothing. In `RegisterFamilyReal`, the component is used in the added-members list but the edit handler is missing — only `Remove` is wired.

**Suggested fix:** Either wire an `onEdit` prop or remove the edit icon from `AddedMemberRow`.

---

### L8. `register/family` prototype has hardcoded "Raj Patel" and "Aarti Patel" members

**File:** `apps/portal/src/app/register/family/page.tsx:57-59, 73-74`

```tsx
<div style={{ fontWeight: 600, fontSize: 14 }}>Raj Patel</div>
<div style={{ fontSize: 11, color: 'var(--muted)' }}>raj.patel@gmail.com · (416) 555-2204</div>
// ...
<AddedMemberRow name="Aarti Patel" type="Adult · spouse"/>
<AddedMemberRow name="Diya Patel" type="Child · Gr 3"/>
```

The prototype (flag-off) path shows hardcoded Patel family data. If the flag is ever off in staging or demo, this renders directly. Low risk given the flag is on in production, but worth cleaning up.

---

## Praise

### P1. OTP entry UI (SignInReal code state) is well-executed

The real sign-in code entry uses `<OtpEntry>` with proper disabled state during verification, auto-disable of "Verify code →" when `otp.length < 6`, clear "Verifying…" loading state, and re-enable on error. The button hierarchy (primary Verify → secondary Re-send → ghost Different address) is correct. This is the best-executed interactive flow in the portal.

---

### P2. Family registration debounced lookup is a good pattern

The `RegisterReal` component debounces the family-lookup API call (400ms) and fires on blur for good measure. The match/nomatch/loading/idle states are clearly delineated in the UI. The "Checking for existing families…" inline feedback during loading avoids an abrupt UI change. This pattern is worth carrying forward to other auto-lookup flows.

---

### P3. AllergyCallout is visually distinct and appropriately alarming

The allergy callout component (`apps/portal/src/features/family/components/atoms.tsx:205-221`) uses a double-weight red border, a red filled icon, and uppercase "FOOD ALLERGIES" heading. It appears on both the member detail and roster pages. This is the right level of visual prominence for a safety-relevant field. Do not soften it.

---

### P4. Welcome-team family detail is read-only and appropriately scoped

`/welcome/family/[fid]` has defense-in-depth role checking (middleware + server component re-verify), renders clean family data with allergy callouts prominently visible on member rows, and provides no edit affordances. The sevak view correctly shows only what a welcome-team member needs (name, contact, allergies, manager status) with no destructive actions exposed. This is the right design for a kiosk-adjacent role.

---

### P5. DesktopSidebar "Soon" disabled nav items are visually clear

`opacity: 0.5` + "Soon" label on disabled welcome-team nav items communicates placeholder status without removing the items from context. The pattern is consistent. (The content of those items is flagged in M6, but the visual treatment of the disabled state is correct.)

---

### P6. Invite error states (expired / accepted / not-found) are handled gracefully

`/invite/[token]/page.tsx:41-94` maps all three error states to distinct headlines and body copy, each with a "Sign in →" CTA. "Already accepted" correctly tells the user someone else joined. "Expired" correctly directs them back to the family manager. The right pane decorative area remains present even in error states, maintaining visual brand consistency. This is a well-handled failure surface.

---

## Cross-flow story assessment

**a → b (landing → sign-in or register):** Functional on mobile. Desktop has dead nav links and a dead "Invited?" button. The primary CTA works.

**b → c (enter email → OTP or registration):** The real sign-in flow works for known users. Unknown users get an OTP code, enter it, and then what? The server must redirect to `/register` on `verify-code` for unknown contacts — this is the gap documented in B1.

**c → d (OTP → /family):** Works for known families. The redirect from `verify-code` goes to `redirectTo ?? '/family'`.

**d → e (add member → return to dashboard):** The add-member page (`/family/members/new`) is functionally wired to `POST /api/setu/members` and redirects to `/family/members` on success. The dashboard does NOT update the member count in real-time (it's a server component that would need a full page reload), but that's acceptable.

**e → f (invite co-manager → invitee accepts):** The invite send is correctly gated to managers only. The invite email sends. The accept page renders correctly. The `no-session` error message is user-friendly. The gap is that there's no post-accept redirect back to the invite page with session preserved (M4).

**g (enroll, donate — placeholders):** These pages are dead UI. A family who tries to enroll or donate will click a button and nothing happens. This must be explicitly communicated (H3).

---

## Files reviewed

| File | Screen |
|------|--------|
| `apps/portal/src/app/page.tsx` | `/` landing |
| `apps/portal/src/app/sign-in/page.tsx` | `/sign-in` (both variants) |
| `apps/portal/src/app/register/page.tsx` | `/register` (both variants) |
| `apps/portal/src/app/register/family/page.tsx` | `/register/family` (both variants) |
| `apps/portal/src/app/invite/[token]/page.tsx` | `/invite/[token]` |
| `apps/portal/src/app/invite/[token]/invite-accept-client.tsx` | Invite accept client |
| `apps/portal/src/app/family/page.tsx` | `/family` dashboard |
| `apps/portal/src/app/family/members/page.tsx` | `/family/members` |
| `apps/portal/src/app/family/members/invite-button.tsx` | Invite button/modal trigger |
| `apps/portal/src/app/family/members/new/page.tsx` | `/family/members/new` |
| `apps/portal/src/app/family/members/[mid]/page.tsx` | `/family/members/[mid]` |
| `apps/portal/src/app/family/members/[mid]/edit/page.tsx` | `/family/members/[mid]/edit` |
| `apps/portal/src/app/family/enroll/page.tsx` | `/family/enroll` |
| `apps/portal/src/app/family/donate/page.tsx` | `/family/donate` |
| `apps/portal/src/app/family/donations/page.tsx` | `/family/donations` |
| `apps/portal/src/app/welcome/page.tsx` | `/welcome` |
| `apps/portal/src/app/welcome/family/[fid]/page.tsx` | `/welcome/family/[fid]` |
| `apps/portal/src/features/family/components/atoms.tsx` | Shared chrome / atoms |

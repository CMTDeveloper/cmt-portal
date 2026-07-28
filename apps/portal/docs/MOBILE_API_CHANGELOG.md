# Mobile API contract changelog

The Chinmaya Setu **mobile app** (`chinmaya-setu-mobile`) mirrors this portal's
`/api/setu/*` request/response shapes **by hand** in `src/api/schemas/*.ts`
(+ the fetch calls in `src/api/*.ts`). It does **not** import `@cmt/shared-domain`.
So whenever a `/api/setu/**` route — or a `@cmt/shared-domain` schema it depends
on — changes its response/request shape, error codes, or required fields, the
mobile mirror must be updated to match or it silently drifts.

**This file is the contract handshake between the two repos.** The portal session
appends an entry here on every contract-affecting change; the mobile session's
`contract-sync` cron reads new entries (keyed by the portal commit SHA), updates
`src/api/schemas/*` + `src/api/*.ts`, runs its gate, and commits.

**Format:** newest first. Each entry cites the **portal commit SHA** so the mobile
cron can match it against `git log <watermark>..origin/main`. Keep entries small
and action-oriented: *what changed* + *what the mobile must do*.

**Mobile baseline:** the app was last built against portal commit **`e230061`**
(mobile API prerequisites — Bearer auth + the dashboard/donations endpoints).
Everything below is the backlog of contract changes since then.

---

## 2026-07-27 - `d4fda47`..`34cb977` - NEW family-facing money routes: `/api/pledges/*` (**additive - nothing existing changed**)

The monthly-pledge feature. **No existing route, schema, error code or field changed** - an unmodified mobile client is unaffected. This entry exists because the routes are family-facing, so the mobile will want to mirror them eventually.

### ⚠️ Read this before mirroring anything

**The feature SHIPS DARK and stays dark at launch.** `NEXT_PUBLIC_FEATURE_SETU_PLEDGE` is unset in production, and while it is unset **every route below returns 404**, not 401 and not an empty result. A mobile client cannot distinguish "feature off" from "route does not exist" - that is deliberate. **Do not ship a pledge UI that a family can reach**: the payment service's `/pad/*` is in Stripe **TEST** mode, and the first family through after the flag flips signs the **first REAL pre-authorized debit**.

**These routes are NOT under `/api/setu/`.** That prefix's `canAccessRoute` catch-all grants welcome-team and admin by default, and a route that creates a recurring financial commitment must never inherit authorization by accident. `/api/pledges/*` is **family-manager ONLY** - welcome-team, coordinator **and admin are all denied**.

### `POST /api/pledges/start`
Request body: **none** (send `{}`). There is deliberately no amount in the request - the amount lives in server env and at Stripe, and a client-supplied figure could only ever disagree with what is actually charged. `fid` comes from the SESSION, never the body.

```ts
// 201
{ pid: string; checkoutUrl: string }   // checkoutUrl is a Stripe-HOSTED page on a third-party origin
// 409 - a pledge is already `started` or `active`; nothing was created
{ error: 'already-started' | 'already-active'; pid: string }
// 404 flag off | 401 no-session / no-family / no-member | 403 manager-required
// 400 no-email | 404 family-not-found | 503 provider-unavailable
```
**The mobile must open `checkoutUrl` in a real browser / web view, not an embedded form.** The bank mandate is authorised entirely on Stripe's page; the portal never sees a bank detail and neither should the app. Treat 409 as "reload and show the state that already exists", not as an error.

### `POST /api/pledges/finalize`
Called after the family returns from the hosted page. Body is **`.strict()`** - an extra key is a **400**, not silently ignored.

```ts
// request
{ pid: string }
// 200
{ state: 'active' | 'processing' | 'failed' }
// 404 flag off | 404 not-found (ALSO returned when the pid is not yours - deliberately
//   indistinguishable) | 401 | 403 manager-required | 400 bad-request | 503 provider-unavailable
```
**`processing` MUST NOT be rendered as success.** It means the mandate has not been confirmed and may still fail days later. Copy for that state must promise nothing - no amount, no date, no thanks. A daily reconciler cron resolves it; the family is emailed on activation. Nothing in the request body can produce `active`.

### The web redirect target
`start` sets Stripe's success URL to `/donate/success?pledge=<pid>`, and that page finalizes server-side. A mobile flow that uses its own return URL must call `POST /api/pledges/finalize` itself, or the pledge sits in `started` until the cron picks it up.

### Reading pledge state
There is **no GET endpoint**. The web reads Firestore server-side. If the mobile needs to display pledge state, that endpoint has to be added first - do not invent one from these shapes.

### Fields the mobile must never expect
`setupSessionId`, `subscriptionId`, `customerId`, `lastError` are provider handles and are **never** returned by any route. `monthlyAmountCAD` is **snapshotted per pledge**: an existing pledge always displays its own amount, never today's price, or a price change would silently rewrite what a family was told they signed up for.

---

## 2026-07-26 - `2db63e6` - GET /api/setu/teacher/levels/[levelId]/roster rows gain contact, payment and allergy text (**additive - no mobile action required to keep working**)

The route returns `{ view }` verbatim, so widening `AttendanceViewRow` is a response-shape change. **Five new fields on every element of `view.rows`.** Nothing was removed or renamed, no field changed type, and no error code changed - an unmodified mobile client keeps working and simply ignores them.

```ts
// view.rows[]  — ADDED
parentName:  string | null   // the family's primary manager, null when none is on file
parentPhone: string | null
parentEmail: string | null
payment: 'paid' | 'outstanding' | 'not-applicable' | 'unknown'
safetyNotes: string | null   // allergy / medical FREE TEXT
```

**What the mobile should do:**
- Add the five fields to its `AttendanceViewRow` mirror. All five are **required** on the portal type - every row always carries them, using `null` / `'unknown'` rather than omitting the key - so mirror them as required-but-nullable, not optional.
- **`payment` has FOUR states and the web row deliberately renders a chip for only TWO of them** (`paid`, `outstanding`). `not-applicable` means no fee applies and `unknown` means we could not determine one; both render as **no chip at all**. Do NOT collapse them into a boolean or into "unpaid" - that would tell a teacher a family owes money when we either know they owe nothing or cannot tell.
- `payment` is scoped to **this class's** enrollment, while the amount paid is family-wide. For a family enrolled in a second program this can differ from the whole-family verdict on the welcome roster. Do not present it as the family's overall balance.
- `hasSafetyInfo` (existing boolean) and `safetyNotes` (new text) are kept consistent by the server: whitespace-only text yields `hasSafetyInfo: false` **and** `safetyNotes: null`, so a lit dot always has text behind it.

**⚠️ PRIVACY DELTA, stated deliberately.** Until now this route exposed only `hasSafetyInfo: boolean`; it now ships each child's **allergy/medical free-text** to any client that calls it. Spec §4.6 authorised parent contact and payment status for teachers; medical text was not part of that decision, and it was taken separately by CMT Developer on 2026-07-26 (teachers **and** welcome-team, web and mobile). Treat `safetyNotes` as sensitive: do not log it, do not cache it beyond the session, and do not surface it outside a signed-in teacher context.

## 2026-07-26 - `378df10` - POST /api/setu/enrollments behaves differently for `adult-study-class` (**mobile action required**)
Request and response SHAPES are unchanged. What changed is the BEHAVIOUR when the posted `oid` belongs to an **adult-study-class** offering; every other `programKey` is byte-identical to before.
- **The fee is waived for a Bala Vihar family.** If the family has an **active Bala Vihar enrollment** (payment NOT required - membership is the test), the enrollment is written with `suggestedAmountOverride: 0`, and the response's **`suggestedAmount` is now the EFFECTIVE amount (0), not the pinned snapshot**. A family with no Bala Vihar enrollment still pays the full amount.
- **Only non-teaching, non-pending adults are enrolled.** Previously every Adult was auto-enrolled, including teacher-assigned adults and pending invitees. `membershipMode` is now `'manual'`, so a later member edit will NOT re-derive the list.
- **New `422 { error: 'no-selectable-adults' }`** when every adult in the household is teaching (or there are none) - distinct from the existing `400 no-eligible-members`.
- **The waiver applies on CREATE only.** An enrollment that already carries a non-null `suggestedAmountOverride` is never rewritten, so an amount the family has already paid cannot be retroactively zeroed.
  - **Mobile:** if the app enrolls via `POST /api/setu/enrollments` and then starts a checkout from the response's `suggestedAmount`, **it must honour a `0` and NOT open a payment sheet** - the web client's equivalent branch (`amount >= 1`) is what this change exists to satisfy. Add handling for the new `422 no-selectable-adults`. No schema field was added or removed.

## 2026-07-26 - `47663d1` - donation success page moved to top-level `/donate/success` (**mobile action required IF you match on the path**)
The Stripe Checkout `successUrl` the portal generates changed from **`{origin}/family/donate/success?did=...`** to **`{origin}/donate/success?did=...`**. No request or response SHAPE changed - `POST /api/setu/donations/checkout` still returns the same body, and the `did` query param is unchanged.
- **Why:** the page had to leave the `/family` layout. That layout now carries a persistent Adult Study Class gate, which would otherwise redirect a family off their own receipt the moment their Bala Vihar donation read paid.
- **Mobile:** if the app detects "payment finished" by matching the redirect URL against `/family/donate/success` (in a webview navigation delegate, deep-link handler, or `returnUrl` comparison), **update the match to `/donate/success`** - a stale match leaves the user stranded on a page the app does not recognise. If the app instead reads the checkout response or polls the donation status, nothing to do.

## 2026-07-26 - `cdb72b6` - NEW POST /api/setu/adult-class - Adult Study Class selection (SHIPS DARK; no mobile action yet)
- **New `POST /api/setu/adult-class`** — the family names which non-teaching adult(s) attend the Adult Study Class. **Manager-only.** Body is **`{ mids: string[] }`**, `.strict()` (any extra key, including `fid`, is a **400** — `fid` is bound from the session), minimum 1 entry, and **duplicates are rejected** (400), not deduped.
  - Responses: **`201`** on a new enrollment, **`200`** when reconciling an existing one, both `{ eid, enrolledMids, suggestedAmountOverride }`.
  - Errors: **`403 manager-required`** · **`422 mid-not-selectable`** (any submitted mid that is not a currently-selectable adult — all-or-nothing, never a partial enroll) · **`409 no-adult-class-offering`** (no open offering, or nobody in the household is selectable) · **`422 offering-disabled|offering-expired|program-not-available`** · **`400 no-eligible-members`** · **`404 family-not-found|offering-not-found`**.
  - **Selectable** = `type === 'Adult'` AND `inviteStatus !== 'pending'` AND not assigned as a teacher. A child, a pending invitee, a teaching parent, or another family's mid all 422.
  - A family whose **Bala Vihar donation is paid** gets the adult-class donation waived (`suggestedAmountOverride: 0`). Paid is **threshold-free** — ANY completed donation tied to the BV `eid` counts, amount irrelevant (issue #23), plus legacy-paid and teacher-managed offerings.
  - **Gated by `NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS`; returns `404 not-found` while OFF.** It is OFF at launch.
  - **Mobile:** nothing to do yet — the flag is off. When it flips, add the endpoint + `{ mids }` request schema, and mirror the web gate: prompt a MANAGER with a paid BV enrollment and no current adult-class enrollment to pick from the selectable adults. `enrolledMids` and `membershipMode: 'manual'` are additive on the enrollment doc; **`suggestedAmountOverride` can now be `0`** (previously only `null` or positive), so treat it with `??`, never truthiness — a `0` means "waived", not "no override".

## 2026-07-26 - `efc9b74` - enrollments: `suggestedAmountOverride` accepts `0`, and `membershipMode` is now declared (**mobile action required**)

Groundwork for the Adult Study Class. Two `@cmt/shared-domain` changes on `EnrollmentDocSchema`, which is what **`GET /api/setu/enrollments`** returns raw.

- **`suggestedAmountOverride` widened from positive-or-null to NON-NEGATIVE-or-null.** `0` is now a real, meaningful value, not "unset": it is how the adult-class exemption is stored for a family that has already paid its Bala Vihar donation. **Mobile action REQUIRED if any code treats this field as truthy** - `override || snapshot` is now WRONG and will bill a family that owes nothing. The correct read is `override ?? snapshot` (null-coalescing), i.e. test `!== null`/`!= null`, never truthiness. This is the one change here that can produce a visibly wrong number.
- **`membershipMode?: 'auto' | 'manual'`** is a new optional field on the enrollment doc. `'manual'` means the family explicitly chose `enrolledMids` and the server will not re-derive them on a member edit; **absent means `'auto'`** (every enrollment that exists today). Read-only from the mobile's perspective - no endpoint accepts it as input. Mirror it as optional and default your interpretation to `'auto'` when missing.
- **`PATCH /api/welcome/enrollments/[eid]/override`** now accepts `0` where it previously returned `400`. That route is **welcome-team-only and has no mobile mirror** - noted so the contract-sync cron does not read the silence as an oversight.
- No response envelope, error code, or required field changed. An older client keeps working **unless** it does the truthiness read above.

## 2026-07-26 - `634d158` - PATCH /api/setu/family accepts `location` (request shape; **mobile action recommended**)

The companion write path to the `locationNeedsConfirmation` entry below. Previously this route's body schema had only `familyEmergencyContact` and `familyAddress`, and Zod strips unknown keys - so sending `location` did nothing.

- **`PATCH /api/setu/family` request body gains an optional `location: string`.** All existing keys are unchanged and still optional; this is purely a relaxation, so an older client is unaffected.
- **The value must be one of the admin-managed centres** returned by `GET /api/setu/locations` (already family-readable). Anything else is a **`400 { error: 'unknown-location' }`** - a NEW error code on this route. Do not hardcode the centre list in the mobile; read it from the locations endpoint, because admins can change it at `/admin/locations`.
- **Sending `location` also clears `locationNeedsConfirmation` (to `false`) server-side.** The client does not send the flag and must not try to.
- **A PATCH that omits `location` leaves both fields untouched**, so an address-only edit never marks an unconfirmed centre as confirmed. Partial-update semantics are unchanged: only keys you send are written.
- **Still manager-only** (`403 not-manager` for a non-manager), unchanged.
- **The staff route `PATCH /api/welcome/families/[fid]` behaves identically** for `location` as of `ad0ab53` (same allow-list check, same flag clear). It is welcome-team-only and has **no mobile mirror** - noted so the contract-sync cron does not read the silence as an oversight.
- **Mobile action:** add optional `location` to the family PATCH request schema and add `unknown-location` to its error union. If the mobile implements the centre-confirmation prompt, send `location` on save; otherwise no change is needed.

## 2026-07-26 - `25b8431` - `family` gains `locationNeedsConfirmation` on GET /api/setu/family + /api/setu/dashboard (additive; **mobile action recommended**)

At the Aug 3 cutover, 299 of 867 legacy families carry no recognisable centre in the legacy roster, so the migration parser defaults them to Brampton. Rather than silently filing them under a centre nobody chose, the family doc now carries a marker saying "this location is a guess, ask them".

- **`FamilyDocSchema` gains `locationNeedsConfirmation: boolean | null | undefined`.** It appears in the `family` object of **`GET /api/setu/family`** and, added in `ad0ab53`, of **`GET /api/setu/dashboard`** (whose `family` object is a deliberately narrower hand-built projection, not the full `FamilyDoc` - it was missing there when this entry was first written). Purely additive - every existing field is unchanged, and an older client that ignores it still works.
- **Only the literal `true` means "ask".** `null`/absent means the family was never flagged; `false` means they were flagged and have since confirmed. Mirror it as optional+nullable and test `=== true`, never truthiness of a missing key.
- **`location` itself is UNCHANGED and always a valid non-empty string.** It is not nulled out while unconfirmed - it holds the defaulted `'Brampton'`. Do not render the flag as "no centre on file"; the correct reading is "centre not yet confirmed by the family".
- **Mobile action (recommended, not blocking):** add the field to the family schema. If the mobile has a profile-completion flow, treat a `true` here the way the web does - divert the **manager** (not other members) to pick a centre, and clear it by sending `location` on the family PATCH (see the separate PATCH entry). If the mobile has no completion flow yet, ignoring the field is safe: the family will be asked the next time they use the web portal.

## 2026-07-25 - `6d1fd0d` - SMS sign-in is REFUSED: new `sms-signin-unsupported` 400 on four `/api/setu/*` routes (**mobile action required**)

SNS is still sandboxed with no Origination Number for Canada, so every OTP SMS the portal "sent" was accepted by AWS and delivered to nobody - leaving families on a code screen forever. Rather than fail silently, every route that accepts `type: 'phone'` now refuses with a typed error while `NEXT_PUBLIC_FEATURE_SMS_OTP` is off (its default). Flipping that flag on restores the old behaviour everywhere at once; nothing was deleted.

- **New error code `sms-signin-unsupported`, HTTP 400**, on:
  - **`POST /api/setu/auth/send-code`** with `{ type: 'phone' }`
  - **`POST /api/setu/auth/verify-code`** with `{ type: 'phone' }`
  - **`POST /api/setu/contacts/send-code`** with `{ type: 'phone' }`
  - **`POST /api/setu/contacts/verify-code`** with `{ type: 'phone' }`
- **Request shapes are UNCHANGED.** `type` still accepts `'email' | 'phone'`; a phone is accepted by the schema and then refused by policy. Nothing about the `email` path changed.
- **The refusal is returned BEFORE the family lookup**, so it is identical for registered and unregistered numbers - it leaks nothing, and it is NOT the anti-enumeration silent 200. Do not treat a 400 here as "number not found".
- **Mobile action REQUIRED:**
  1. Add `sms-signin-unsupported` to the error unions for these four routes and map it to copy along the lines of *"Text-message sign-in is unavailable right now. Please sign in with the email address on your account."* Do not surface the raw code, and do not fall through to a generic "something went wrong".
  2. If the sign-in screen offers an email/phone toggle, either hide the phone option or keep it visible and show that message on submit. The web portal keeps the toggle visible and refuses on submit.
  3. If there is an add-a-phone flow in profile settings, hide it. Storing an unverified phone is worse than losing the capability: `contactKeys` would key sign-in on a number nobody proved they own.
  4. Treat this as reversible - gate the copy on the response, not on a hardcoded build-time assumption, so nothing needs a mobile release when the flag flips.
- Separately and independent of that flag: `lib/aws/sns.ts` now refuses any non-`+1` publish outright (logged, not thrown). This affects no request/response shape, but it means an international number will never receive an SMS from any portal feature, including prasad reminders and join-request notifications, even after SMS sign-in is restored.

## 2026-07-25 - `d278185` - GET /api/setu/teacher/visitors - `?date=` now means "any day in that week" for PORTAL guests (behavioral; shape UNCHANGED)
Bug fix: the portal's self-serve guest check-in stamped the **actual Toronto calendar day**, while every teacher surface defaults its `?date=` to the week's Sunday - so a guest who walked in midweek was **invisible to teachers**. Guest docs are now keyed additionally by `sessionDate` (the Sunday that starts their week) and the reader queries that.
- **`GET /api/setu/teacher/visitors?levelId=&date=`** - request and response **shapes, error codes and required fields are UNCHANGED** (`{ view }`, `VisitorsView` with `doorVisitors: VisitorRow[]` + `confirmed`). Validation is still `/^\d{4}-\d{2}-\d{2}$/`.
- **What changed is which guests come back.** For the **portal** guest source the `date` you pass is now normalized to the Sunday of its week, so: (a) passing a **midweek** date returns that week's guests instead of usually nothing, and (b) passing a **Sunday** now also returns people who walked in **midweek**. The **legacy door** source (`guest-families`) still keys on the exact calendar day and is unchanged. `view.date` still echoes the raw `date` you sent.
- **Mobile action: NONE required.** No schema edit - this is a server-side behavior fix and an existing client keeps working. Worth knowing only if the mobile shows a date picker on a visitors screen: the returned set is now week-scoped for portal guests, so two different midweek dates in the same week return the SAME portal guests. Do not present that as a per-day list.
- Note `guest_check_ins` documents gained a `sessionDate` field. It is internal to the guest store; the only endpoint that echoes whole guest docs is **`GET /api/check-in/admin/guests`**, which is web/kiosk-only and has no mobile mirror (see the 2026-07-20 entry). No `@cmt/shared-domain` schema changed; the new `sessionDateFor()` export is a pure helper with no wire representation.

## 2026-07-24 - POST /api/setu/register - `familyName` is now OPTIONAL (server derives it from the manager's last name)
Per family feedback, the registration form no longer asks for a separate "Family name"; the family display name is derived server-side from the primary manager's last name.
- **`POST /api/setu/register`** request body: **`familyName` changed from REQUIRED to OPTIONAL.** When omitted (or blank), the server sets the family display name to **`manager.lastName`**. When a non-empty `familyName` IS sent, that explicit value is kept unchanged. No response-shape or error-code change; every other field is unchanged.
- **Mobile action:** if the mobile registration form collects a family name, it may drop that field and send no `familyName` (the server will derive it) - or keep sending one; both work. Make `familyName` optional in the register request schema so validation doesn't require it. Purely a relaxation - an older client that still sends `familyName` is unaffected.

## 2026-07-20 - kiosk staff login slice - NEW web-only POST /api/setu/auth/kiosk-sign-in; password-sign-in shape UNCHANGED - NO mobile action
The door-tablet kiosk got a friendly staff login. This is a **web/kiosk-only** surface; the family mobile app does not (and must not) call it. Recorded here explicitly so the contract-sync cron does not read the silence as an oversight.
- **NEW `POST /api/setu/auth/kiosk-sign-in`** (web-only) - shared-credential staff login for the door kiosk. Body `{ username, password }` (the friendly `sevak` username maps server-side to the kiosk account email); `200 { redirectTo }` + sets the `__session` cookie on success; `401 invalid-credentials`, `429 too-many-requests` (+ optional `resetAt`), `400 bad-request`, `403 forbidden`, `500 server-misconfigured`, `404 not-found` (auth flag off). **Mobile action: NONE** - the mobile app never signs into the kiosk; do not mirror this route.
- **`POST /api/setu/auth/password-sign-in`** (the family sign-in the mobile DOES use) - request + response shape, error codes, and cookie are **byte-for-byte UNCHANGED**. It was only refactored internally to share the new `mintPasswordSession` helper with kiosk-sign-in. **Mobile action: NONE.**
- The middleware-gated **`/api/check-in/*`** legacy + setu kiosk routes are likewise **web/kiosk-only** (consumed by the door tablet, not the mobile family app). No mobile mirror.

## 2026-07-19 - `6bfbc95` - GET /api/setu/disclaimers gains `intro` + `acknowledgement`; content is now a single-acknowledgement flow
The disclaimers/acknowledgements content model gained two fields, and the family-facing UX changed from a per-section checkbox to one "I Acknowledge" at the bottom (matching the printed CMT Bala Vihar Acknowledgements).
- **`GET /api/setu/disclaimers`** response gains two string fields: **`intro`** (preamble shown above the sections; may contain a URL to auto-link, e.g. the pledge link) and **`acknowledgement`** (the binding statement shown above the acknowledge action). Both are **always present** now (server defaults them to `''`); an empty string means "hide that block". `version`, `schoolYear`, `sections`, and `accepted` are **unchanged**. Section `body` strings are newline-separated bullets (each line starts with `• `).
- **Acceptance UX (behavioral, no endpoint change):** `POST /api/setu/disclaimers/accept` is **unchanged** (no body, records `{version, schoolYear}`). The intended UI is now: render `intro`, the read-only value sections, then `acknowledgement`, and gate a single confirm on ONE checkbox — not a checkbox per section.
- **`@cmt/shared-domain` `DisclaimersConfig`** mirror: add `intro?: string` and `acknowledgement?: string` (default `''`).
- **Mobile action:** add `intro` + `acknowledgement` to the disclaimers-state schema; render them (linkify URLs in `intro`, render `sections[].body` bullets by splitting on `\n`); if the mobile has its own acknowledgement screen, switch it to a single acknowledge action. Purely additive to the response shape — an older client that ignores the two new fields still works.

## 2026-07-17 - NEW GET/POST /api/setu/teacher/grade-eligible - registered-but-unenrolled children for a class
NEW teacher-only route backing the attendance screen's "Registered · not enrolled" group.
- **`GET /api/setu/teacher/grade-eligible?levelId=`** → `{ view: { levelId, levelName, ageLabel, students: [{ mid, fid, firstName, lastName, schoolGrade, familyName }] } }` — registered children at the level's location whose grade/age matches but who have no active enrollment. `403 teacher-required`, `403 not-your-class`, `404 not-found`, `400 bad-request`.
- **`POST /api/setu/teacher/grade-eligible`** body `{ levelId, mid, date: 'YYYY-MM-DD' }` → `{ ok: true, autoEnrolled: boolean }` — marks that child present as a guest, which auto-enrolls them for the period (they then appear on the enrolled roster).
- **Mobile action:** only if the mobile has a teacher/attendance surface — mirror the two shapes. Purely additive; no change to existing teacher endpoints.

## 2026-07-17 - `ccc9490` - invite/send now REQUIRES a name + creates a pending member; NEW invite/cancel; accept links (supersedes `2e3c404`)
The co-manager invite flow changed so the invited person is added to the family **immediately at send** (visible before they accept), per Vaibhav's report that a recipient wasn't added until they logged in and accepted a second time.
- **`POST /api/setu/invite/send`** — `firstName` and `lastName` are now **REQUIRED** (they were optional in `2e3c404`). A 400 is returned without them. Response is unchanged (`201 { token }`). Sending now also **creates the co-manager member** in the same transaction with **`inviteStatus: 'pending'`**, `manager: true`, `uid: null`, and the invited name+email. That member is deliberately NOT in `family.managers` and has no `contactKey` until accept.
- **`MemberDoc` mirror** — add an optional **`inviteStatus?: 'pending' | null`** field (absent/null ⇒ a normal active member). A member returned by **`GET /api/setu/family`** may now carry `inviteStatus: 'pending'`. Treat a pending member as: show an "Invite pending" badge, do NOT show a missing-fields/complete nag (they finish their own profile after accepting), and do NOT count them toward any profile-completion gate. Offer the manager a **Cancel** action for pending members.
- **NEW `POST /api/setu/invite/cancel`** — manager-only. Body **`{ mid: string }`** (the pending member's mid). Deletes the pending member + the invite together. Responses: `200 { ok: true }`; errors `404 invite-not-found`, `409 already-accepted`, `403 manager-required`, `401 no-session`, `400 bad-request`.
- **`POST /api/setu/invite/accept`** — request + response shapes **unchanged**. It now LINKS the pending member created at send (binds uid, clears `inviteStatus`, adds to managers, writes contactKey) instead of creating a new member; legacy invites (no `memberMid`) still create as before. No mobile change required beyond consuming the (now non-empty-named) member.
- **Mobile action:** make `firstName`/`lastName` required in the invite-send form + schema; add `inviteStatus?: 'pending' | null` to the member schema and render the pending state (badge + cancel, no completion nag); add the `invite/cancel` call for managers. The profile-completion gate must skip members with `inviteStatus === 'pending'`.

## 2026-07-16 - `2e3c404` - invite/send gains optional `firstName`/`lastName`; accept names the co-manager from the invite
The **`POST /api/setu/invite/send`** request body gains two **optional** fields: **`firstName?: string`** and **`lastName?: string`** (the name of the person being invited). When present, **`POST /api/setu/invite/accept`** now creates the new co-manager member with that real name instead of an empty `firstName`/`lastName`. Response shapes + error codes for both routes are **unchanged**; the send fields are optional so an older client that omits them still works (the invitee then falls back to setting their own name on the profile-completion screen).
- **Mobile action (only if the mobile mirrors these routes):** add optional `firstName`/`lastName` to the invite-send request schema and collect them in the invite form; no change needed to consume — the member returned by accept is now non-empty-named. If the mobile has its own profile-completion screen, note that `firstName`/`lastName` are now user-fillable when missing (the portal `PATCH /api/setu/members/[mid]` already accepted them; the completion UI just renders the inputs now). No required-field or error-code change.

## 2026-07-14 - `2c96f02` - `publicFid` is now null until a family's first enrollment (lazy minting)
The family `publicFid` (the user-facing 5001+ Family ID) is now **minted lazily at a family's FIRST enrollment**, not at family creation. So in every `/api/setu/*` response that returns it - notably **`GET /api/setu/dashboard`** (`family.publicFid`) and **`GET /api/setu/family`** (`family.publicFid`), plus `GET /api/setu/members/[mid]/profile` and the welcome-team `GET /api/setu/family/search` (`hits[].publicFid`) - `publicFid` is now **`null` for a signed-in family that has not yet enrolled**, and becomes the assigned number after their first enrollment (portal enroll / kiosk check-in / teacher-marked attendance). No request-shape, field-name, or error-code change; this is a behavioral change to WHEN the (already-nullable) field is populated.
- **Mobile action:** treat a `null` `publicFid` as "not yet enrolled" - show an "assigned when you enroll" nudge (or hide the Family ID) rather than a placeholder or the internal `fid`. The field was already typed nullable, so no schema change is required; just handle the null case in the UI. `publicMid` (member ids) is unaffected - still assigned at member creation.

## 2026-07-13 - `ef5ac68` - GET /api/setu/family/search hit gains additive `parentName`
Each `FamilySearchHit` in the `GET /api/setu/family/search` response now carries an
additional **`parentName: string`** field - the family's parents' display name (adult
members, manager first; e.g. `"Vaibhav & Noopur Rana"`, or the stored family name as a
fallback when a family has no adult member). Every existing field (`fid`, `publicFid`,
`legacyFid`, `name`, `location`, `memberCount`) is unchanged; `name` still holds the
stored (legacy) family name.
- **Mobile action: none required.** `/api/setu/family/search` is a **welcome-team-only
  admin endpoint** (not used by the family-facing mobile app). The change is purely
  additive. IF the mobile ever mirrors this endpoint, add an optional `parentName: string`
  to its hit schema. No request-shape or error-code change.

## 2026-07-12 - `6d994a8` - NEW POST /api/setu/teacher/attendance/confirm-previous + teacher roster splits Enrolled vs Previous
The teacher attendance roster is now split. The main **Enrolled students** list shows only enrollments that are engagement-confirmed (the existing issue #23 `isEnrollmentConfirmed` rule: family-initiated / first-attendance enrolledVia, OR attended >=1 class this year, OR a completed donation for the eid, OR legacy-paid). Rollover carry-forwards that have not re-engaged (`enrolledVia:'promotion'`/`'welcome-team'`, no engagement) are moved OFF the main roster into a secondary **Previous students** list. The attendance stats and the unmarked->absent save-sweep now cover ONLY the confirmed roster - a previous student is never auto-marked Absent.
- **NEW `POST /api/setu/teacher/attendance/confirm-previous`** (teacher-gated, under the already-gated `/api/setu/teacher/*` prefix). Body `{ levelId: string, mid: string, date: 'YYYY-MM-DD' }`. Marks ONE previous student present, which confirms that family's already-active enrollment (no new enrollment doc). Success -> `{ ok: true, fid }`. Errors: 403 `teacher-required` (non-teacher), 403 `not-your-class` / 404 `not-found` (level access), 400 `bad-request` (body), 400 `not-a-previous-student` (mid is not an unconfirmed carry-forward on this level), 404 `level-not-found`.
- **`POST /api/setu/teacher/attendance` (save) is unchanged in shape** but a mark for a mid that is NOT on the confirmed roster is now returned in `skipped` (previous students are excluded from the main save). No request/response field changed.
- **Mobile action:** IF/when the mobile app builds a teacher attendance screen, mirror the split - render the confirmed roster as the main list, expose a "Previous students (N)" secondary list, and call `POST .../confirm-previous` to move one present (their whole family + siblings surface in the Enrolled list on the next roster load). If the mobile currently renders the full active-enrollment roster for teachers, it will now under-count "enrolled" for carry-forward families until they re-engage - which matches the family dashboard's Registered-vs-Enrolled badge. No change needed to the family-facing endpoints.

## 2026-07-12 - `2753f40` - POST /api/setu/register `location` is now a dynamic centre string (was a 4-value enum)
- **POST `/api/setu/register`**: `location` changed from a fixed enum (`'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham'`) to **any string that is a member of the admin-managed centre list** (see `GET /api/setu/locations`). Sending a value NOT in that list now returns **400 `{ error: 'invalid-location' }`** (a new error code on this route; a non-string / empty `location` still returns 400 `bad-request`). Every other request/response shape and error code is unchanged.
- **Mobile action:** stop hardcoding the four centres in the registration screen. Fetch the centre list from `GET /api/setu/locations` and send one of its returned `options` as `location`. Handle the new 400 `invalid-location` (e.g. if the picker is stale) by re-fetching the list.

## 2026-07-12 - `2f84cf7` - NEW public GET /api/setu/locations (centre list)
New **public** (pre-auth) read-only endpoint.
- **GET `/api/setu/locations`** -> `200 { options: string[] }` - the admin-managed centre list (e.g. `['Brampton', 'Scarborough']`), defaulting to `['Brampton', 'Scarborough']` until an admin saves a custom list. No auth required (org-wide, non-sensitive config); also readable by any signed-in setu family. No request body.
  - **Mobile:** fetch the centre list from this endpoint in the registration flow (and any location picker) **instead of hardcoding the four centres**. Add a `locations` fetch + a `{ options: string[] }` response type in `src/api/*`; render the returned list. No request-shape change; additive endpoint.

## 2026-07-11 - `7c2a396` - enrolledVia gains 'kiosk'
`EnrollmentDoc.enrolledVia` (schemas/enrollment.ts) now includes `'kiosk'` for door/kiosk-driven auto-enrollments. Mobile: widen the enrolledVia union to accept `'kiosk'` on any enrollment read; no request-shape change.

## 2026-07-10 - `b1561cb` - Family home address (GET/PATCH /api/setu/family, POST /api/setu/register)
New REQUIRED family-level home address.
- **GET `/api/setu/family`** -> `family` gains **`familyAddress: { street: string; unit: string; city: string; province: string; postalCode: string } | null`** (null = not yet on file). `province` is a 2-letter Canadian province code (e.g. `ON`); `postalCode` is a Canadian code (`A1A 1A1`). Additive.
- **PATCH `/api/setu/family`** (manager-only) now ALSO accepts **`familyAddress`** and is a partial update: send either or both of `familyEmergencyContact` and `familyAddress`; keys absent from the body are left untouched. Empty body -> 400; invalid postal code -> 400.
- **POST `/api/setu/register`** now **REQUIRES** a top-level **`familyAddress: { street, unit?, city, province, postalCode }`** (street/city/province non-empty, valid CA postal). Registering without it -> 400 `bad-request`.
- **Mobile action:** add a required home-address section to the registration screen and send `familyAddress` in the register POST; read/display `family.familyAddress` and let managers edit it via `PATCH /api/setu/family`. ALSO: existing families are now redirected to the profile-completion screen until a manager provides the address (see below), so surface an "add your home address" prompt for managers when `family.familyAddress` is null.

## 2026-07-10 - `62588ae` - Emergency contact moved to the family level (GET/PATCH /api/setu/family)
Emergency contact is now a single OPTIONAL **family-level** record instead of per-member.
- **GET `/api/setu/family`** -> `family` gains **`familyEmergencyContact: { relation: string; phone: string; email: string } | null`** (null = none on file). Additive; every other field unchanged.
- **NEW `PATCH /api/setu/family`** (manager-only): body `{ familyEmergencyContact: { relation, phone, email } | null }` (null clears it). `relation` + `phone` are required, `email` optional (defaults `''`). Returns `{ ok: true }`. Errors: non-manager -> 403 `not-manager`, invalid body -> 400 `bad-request`, no session -> 401 `no-session`.
- **Deprecated:** per-member `members[].emergencyContacts` is no longer collected by the add/edit member forms; the tuple slots are now both nullable and default to `[null, null]`. The field stays on the member schema for backward compat, but treat `family.familyEmergencyContact` as the source of truth and stop writing per-member emergency contacts.
- **Mobile action:** read/display `family.familyEmergencyContact`; give managers an editor that PATCHes `/api/setu/family`; remove the per-member emergency-contact fields from the member add/edit screens.

## 2026-07-10 - `1279eb4` - POST /api/setu/enrollments rejects an ineligible (childless) family with 400 `no-eligible-members`
`POST /api/setu/enrollments` now returns **400 `{ error: 'no-eligible-members' }`** when the family has zero members eligible for the program (e.g. an adult-only family enrolling in child-only Bala Vihar). Previously it silently created an enrollment with `enrolledMids: []`. This is a NEW error code on an existing route; the success shapes (201/200 `{ eid, suggestedAmount, donateUrl }`) and every other error code are unchanged. **Mobile action:** handle the new 400 `no-eligible-members` on the enroll call and surface an "add a child to your family before enrolling" message (do not treat it as a generic failure); optionally gate the enroll CTA client-side when the family has no eligible members.

## 2026-07-08 — `02b8eeb` — Member add/edit/delete now reconciles active-enrollment membership
`POST /api/setu/members`, `PATCH /api/setu/members/[mid]`, and `DELETE /api/setu/members/[mid]` now, after the write, reconcile every ACTIVE enrollment's `enrolledMids` to the family's currently-eligible members. A child added AFTER the family enrolled is automatically swept into the active enrollment (previously it was silently omitted from the dashboard/roster — the N=2 bug); a deleted/ineligible member is dropped. **No request/response SHAPE change** — same bodies (`{ mid }` / `{ ok: true }`), same error codes, no new fields. **Mobile action:** after ANY member add/edit/delete, REFETCH enrollments / the dashboard (`GET /api/setu/dashboard` or `GET /api/setu/family`) — a member mutation can now change the family's `enrolledMids` (and thus the enrolled-children list) as a side effect, so a locally-cached enrollment/dashboard is stale until refetched.

## 2026-07-03 — `de017f6` — Attendance is Present/Absent only (Late retired)
`POST /api/setu/teacher/attendance` (`marks`) and `POST /api/setu/teacher/guests` (`status`) now accept only `present` | `absent`. Sending `late` → 400 `bad-request`. Reads are unchanged (historical `late` events still returned). **Mobile:** drop `late` from the attendance marker UI and never send it; render any historical `late` in read views as needed.

## `f960ee5` · 2026-07-03 — Disclaimers (Slice 2)

**New — `GET /api/setu/disclaimers`** → `{ version:number, schoolYear:string, sections:{id,title,body}[], accepted:boolean }`. The signed-in family's disclaimer state. Any family role.

**New — `POST /api/setu/disclaimers/accept`** (no body) → `{ ok:true, version:number }`. Records acceptance of the CURRENT version + school year. **Manager-only** (a family-member gets 401/`unauthorized`). Server-authoritative version.

**Changed — `GET /api/setu/dashboard`** gains additive top-level **`disclaimersPending: boolean`** — true when this (manager) family must accept before using the portal; false for a family-member, when the feature flag is off, or on a read error.

**Mobile action:** on launch, a manager session should check `disclaimersPending` (or `GET /api/setu/disclaimers`); if pending, show the accept screen (render `sections`, one required checkbox each) and `POST …/accept` before proceeding. Acceptance is per-family (manager); a stale version or new `schoolYear` re-prompts. Flag `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS` gates the web gate — until it's on in an environment, `disclaimersPending` is always false there.

## `4195d05` · 2026-07-03 · dashboard gains per-child BV rows, family counts, action-item seam; `bvState` semantics widen (Slice 1)
- **GET `/api/setu/dashboard`** — additive fields (the dashboard now drives a 3-block layout: Family · Action items · Bala Vihar):
  - `family.counts: { children: number; adults: number }` — the family's child/adult split (derived from `members[].type`), for the Family block header.
  - `balaVihar.children: Array<{ mid: string; firstName: string; levelName: string | null; teacherNames: string[]; attendance: { present: number; total: number } }>` — **one row per BV-enrolled child**: their level name (null if unassigned), assigned teacher name(s) (empty array if none/unresolved), and Sunday attendance ratio (present+late over total in-window). Empty array when there's no active BV enrollment. Already plain-serializable — no Date/Map.
  - `actionItems: Array<{ kind: 'donation'; title: string; ctaLabel: string }>` — the forward-compatible action seam. **ALWAYS EMPTY (`[]`) in Slice 1** — the Bala Vihar donation is surfaced via the existing `balaVihar` donation fields (`suggestedAmount`/`givenForPeriod`/`donationComplete`/`donationPct`/`donationHeading`), **NOT** as an action item (owner decision 2026-07-03). Slice 2 will populate it (a disclaimers item). Present now so the mobile schema/UI is forward-compatible; the client builds its own navigation from `kind`.
  - **`balaVihar.bvState` semantics WIDEN** (Slice 1 Part A): `'enrolled'` now ALSO covers a `family-initiated` enrollment (family clicked Enroll, even a $0 intent) and a `first-attendance` enrollment (teacher auto-enrolled on first check-in), in addition to the prior engaged/donated/legacy-paid triggers. **Values are unchanged** (`'enrolled' | 'registered' | 'none'`) — only MORE families now read `'enrolled'`. `'registered'` now occurs only for `promotion`/`welcome-team` carry-forwards with zero engagement. `isEnrolled` is unchanged (still doc-exists).
  - **All additive** — no existing field changed (`upcoming`/`seva`/`prasad`/`otherPrograms`/`members`/`balaVihar.*`/`isEnrolled` all stay). No request-shape change.
  - **Mobile:** add `family.counts`, `balaVihar.children` (with the exact per-child shape above), and `actionItems` to the dashboard schema in `src/api/schemas/*`. Render the 3-block layout (Family · Action items · Bala Vihar); list each `balaVihar.children` row with level + teacher(s) + attendance ratio. **Drive the donation CTA from the existing `balaVihar` donation fields, NOT from `actionItems`** (`actionItems` is empty in Slice 1). Drive the BV pill from `bvState` (green Enrolled / amber Registered / grey Not enrolled) — no code change needed for the widened semantics, but the amber "Registered" state now appears for fewer families.

## `2e87f19` · 2026-07-02 · dashboard `balaVihar` gains three-state `bvState` (issue #23)
- **GET `/api/setu/dashboard`** — `balaVihar` gains an additive **`bvState: 'enrolled' | 'registered' | 'none'`**. `'enrolled'` = the family has ENGAGED this year (attended ≥1 BV class in the enrollment's window OR any completed donation for that enrollment, OR legacy-roster paid for legacy offerings). `'registered'` = an active BV enrollment exists (self-enroll, promotion, or backfill) but no engagement yet. `'none'` = no active BV enrollment. **`isEnrolled` is UNCHANGED** (still "active BV enrollment doc exists") — do not re-derive it from `bvState`.
  - **Mobile:** add `bvState` to the dashboard schema; drive the BV pill from it (green "Enrolled" / amber "Registered" / grey "Not enrolled"). For `'registered'`, show the nudge copy "Attend your first class or complete your donation to confirm enrollment." + a donate CTA. No request-shape change; no other field changed.

## `773f15c` · 2026-06-25 · dashboard / family / member-detail gain public ids (FID 4-digit, MID 5-digit)
- **Family responses** (`GET /api/setu/dashboard` → `family`, `GET /api/setu/family` → `family`) gain an additive **`publicFid: string | null`** (4-digit, e.g. `'1042'`) — the family's canonical user-facing Family ID; `null` until the FID/MID renumber migration assigns one. The existing `fid` (`CMT-…`) is **unchanged** and remains the join key.
- **Member responses** (`GET /api/setu/dashboard` → each `members[]`, `GET /api/setu/members/[mid]/profile` → `profile`) gain an additive **`publicMid: string | null`** (5-digit, e.g. `'50001'`). The existing `mid` (`${fid}-NN`) is **unchanged** and remains the join key / route param.
- **Additive only** — no existing field changed; both raw `fid`/`mid` AND the new `publicFid`/`publicMid` are returned (the route does NOT collapse to a single `displayFid`, so the mobile client mirrors the web's own `publicX ?? legacyX` fallback).
  - **Mobile:** add the optional nullable `publicFid` to the family schema and `publicMid` to the member schema in `src/api/schemas/*`. **Display intent:** show **FID at the family level** (`dashboard.family` / `family` GET) and **MID on the member-detail screen** (`members/[mid]/profile`); fall back to `fid` / `mid` when the public id is `null`. **NEVER** use `publicFid` / `publicMid` as join keys or route params — keep using `fid` / `mid`. No request-shape change. (The earlier `921bb37` entry already covers `GET /api/setu/family/search` `hits[].publicFid` — this entry is the dashboard / family / member-detail one and does not change search.)

## `921bb37` · 2026-06-24 · family search hit gains `publicFid`
- **GET `/api/setu/family/search`** (welcome-team) — each object in the `hits` array gains an additive **`publicFid: string | null`** field: the family's canonical 4-digit user-facing Family ID (`null` until assigned during the FID/MID renumber migration; the internal `fid` remains the join key and is unchanged). **Additive** — no existing field changed; `fid`, `legacyFid`, `name`, `location`, `memberCount` are all unchanged. Part of issue #4 (surface the 4-digit FID at family level, 5-digit MID on member detail).
  - **Mobile:** add the nullable `publicFid` to the `FamilySearchHit` schema/type in `src/api/schemas/*`. If/when the app renders a family identifier, prefer `publicFid ?? fid` (a `displayFid` equivalent) so it shows the 4-digit id when present and falls back to the legacy `fid` during migration. No request-shape change. (Member-level `publicMid` is shown only on the member detail screen on web — not added to any list/search response here.)

## `93f5e12` · 2026-06-24 · dashboard exposes the live `schoolYear`
- **GET `/api/setu/dashboard`** — the 200 JSON gains a top-level **`schoolYear: string`** (e.g. `'2025-26'`). This is the **LIVE / operational** school year families and teachers are currently in (the mobile counterpart of the web school-year badge). It is **distinct from `balaVihar.termLabel`**, which is the *family's enrollment period* — `balaVihar.termLabel` is unchanged. **Additive** — no existing field changed.
  - **Mobile:** add `schoolYear` to the dashboard response schema/type in `src/api/schemas/*`, and render the live-year label on the home screen (the mobile counterpart of the web school-year badge). No request-shape change.

## `bd38f92` · 2026-06-24 · seva opportunity status gains `draft`
- **`SevaOpportunityStatus`** (`@cmt/shared-domain`) gains an additive **`'draft'`** value — now `['open','closed','draft']`. A `'draft'` opp is an admin-only, unscheduled rollover copy (a "decide the date later" placeholder) that families must NEVER see. **Additive only**; existing `'open'`/`'closed'` values and all existing docs are unchanged.
- **GET `/api/setu/seva/opportunities`** (family view) — **continues to EXCLUDE drafts**: the family browse list is built from `status:'open'` only, so a `'draft'` opp is never returned. **No response-shape change** — the status enum simply has a new member that the family endpoint won't emit.
  - **Mobile:** add `'draft'` to the seva opportunity status enum/type in the seva schema (so a doc/read carrying `status:'draft'` still validates); ensure the seva list/browse UI filters to `status:'open'` (drafts are admin-only and never appear in the family feed). No request-shape change. The new admin copy endpoint (`POST /api/admin/school-year/copy-seva`) is web/admin-only — no mobile mirror.

## `79cf98c` · 2026-06-24 · calendar scoped to the live school year
- **GET `/api/setu/calendar`** — the returned `entries` are now filtered to the **live school year's window** (Aug 1 → Jul 31 of the operational year). Both prior-year and next-year **preparing** Sundays (cloned for the upcoming year as `enabled:true` before an admin Activates it) are now **excluded**. **Response shape is UNCHANGED** — same `{ location, programKey, entries, weekly }`, same entry fields; only the *set* of `entries` is narrower (live-year-only).
  - **Mobile:** no schema change. The calendar / upcoming list will no longer include other-school-year dates, so update any fixtures/expectations to the live-year set (a test asserting a future-year or prior-year date in `entries` will now fail). `GET /api/setu/dashboard`'s `upcoming` is filtered the same way (also no shape change).

## `357b460` · 2026-06-22 · join-request review — distinct `wrong-family` error
- **GET `/api/setu/join-request/[token]`** — when a signed-in manager opens a request that belongs to a **different family**, the route now returns **`404 { error: 'wrong-family' }`** instead of the old `404 { error: 'not-found' }`. The status stays **404** (deliberately not 401/403 — the review page is public and treats 401/403 as "go sign in", which would loop an already-signed-in user); the target family's name is **not** included. A genuinely missing/handled token still returns `404 { error: 'not-found' }`.
  - **Mobile:** if/when the app builds the join-request review screen, map `wrong-family` to a distinct "you're signed in as a different family — switch accounts" state (vs. the not-found/invalid-link copy). No change to `approve`/`decline` or to the request/response shape otherwise.

## `096463e` · 2026-06-22 · teacher-managed payment source — checkout 422
- **`teacher-managed`** added to the offering `paymentSource` enum (`@cmt/shared-domain` `PAYMENT_SOURCES` is now `['portal','legacy','teacher-managed']`) — an offering whose donation is collected by the teacher OFF-portal. **Additive**; existing values unchanged.
- **POST `/api/setu/donations/checkout`** — when the target enrollment's offering is `paymentSource: 'teacher-managed'`, the route now returns **`422 { error: 'payment-source-teacher-managed' }`** BEFORE any Stripe checkout-session is created (no in-portal donation is possible for these offerings).
  - **Mobile:** add `'teacher-managed'` to the paymentSource enum in the offering/enrollment schemas; in the donate flow, hide the in-portal Give/checkout action for a teacher-managed enrollment and handle the `payment-source-teacher-managed` 422 (surface "payment is collected by your teacher", not a generic error). `GET /api/setu/dashboard` + family reads are unchanged in shape. (The admin offering-overlap `409 offering-date-overlap` change is on `/api/admin/*` — web-only, no mobile mirror.)

## `120c885` · 2026-06-22 · profile-completion gate + required member-field matrix
A per-type "required member info" matrix is now enforced at every member write. The mobile add/edit-member + registration forms must capture + validate the same fields and handle the new 400 codes, or members it creates will be incomplete.
- **Matrix:** ALL members → `gender` (now **`Male|Female` only** on write — `PreferNotToSay` is rejected by the write enums), `foodAllergies` (non-empty; offer a "No known allergies" choice that sends the sentinel **`'None'`**). ADULTS → `email` + `phone` + `volunteeringSkills` (≥ 1). CHILDREN → `schoolGrade` + `birthMonthYear` (`'YYYY-MM'`). `birthMonth` (1-12) is now **derived server-side** from `birthMonthYear` — the client need not send it (it's still honoured when `birthMonthYear` is absent).
- **POST `/api/setu/members`** + **PATCH `/api/setu/members/[mid]`** — new `400 { error }` codes: **`foodAllergies-required`**, **`contact-required`** (an adult missing email or phone), **`grade-required`**, **`birthmonth-required`** (plus the existing `skills-required`). The write-side `gender` enum is now `['Male','Female']`. PATCH enforces a rule **only when the patch touches that field (or changes `type`)**, so a partial patch of a still-incomplete legacy member is not blocked. Same-**family** contact reuse now **shares** the existing contactKey (no overwrite); cross-family reuse still returns `409 { error: 'contact-already-registered', field }`.
  - **Mobile:** in add/edit-member, require gender (Male/Female) + foodAllergies (with a "No known allergies" → `'None'` affordance) for everyone; email+phone+≥1 skill for adults; schoolGrade + a month/year picker (→ `'YYYY-MM'`) for children. Block submit until satisfied; map the new 400 codes to friendly copy. Remove any `PreferNotToSay` option from capture forms.
- **POST `/api/setu/register`** — the body's `manager` object now accepts **and requires** `foodAllergies` + `volunteeringSkills` (≥ 1); `additionalMembers[]` now accepts `foodAllergies`, `volunteeringSkills`, `schoolGrade`, `birthMonthYear`, `email`, `phone`, with `gender` `Male|Female`. Same per-type 400 codes as above, with the response adding **`member: 'manager' | <index>`** to point at the offender. An adult **may reuse the manager's email/phone** (same-family reuse is accepted, not a `duplicate-contact`).
  - **Mobile:** the registration flow must capture the manager's foodAllergies + skills and each added member's per-type required fields, and handle the per-type 400s (`member` tells you which row).
- **Post-sign-in gate (web only):** the portal now hard-redirects an incomplete family to `/family/complete-profile` before the dashboard. The mobile app has no such route, but its home should prompt completion when `GET /api/setu/family` / `GET /api/setu/dashboard` shows members missing the matrix fields. **No response-shape change** to those read endpoints.

## `0225cca` · 2026-06-22 · family-lookup classification + join-request flow
- **POST `/api/setu/family-lookup`** — the found response will gain **`matchAction: 'sign-in' | 'request-to-join'`** alongside the existing `{ found, matchedType, matchedValue }`. `'sign-in'` = the matched contact is a manager or active member (sign in as today); `'request-to-join'` = a roster-origin non-manager member whose access is gated until a manager approves.
  - **Mobile:** add `matchAction` to the family-lookup response schema in `src/api/schemas/auth.ts`; on `'request-to-join'` show a "send a request to your manager" CTA instead of the sign-in CTA.
- **POST `/api/setu/auth/verify-code`** — for a `portalAccess: 'pending'` member the response will carry a **`pendingApproval: true`** signal (+ `fid`, `matchedMid`) and grant **no** family-member claims; the user must wait for manager approval. Managers and active/absent members are unchanged.
  - **Mobile:** handle `pendingApproval` in the verify-code response — surface "access pending your manager's approval" and offer to (re)send the join request rather than landing in the family home.
- **New `POST /api/setu/join-request/send`** (open + IP rate-limited), **`GET /api/setu/join-request/[token]`** (manager-only), **`POST /api/setu/join-request/approve`** and **`POST /api/setu/join-request/decline`** (manager-only) — the member→manager join-request flow. `send` writes a pending request and notifies managers; `approve` promotes the matched member to co-manager.
  - **Mobile:** add the four endpoints + their request/response schemas (mirror the invite flow shapes) once they ship.

## `1d469cf` · 2026-06-21 · #12 invite existing-member guard
- **POST `/api/setu/invite/send`** — now returns **`409 { error: 'already-member' }`** when the invited email already belongs to a family member (primary email or `altEmails`). Previously only `201` / `family-not-found`.
  - **Mobile:** handle the 409 `already-member` case in the invite flow ("already a member of your family"). `src/api/auth.ts:148` already documents it — just verify it's wired in the UI. No response-schema change.

## `73ebdb9` · 2026-06-21 · #10 adult volunteering-skills required
- **POST `/api/setu/members`** and **PATCH `/api/setu/members/[mid]`** — for `type === 'Adult'`, `volunteeringSkills` must contain **≥ 1** item, else **`400 { error: 'skills-required' }`**. Children are never required. PATCH enforces only when `volunteeringSkills` is present in the body.
  - **Mobile:** in the add/edit-member flow require an adult to pick at least one skill before submit, and handle the `skills-required` 400. (The skill *options* list also changed to 11 new values, served by the volunteering-skills options endpoint — no shape change.)

## `a75613d` · 2026-06-21 · #3 dashboard attendance removed
- **GET `/api/setu/dashboard`** — the **`attendance`** sub-object is **removed** from the response. Family-level attendance is no longer a dashboard concept; per-child attendance remains only on the child profile (`/api/setu/members/[mid]/profile`, unchanged).
  - **Mobile:** remove `attendance` (the `attendanceSchema` usage) from `src/api/schemas/dashboard.ts` and any home-screen UI that reads it. ⚠️ Already drifting — `src/api/schemas/dashboard.ts:~55` still declares it.

## `6abbcb9` · 2026-06-21 · security: OTP-gate registration
- **POST `/api/setu/auth/send-code`** — accepts optional **`purpose: 'signin' | 'register'`**. For a brand-new email the client MUST send `purpose:'register'` to receive a code (the sign-in path returns a silent `200` with no code for unknown contacts).
- **POST `/api/setu/auth/verify-code`** — on the no-family (email) path the response now includes a **`registrationGrant`** token.
- **POST `/api/setu/register`** — request body now **requires `registrationGrant`** (the token from verify-code). Missing → `400`; invalid/expired → **`403 { error: 'registration-unverified' }`**.
  - **Mobile:** registration flow must be: send-code `{ purpose: 'register' }` → verify-code returns `registrationGrant` → pass it in the `/register` body. Update `src/api/auth.ts` (register call + verify-code handling) and `src/api/schemas/auth.ts`.

## `1c7f2f1` · 2026-06-21 · security: family-lookup PII trim
- **POST `/api/setu/family-lookup`** — the `match` field is trimmed to **`{ found: true, matchedType: 'email' | 'phone', matchedValue: string } | null`** (no family/member PII). Response is still `{ match }`.
  - **Mobile:** update the family-lookup response schema in `src/api/schemas/auth.ts` to the trimmed `match` shape (it already treats `match: null` as "no family").

## 2026-07-27 — monthly pledge becomes a Bala Vihar payment option

**Why:** Vaibhav, 2026-07-27: *"This should not be separate. It's part of Bala
Vihar. Instead of straight $500 donation, family can do Monthly Pledge"* …
*"this is an enrollment option one-time vs monthly"* … *"It would be continuous
until manually stopped."* The pledge stopped being a standalone "support the
mission" ask and became the second way to pay the enrollment donation.

**`GET /api/setu/dashboard` — no field added or removed, but VALUES CHANGE.**
For a family with an `active` pledge:

- `balaVihar.donationComplete` is now `true` even when `givenForPeriod` is `0`.
- `balaVihar.donationPct` is now `100` in the same case.
- `balaVihar.bvState` can be `'enrolled'` with no completed donation on file.
- `actionItems` no longer contains the complete-your-donation nudge.

**What the mobile must do:** stop inferring "paid" from
`givenForPeriod >= suggestedAmount`. That comparison is now WRONG for monthly
givers — it will show a paying family as owing the full amount. Read
`donationComplete` / `donationPct`, which the server derives.

`balaVihar.givenForPeriod` deliberately still counts only **completed one-time
donations**, so it can legitimately be `0` while `donationComplete` is `true`.
It is the amount actually received, not the family's standing.

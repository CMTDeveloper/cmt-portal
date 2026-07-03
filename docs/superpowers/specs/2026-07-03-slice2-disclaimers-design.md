# Slice 2 — Family Disclaimers Design

> **Status:** Draft for owner review. Part of the 3-slice decomposition from the
> 2026-07-06 polishing call (Slice 1 = dashboard simplification + enrollment
> triggers, shipped; Slice 3 = admin/teacher polish, queued). Decision log for all
> three slices lives in the published "polish-review" Artifact.

**Goal:** Show admin-editable disclaimer sections as an accept-all gate at the end
of the family sign-in / sign-up flow, re-prompting when an admin edits the content
or a new school year begins, and record each family's acceptance in a
version-tracked way.

**Architecture in one line:** A flag-gated `DisclaimerGate` server component in the
`/family` layout (mirroring the existing `ProfileCompletionGate`) redirects a
manager whose acceptance isn't current to a top-level `/disclaimers` accept screen;
the content is an admin-editable `app_config/disclaimers` doc (exact analog of
`app_config/school_year`); acceptance is a `families/{fid}.disclaimersAccepted`
record validated against `(currentSchoolYear, contentVersion)`.

---

## Locked decisions (owner-confirmable, all reversible)

The 2026-07-06 call locked the high-level shape (admin-editable · accept-all gate at
the END of the sign-in/sign-up flow, NOT the enroll button · yearly reset + re-prompt
on admin edit · version-tracked). Four details were unpinned; the owner was away when
asked, so these are best-judgment defaults chosen to match existing repo patterns:

1. **Accept scope = per family, the MANAGER accepts.** The gate runs for the
   family-manager only; family-members reach the dashboard without a disclaimer
   gate. Acceptance is stored once per family. Rationale: mirrors the profile-
   completion gate (a manager completes the whole family), matches the FID-centric
   model, and the "20 hrs Seva" clause is a family-level commitment.
   **This is the one decision with a real trade-off** — if every adult should
   personally acknowledge, switch to per-member storage (see §11 Alternatives).
2. **Version model = school-year + content version.** Acceptance is valid only for
   `(app_config/school_year.currentYear, app_config/disclaimers.version)`. The
   existing school-year rollover flips `currentYear` → automatic annual re-prompt
   with **no new cron**; an admin publish bumps `version` → immediate re-prompt.
3. **Accept UI = one checkbox per section.** Each of the (seed) four sections has
   its own required checkbox; "Agree & continue" enables only when all are checked.
4. **Rollout = hard-gate everyone on next visit.** An absent/stale
   `disclaimersAccepted` record reads as "must accept" — no backfill or migration.

---

## Global constraints (bind every task)

- **Flag-gated OFF by default.** `flags.setuDisclaimers` = literal
  `process.env.NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS === 'true'` (never dynamic
  index — client inlining). Register the var in `turbo.json`'s `env` array. The
  family-facing GATE, the `/disclaimers` route, and the dashboard
  `disclaimersPending` field are all gated by this flag. The `/admin/disclaimers`
  editor is admin-only and available regardless of the flag (admins pre-author).
- **UAT only.** All Firestore reads/writes, index audits (none here), and E2E run
  against `chinmaya-setu-uat`. Never touch prod `715b8`.
- **`exactOptionalPropertyTypes` is on.** Never assign `undefined` to an optional —
  omit the key or use `null`.
- **Doc read-schemas: no `.min(1)` on content fields.** `DisclaimersConfigSchema`
  and the `disclaimersAccepted` shape validate on READ; required-ness (non-empty
  titles/bodies) is enforced at the admin write route + the editor form, not the
  read schema.
- **`@cmt/shared-domain` stays pure** — no React/Next/Firestore imports. The Zod
  schemas, the seed default, and the `isDisclaimerAccepted` predicate live there;
  all Firestore I/O lives in the portal feature module.
- **Leave a redirect-gated screen via a HARD nav.** The `/disclaimers` accept
  button POSTs then calls `navigateTo('/family')` (`window.location.assign`) — never
  `router.push` — so the gate re-runs server-side on fresh data (same rule that
  fixed the `/complete-profile` stuck-Saving bug).
- **Mobile-ready.** Both `/api/setu/disclaimers*` routes authenticate via
  `readSessionFromHeaders` (Bearer + cookie), serialize ISO strings / plain JSON,
  and every request/response shape change gets a `MOBILE_API_CHANGELOG.md` entry.
- **No new Firestore composite index.** Every read is a single-doc get
  (`app_config/disclaimers`, `app_config/school_year`, `families/{fid}`).

---

## Data model

### Content doc — `app_config/disclaimers` (admin-editable)

```ts
// packages/shared-domain/src/setu/schemas/disclaimers.ts
export const DisclaimerSectionSchema = z.object({
  id: z.string(),        // stable slug, e.g. 'respect-responsibility'
  title: z.string(),     // NO .min — read-schema; non-empty enforced at write
  body: z.string(),      // plain text / lightweight markdown
});

export const DisclaimersConfigSchema = z.object({
  version: z.number().int().positive(),
  sections: z.array(DisclaimerSectionSchema),
  // write-only bookkeeping (present after first publish; optional on read)
  updatedAt: z.unknown().optional(),   // Firestore Timestamp; not surfaced to clients
  updatedBy: z.string().optional(),
});
export type DisclaimersConfig = z.infer<typeof DisclaimersConfigSchema>;
```

The doc may be **absent** until the first admin publish — reads fall back to
`DEFAULT_DISCLAIMERS_CONFIG` (version 1, seed sections). This means the feature
works at launch with zero admin action.

### Acceptance record — `families/{fid}.disclaimersAccepted`

```ts
export const DisclaimerAcceptanceSchema = z.object({
  schoolYear: z.string(),          // e.g. '2026-2027' — matches SchoolYearConfig
  version: z.number().int().positive(),
  acceptedAt: z.unknown().optional(),   // Firestore Timestamp
  acceptedByMid: z.string(),
});
```

Added as an **optional** field on the existing `FamilyDoc` read schema (absence =
never accepted = must accept). No migration; retroactive.

### Seed content (`DEFAULT_DISCLAIMERS_CONFIG`, version 1)

> **DRAFT copy — confirm exact wording with the CMT admin team.** Low-stakes because
> it is admin-editable at `/admin/disclaimers` after launch. Section `id`s are stable
> and must not change (acceptance is keyed on `version`, not section ids, but stable
> ids keep edits clean).

1. **`respect-responsibility` — Respect & Responsibility:** "We treat every sevak,
   teacher, family, and child with kindness and respect. We arrive on time, follow the
   guidance of teachers and volunteers, and take responsibility for our children's
   conduct while on Mission premises."
2. **`sacred-spaces` — Care for Sacred Spaces:** "Chinmaya Mission's halls, shrines,
   and grounds are sacred. We remove footwear where required, keep spaces clean, handle
   sacred images and materials with reverence, and help leave every room better than we
   found it."
3. **`community-values` — Community Values:** "Our community runs on seva (selfless
   service). Each family commits to contributing at least **20 hours of seva per school
   year** — helping with events, classes, kitchen, setup, or other needs — and to
   participating in the life of the Mission beyond the classroom."
4. **`chinmaya-values` — Acknowledgement of Chinmaya Values:** "We understand that
   Chinmaya Mission Toronto is a Hindu spiritual and cultural organization rooted in the
   teachings of Pujya Gurudev Swami Chinmayananda, and we acknowledge and support the
   Mission's values and the spiritual nature of its programs."

---

## Components & interfaces

### Shared-domain (pure)

- **`packages/shared-domain/src/setu/schemas/disclaimers.ts`** — the three schemas +
  types above. Exported from the setu schema barrel.
- **`packages/shared-domain/src/setu/disclaimers.ts`**
  - `DEFAULT_DISCLAIMERS_CONFIG: DisclaimersConfig` (version 1, seed sections).
  - `isDisclaimerAccepted(accepted: DisclaimerAcceptance | undefined | null, config: Pick<DisclaimersConfig,'version'>, currentYear: string): boolean`
    - `return !!accepted && accepted.schoolYear === currentYear && accepted.version >= config.version;`
  - Exported from `packages/shared-domain/src/setu/index.ts`.
- **`FamilyDoc`** schema gains optional `disclaimersAccepted?: DisclaimerAcceptance`.

### Portal feature module — `apps/portal/src/features/setu/disclaimers/`

- **`config.ts`**
  - `getDisclaimersConfig(db): Promise<DisclaimersConfig>` — read `app_config/disclaimers`,
    `safeParse` → data or `DEFAULT_DISCLAIMERS_CONFIG`. (Exact shape of
    `getSchoolYearConfig`.)
  - `setDisclaimersConfig(db, sections: DisclaimerSection[], actorMid: string): Promise<DisclaimersConfig>` —
    transaction: read current (or DEFAULT); if `sections` deep-equal current → return
    current unchanged (no needless re-prompt); else write
    `{ version: current.version + 1, sections, updatedAt: serverTimestamp(), updatedBy: actorMid }`
    and return it. So absent-doc + changed content → version 2; identical → no bump.
- **`acceptance.ts`**
  - `recordDisclaimerAcceptance(db, fid, { version, schoolYear, byMid }): Promise<void>` —
    `families/{fid}.set({ disclaimersAccepted: {...} }, { merge: true })`; `revalidateTag`
    the family cache tag used by `getFamilyByFid`.
  - `getDisclaimerStateForFamily(db, family: FamilyDoc): Promise<{ version: number; schoolYear: string; sections: DisclaimerSection[]; accepted: boolean }>` —
    reads config + `getSchoolYearConfig`, runs `isDisclaimerAccepted`. Shared by the
    gate, the GET API, and the dashboard so they never diverge.
- **`components/disclaimer-accept-form.tsx`** (`'use client'`) — renders the sections
  with one checkbox each; "Agree & continue" disabled until all checked; on submit calls
  the client wrapper then `navigateTo('/family')`. `.csp`-scoped, Cool-Mist styling to
  match `/sign-in` + `/register`.
- **`components/disclaimers-editor.tsx`** (`'use client'`) — admin editor: edit each
  section title/body (add/remove a section), a **Publish** button behind a confirm
  ("Publishing will ask all families to re-accept on their next visit"). Calls the admin
  client wrapper.
- **`disclaimers-client.ts`** — `acceptDisclaimersClient()` (POST accept),
  `saveDisclaimersClient(sections)` (PUT admin). Client-only fetch wrappers so client
  components never import server modules; both throw on non-OK so the UI fires an error
  toast (per the searchFamiliesClient precedent).

### Pages

- **`apps/portal/src/app/disclaimers/page.tsx`** (+ `error.tsx`) — top-level, OUTSIDE
  `/family`. `await connection()`; if `!flags.setuDisclaimers` → `redirect('/family')`;
  load family via `getCurrentFamily()`; if `!data` → `redirect('/sign-in')`; if
  `!data.isManager` → `redirect('/family')` (members aren't required); if already
  accepted → `redirect('/family')`; else render `<DisclaimerAcceptForm sections=… />`.
- **`apps/portal/src/app/admin/disclaimers/page.tsx`** (+ `error.tsx`) — `await
  connection()`, `getDisclaimersConfig(db)`, render `<DisclaimersEditor config=… />`.
  Matches the `admin/school-year` page shape. Add a tile to the admin dashboard
  ("People & access" group): **Disclaimers** — "Edit the family agreement sections
  families accept at sign-in. Publishing asks all families to re-accept."

### API routes

- **`GET /api/setu/disclaimers`** — `readSessionFromHeaders`; require `fid`; load family;
  return `{ version, schoolYear, sections, accepted }` from `getDisclaimerStateForFamily`.
  Any family role (mobile reads this to gate its own home).
- **`POST /api/setu/disclaimers/accept`** — manager-only; read current config version +
  `currentYear`; `recordDisclaimerAcceptance(db, fid, { version, schoolYear, byMid: mid })`;
  return `{ ok: true, version }`. Ignores any client-sent version (server authoritative).
- **`GET /api/admin/disclaimers`** — admin; return the raw editable config
  (`{ version, sections, updatedAt, updatedBy }`).
- **`PUT /api/admin/disclaimers`** — admin; body `{ sections }`; validate non-empty
  titles/bodies at the route (NOT the read schema); `setDisclaimersConfig(db, sections,
  actorMid)`; return `{ version }`.

---

## The gate (flow)

New `DisclaimerGate` server component in `apps/portal/src/app/family/layout.tsx`,
rendered in its own `<Suspense fallback={null}>` **after** `<ProfileCompletionGate />`:

```
if (!flags.setuDisclaimers) return null;
const data = await getCurrentFamily();
if (!data) return null;                                  // middleware handles auth
if (!data.isManager) return null;                        // per decision 1
if (incompleteMembers(data.members).length > 0) return null;  // defer to profile gate
const state = await getDisclaimerStateForFamily(db, data.family);
if (!state.accepted) redirect('/disclaimers');
return null;
```

Deterministic ordering: profile-incomplete → `/complete-profile` (profile gate);
profile-complete but not accepted → `/disclaimers`; else the dashboard. Guarding the
disclaimer gate on `incompleteMembers` makes profile always come first regardless of
Suspense resolution order — no reliance on which sibling redirect wins.

**Middleware:** add `/disclaimers` to the `isSetuRoute` list in `deny()` so an
unauthenticated hit redirects to `/sign-in` (not legacy `/login`).

---

## Authorization (`canAccessRoute`, `packages/shared-domain/src/auth/can-access-route.ts`)

Add, **before** the manager-only `/api/setu/` catch-all:

```ts
// Disclaimers: GET state = any setu family; POST accept = manager-only.
if (pathname === '/api/setu/disclaimers' || pathname.startsWith('/api/setu/disclaimers/')) {
  if (!isSetuFamily(claims)) return false;
  if (method === 'POST') return isSetuManager(claims);
  return true;
}
```

Add a page rule near `/complete-profile`:

```ts
if (pathname === '/disclaimers' || pathname.startsWith('/disclaimers/')) {
  return isSetuFamily(claims);
}
```

`/admin/disclaimers` + `/api/admin/disclaimers` are already covered by the existing
`/admin` → `isAdmin` and `/api/admin/` → `isAdmin` rules. **No `public-routes.ts`
change** — every disclaimer path is authenticated.

---

## Mobile parity

- Additive `disclaimersPending: boolean` on the dashboard payload
  (`apps/portal/src/app/family/_helpers/load-dashboard.ts` + the shared model consumed
  by both `/family` and `GET /api/setu/dashboard`). Computed
  `flags.setuDisclaimers && isManager && !accepted`, wrapped fail-soft (any read error →
  `false`) so a config hiccup never 500s the home.
- The two `/api/setu/disclaimers*` routes are the mobile client's read + accept surface.
- **`apps/portal/docs/MOBILE_API_CHANGELOG.md`** — one dated, SHA-keyed additive entry:
  new `GET /api/setu/disclaimers`, `POST /api/setu/disclaimers/accept`, and
  `dashboard.disclaimersPending`; note the accept is manager-only and the version model.

---

## Testing strategy

- **Unit (shared-domain):** `DisclaimersConfigSchema` parse + default fallback;
  `isDisclaimerAccepted` truth table — accepted-current (true), stale-version (false),
  stale-year (false), absent (false), accepted-newer-version (true via `>=`).
- **Unit (portal):** `setDisclaimersConfig` version bump (absent→2 on change, present→+1,
  identical→no-op); gate logic (flag-off → null; member → null; incomplete-profile →
  null; manager-not-accepted → redirect; accepted → null).
- **Route tests:** GET returns state shape; POST accept records + is manager-only
  (family-member 401/403); admin GET/PUT bumps version + admin-only.
- **E2E (deployed UAT, `e2e/setu/disclaimers.spec.ts`, `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS=true`):**
  a seeded **manager** family with a complete profile and no acceptance signs in →
  lands on `/disclaimers` → all four boxes → "Agree & continue" → hard-nav → `/family`
  dashboard (no gate on re-visit). A seeded **family-member** is NOT gated. Admin edits +
  publishes → version bumps → the family is re-prompted on next visit. `afterAll` restores
  the family's ground state. Extend `scripts/seed-e2e-family.ts` with a
  `--disclaimers-accepted <none|current>` control and (if needed) a way to reset the
  `app_config/disclaimers` version between runs. Mind the shared 5/15-min sign-in limiter
  and re-auth after any mid-suite reseed.

---

## Rollout & runbook

- Ship dark: `NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS` unset (gate off) until launch. The
  admin editor is usable before launch so admins can finalize copy.
- On flag-on, every existing family (~864) hits the gate on its next manager visit and
  accepts once — no migration (absence = must-accept).
- **`docs/runbooks/production-cutover-checklist.md`** — dated §14 entry: new flag
  (OFF default), new `app_config/disclaimers` doc (created on first admin publish; absent
  = seed default), new optional `families.disclaimersAccepted` field (no backfill), no
  new index, E2E gating note, MOBILE_API_CHANGELOG cross-ref.

---

## Alternatives considered (for the one open decision)

**Per-adult acceptance (decision 1 alternative).** Store `disclaimersAccepted` on the
**member** doc instead of the family doc; run the gate for family-members too (guarded on
their own record); accept POST becomes any-family (self). Every signing-in adult
personally acknowledges. Cost: the gate + `/disclaimers` run for members, storage moves
to `members/{mid}`, and `getDisclaimerStateForFamily` becomes per-member. Switching later
is mechanical (move the field + widen the gate + drop the manager-only on accept). Chosen
against for the MVP in favour of the lighter family-level model, but this is the single
decision most worth confirming with the owner.

---

## Out of scope (YAGNI)

- Rich-text/markdown editor for section bodies (plain textareas in v1; body renders as
  pre-wrapped text or minimal markdown).
- Per-section version history / audit trail beyond `updatedAt`/`updatedBy` + the monotonic
  `version`.
- A dedicated "disclaimers accepted" report (the `families.disclaimersAccepted` field is
  queryable later if a report is ever needed).
- Emailing families when disclaimers change (the next-visit gate is the notification).

# Investigation: Bal Vihar enroll page server-component error

## Summary
Production `/family/enroll` fails during Server Component render because `resolveActivePeriod()` queries `donationPeriods` with three equality filters plus `startDate DESC`, and Firestore project `chinmaya-setu-uat` has no active usable composite index for that query. The repo contains a related `donationPeriods` index, but its equality-field order differs from Firestore's generated recommendation, and Firestore index deployment is manual/not part of Vercel or CI.

## Symptoms
- Production URL `https://cmt-portal-portal.vercel.app/family/enroll` renders the Family segment error boundary: “Something went wrong in Family”.
- Chrome console shows repeated Next.js production Server Components render errors, with sensitive details omitted.
- The page displays Error ID / digest `423557926`.
- The user is signed in as `Dinesh Matta` and the sidebar highlights `Bala Vihar`.

## Background / Prior Research

### Git archaeology probe
- Recent enrollment work introduced the real `/family/enroll` API/page flow across commits including `5edc557`, `0e91600`, `6659a4b`, and `ebde0b0`.
- Current likely regression areas reported by the probe:
  1. `apps/portal/src/app/family/enroll/page.tsx` loads family, enrollments, and an active period, then only treats an enrollment as current when `e.pid === activePeriod?.pid`.
  2. `apps/portal/src/features/setu/enrollment/resolve-active-period.ts` uses server `new Date()` and filters enabled periods in memory by start/end dates.
  3. `apps/portal/src/app/api/setu/enrollments/route.ts` depends on middleware-injected session headers through `readSessionFromHeaders`.
  4. `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` controls the post-enrollment donation path and donate-page redirect, though this would more likely affect flow continuation than a server-render failure on `/family/enroll`.
- The probe also noted recent commits around Toronto date helpers/admin period handling, so date normalization/timezone boundaries remain a plausible area to test.

### Production Vercel log probe
- Vercel production logs for `GET /family/enroll` confirmed digest/Error ID `423557926`.
- Exact hidden server error: `9 FAILED_PRECONDITION: The query requires an index`, from Firestore project `chinmaya-setu-uat`.
- Required composite index appears to target collection group `donationPeriods` with fields: `enabled ASC`, `location ASC`, `programKey ASC`, `startDate DESC`, `__name__ DESC`.
- Observed timestamps: `2026-05-27 20:06:38 EDT`, `2026-05-27 20:06:44 EDT`, and `2026-05-27 20:07:14 EDT`.
- Deployment: `cmt-portal-portal`, production, branch `main`, deployment id `dpl_EvCe4muB2adzhXK8zoKUU65BX5Rw`, created `2026-05-27 19:11:14 EDT`.
- The logged HTTP status was `200` with the Family error boundary rendered, which matches the screenshot: the route response succeeds but Server Component rendering falls into the segment error UI.

## Investigator Findings

### Follow-up investigation — 2026-05-27

#### 1. Render path to the failing query

- `/family/enroll` renders inside the family segment layout. The layout wraps children in `<Suspense>` and has a sidebar identity fetch, but the sidebar path only calls `getCurrentFamily()` and `readIsAdminFromCookie()`; it does not query `donationPeriods` (`apps/portal/src/app/family/layout.tsx:14-25`, `apps/portal/src/app/family/layout.tsx:49-70`).
- The page server component forces dynamic rendering with `await connection()`, loads the signed-in family via `getCurrentFamily()`, then runs `getEnrollments(family.fid)` and `resolveActivePeriod({ programKey: 'bala-vihar', location: family.location })` in parallel (`apps/portal/src/app/family/enroll/page.tsx:18-35`).
- `getCurrentFamily()` verifies the `__session` cookie and returns `null` on missing/invalid/non-family claims; it reads the family via `getFamilyByFid(fid)` (`apps/portal/src/features/setu/members/get-current-family.ts:14-39`). `getFamilyByFid()` only reads `families/{fid}` and `families/{fid}/members` (`apps/portal/src/features/setu/members/get-family-by-fid.ts:14-22`).
- `getEnrollments()` reads `families/{fid}/enrollments` ordered by `enrolledAt DESC`, then joins period docs by direct `donationPeriods/{pid}` document reads (`apps/portal/src/features/setu/enrollment/get-enrollments.ts:41-58`). This does not match the production missing-index shape.
- The query that matches the Vercel log is in `resolveActivePeriod()`: `collection('donationPeriods')`, `where('programKey', '==', programKey)`, `where('location', '==', location)`, `where('enabled', '==', true)`, `orderBy('startDate', 'desc')`, then `.get()` (`apps/portal/src/features/setu/enrollment/resolve-active-period.ts:27-40`). This is the only non-test call path to `resolveActivePeriod()` found in the repo (`apps/portal/src/app/family/enroll/page.tsx:33-35`).

**Conclusion:** the production `GET /family/enroll` server render reaches `resolveActivePeriod()` before the client CTA can load, and that helper issues the exact multi-field `donationPeriods` query implicated by digest `423557926`.

#### 2. Query shape vs. checked-in Firestore index

Production log evidence in this report says Firestore requested a `donationPeriods` composite index ordered as:

1. `enabled ASC`
2. `location ASC`
3. `programKey ASC`
4. `startDate DESC`
5. implicit `__name__ DESC`

The checked-in index is different (`firestore.indexes.json:28-36`):

1. `programKey ASCENDING`
2. `location ASCENDING`
3. `enabled ASCENDING`
4. `startDate DESCENDING`

Scope notes:

- The code uses `db.collection('donationPeriods')`, not `db.collectionGroup('donationPeriods')`, so the runtime query is collection-scoped (`apps/portal/src/features/setu/enrollment/resolve-active-period.ts:34-40`).
- The checked-in index has `queryScope: "COLLECTION"`, which matches the code path (`firestore.indexes.json:28-36`). If a decoded Firestore URL/log explicitly requested `COLLECTION_GROUP` scope, that would be an additional mismatch; otherwise the Admin API path segment `collectionGroups/donationPeriods` is not itself proof that the query scope is collection-group.
- The implicit `__name__ DESC` is expected for this shape: Firestore applies a final document-path ordering by `__name__`, and by default it uses the same direction as the last sorted field. Because the last explicit sorted field is `startDate DESC`, Firestore's generated index includes `__name__ DESC`. Reference: Firebase docs, “Default ordering and the `__name__` field” (`https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the__name__field`).

**Conclusion:** the checked-in `donationPeriods` index has the right collection id and apparent collection scope, but its equality-field order does not match the exact index Firestore requested from production. The requested order should be treated as authoritative when fixing `firestore.indexes.json`; do not assume the current `programKey, location, enabled, startDate` declaration is sufficient.

#### 3. Checked-in mismatch vs. undeployed index

Evidence for a checked-in mismatch:

- The runtime query uses equality filters on `programKey`, `location`, and `enabled`, then orders by `startDate DESC` (`apps/portal/src/features/setu/enrollment/resolve-active-period.ts:34-40`).
- The Firestore-required order captured in logs is `enabled, location, programKey, startDate DESC, __name__ DESC`, while the repo declares `programKey, location, enabled, startDate DESC` (`firestore.indexes.json:28-36`).

Evidence that deployment is also manual and may be missing/stale:

- `firebase.json` points Firebase CLI index deployment at `firestore.indexes.json` (`firebase.json:1-5`), but no automatic deploy path was found.
- GitHub CI only runs install, typecheck, lint, test, and build; it has no Firebase CLI or `firestore:indexes` step (`.github/workflows/ci.yml:31-43`).
- The local pre-push hook also only runs typecheck, lint, test, and build (`scripts/git-hooks/pre-push:13-25`).
- Root and portal package scripts do not include an index deploy script (`package.json:9-19`, `apps/portal/package.json:5-21`).
- Vercel config only sets the Next.js framework and cron schedules; it does not deploy Firestore indexes (`apps/portal/vercel.json:1-4`, `vercel.ts:1-10`).
- Slice 3a review explicitly listed “Deploy Firestore indexes to UAT” as a manual post-deploy checklist item (`apps/portal/docs/slice-3a-review.md:79-82`). CLAUDE guidance similarly warns that Firestore indexes must be deployed manually and never forced against prod (`CLAUDE.md:87`, `CLAUDE.md:101`).

**Conclusion:** the immediate runtime cause is definitely “required composite index missing in target Firestore project `chinmaya-setu-uat`.” The repo also has a checked-in index-order mismatch against Firestore's requested shape. Without a live `firebase firestore:indexes`/console check, the exact deployed state is ambiguous: the required index may be absent because no index deploy happened, because a mismatching checked-in index was deployed, or both. In any case, a Vercel redeploy alone will not fix this; the index definition and Firestore index deployment must be addressed.

#### 4. Nearby alternatives ruled out

- **Auth/session headers:** `/family/enroll` is protected by middleware because `/family` is intentionally absent from public routes (`packages/shared-domain/src/auth/public-routes.ts:1-49`) and `canAccessRoute()` permits `/family/*` only for Setu family roles (`packages/shared-domain/src/auth/can-access-route.ts:34-37`). If auth failed, middleware would redirect before the page, or `getCurrentFamily()` would return `null` and render “Session expired” (`apps/portal/src/app/family/enroll/page.tsx:21-28`). The reported screenshot instead shows the signed-in family chrome and a server-component digest.
- **`readSessionFromHeaders` / `/api/setu/enrollments`:** those headers are relevant to API route handlers (`apps/portal/src/app/api/setu/enrollments/route.ts:8-25`, `apps/portal/src/lib/auth/headers.ts:16-31`). The initial `/family/enroll` server render does not call that API route; it imports server helpers directly (`apps/portal/src/app/family/enroll/page.tsx:6-8`, `apps/portal/src/app/family/enroll/page.tsx:33-35`).
- **Donation feature flag:** `NEXT_PUBLIC_FEATURE_SETU_DONATIONS` is read after `activePeriod` resolution and only controls whether an already-enrolled user sees a donation link vs. “donation coming soon,” and whether `EnrollCta` navigates to donation after POST (`apps/portal/src/app/family/enroll/page.tsx:43-46`, `apps/portal/src/app/family/enroll/page.tsx:115-137`, `apps/portal/src/features/family/components/enroll-cta.tsx:54-63`). The donate page's flag behavior is a redirect back to `/family/enroll`, not a Firestore query (`apps/portal/src/app/family/donate/page.tsx:6-8`).
- **`getEnrollments()`:** its only `donationPeriods` access is `doc(pid).get()`, not a composite query (`apps/portal/src/features/setu/enrollment/get-enrollments.ts:55-58`). Its enrollment list query is on `families/{fid}/enrollments` ordered by `enrolledAt DESC` (`apps/portal/src/features/setu/enrollment/get-enrollments.ts:45-52`), which does not match the log's `donationPeriods` missing-index fields.
- **Route error boundary / client CTA:** the Family error boundary merely renders `ErrorFallback` for errors thrown under the segment (`apps/portal/src/app/family/error.tsx:1-13`). `EnrollCta` is a client component and cannot be the source of a server-render Firestore missing-index error before the page has successfully rendered (`apps/portal/src/features/family/components/enroll-cta.tsx:1-87`).

#### 5. Recommendations

Immediate remediation:

1. Change the `donationPeriods` index in `firestore.indexes.json` to Firestore's requested canonical order while preserving `queryScope: "COLLECTION"` unless a decoded index URL explicitly says otherwise:

   ```json
   {
     "collectionGroup": "donationPeriods",
     "queryScope": "COLLECTION",
     "fields": [
       { "fieldPath": "enabled", "order": "ASCENDING" },
       { "fieldPath": "location", "order": "ASCENDING" },
       { "fieldPath": "programKey", "order": "ASCENDING" },
       { "fieldPath": "startDate", "order": "DESCENDING" }
     ]
   }
   ```

   Do not add `__name__` unless the Firebase CLI/console explicitly requires a non-default document-name direction; Firestore should add `__name__ DESC` implicitly because `startDate` is descending.
2. Deploy indexes to the actual project named in the logs: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`. Wait until the new composite index is `READY`, then re-open production `/family/enroll` with the same signed-in family.
3. Do **not** rely on Vercel redeploys for this failure. The app can keep throwing until Firestore has the matching index, independent of application deployment.
4. If an emergency app-only workaround is needed while the index builds, consider removing `orderBy('startDate', 'desc')` from `resolveActivePeriod()` and sorting the small returned enabled-period set in memory before applying the date-window check. That would trade index dependence for a tiny in-memory sort on an admin-config collection; still verify against UAT before shipping.

Preventive measures:

1. Add a dedicated index deployment script/manual workflow, e.g. `deploy:indexes:uat`, so Firestore index changes are not hidden behind Vercel deploys or local validation.
2. Update the Slice 3/runbook checklist to require: decode/copy Firestore's generated missing-index order, commit the exact field order, deploy indexes, wait for `READY`, then run the route-level UAT smoke.
3. Add `/family/enroll` to the pre-promotion mock-free UAT walkthrough. A unit test with mocked `resolveActivePeriod()` cannot catch missing Firestore indexes.
4. For small configuration collections such as `donationPeriods`, prefer queries that avoid unnecessary composite-index coupling when possible: fetch by equality filters and sort/filter in application code if the result set is bounded and operational simplicity matters more than index-level ordering.
5. Document in `CLAUDE.md` next to the existing Firestore index warning that CI/pre-push/Vercel do not deploy indexes; any `firestore.indexes.json` change needs an explicit Firebase CLI deploy to the target project.

## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** The production page throws during server render before the client form loads, likely from route-level data fetching, auth/session resolution, feature flag handling, or a Server Component import/runtime mismatch.
**Findings:** Initial evidence comes from the screenshot only; production logs and git history still need to be checked.
**Evidence:** Screenshot shows `/family/enroll`, segment-level fallback copy, and digest `423557926`.
**Conclusion:** Needs more investigation.

### Phase 4 - Oracle synthesis
**Hypothesis:** The remaining uncertainty is whether the failure is caused by an undeployed/stale index, a checked-in field-order mismatch, query scope, or implicit `__name__` ordering.
**Findings:** The definitive production failure is a missing active usable Firestore composite index in `chinmaya-setu-uat`. The checked-in index order differs from Firestore's generated recommendation and should be changed, but field order alone is not proven as the sole cause without live Firebase index-state inspection. The implicit `__name__ DESC` is normal and should not be manually added unless Firebase tooling requires it. Query scope is probably not the issue because the code uses `db.collection('donationPeriods')` and the repo index uses `queryScope: "COLLECTION"`.
**Evidence:** Oracle synthesis over selected files plus verified line refs in `apps/portal/src/app/family/enroll/page.tsx:33-35`, `apps/portal/src/features/setu/enrollment/resolve-active-period.ts:34-40`, and `firestore.indexes.json:28-36`.
**Conclusion:** Confirmed root cause with one explicit ambiguity: the live project may be missing the index, have a stale/mismatched index, or have an index still building.

## Root Cause
The production failure is caused by a missing active usable Firestore composite index in `chinmaya-setu-uat` for the `resolveActivePeriod()` `donationPeriods` query. `/family/enroll` reaches that helper during server render, Firestore throws `9 FAILED_PRECONDITION`, and Next.js surfaces the exception through the Family route error boundary with digest `423557926`.

The repo contains a related `donationPeriods` index, but its equality-field order (`programKey`, `location`, `enabled`, `startDate DESC`) differs from Firestore's generated recommendation (`enabled`, `location`, `programKey`, `startDate DESC`, implicit `__name__ DESC`). Because CI/pre-push/Vercel do not deploy Firestore indexes, the live project may be missing the index, have a stale/mismatched deployed index, or have one still building.

## Recommendations
1. Update `firestore.indexes.json` to Firestore's generated `donationPeriods` order: `enabled ASC`, `location ASC`, `programKey ASC`, `startDate DESC`, preserving `queryScope: "COLLECTION"` unless the decoded Firebase index URL explicitly requires `COLLECTION_GROUP`.
2. Deploy indexes to the exact project in the logs: `firebase deploy --only firestore:indexes --project chinmaya-setu-uat`; wait until the index is `READY`.
3. Smoke-test production `/family/enroll` with the affected signed-in family session. A Vercel redeploy alone will not fix this.
4. If an emergency app-only mitigation is needed while the index builds, remove the `orderBy('startDate', 'desc')` dependency in `resolveActivePeriod()` and sort/filter the small bounded `donationPeriods` config set in application code after validating in UAT.

## Preventive Measures
- Add an explicit UAT index-deploy script/workflow and document that Firestore indexes are not deployed by CI/pre-push/Vercel.
- Include `/family/enroll` in pre-promotion UAT smoke tests; unit tests with mocked Firestore helpers cannot catch missing indexes.
- For small admin-config collections such as `donationPeriods`, consider avoiding avoidable composite-index coupling by filtering/sorting in application code when operational simplicity is more important than index-level ordering.

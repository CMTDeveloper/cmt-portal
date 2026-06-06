# Teacher Attendance — Rollout Runbook (Slice 4 / T1–T5)

The portal-native teacher-attendance feature is built and merged behind the
`NEXT_PUBLIC_FEATURE_SETU_TEACHER` flag (default OFF). This is the go-live
checklist.

## 0. Pre-flight
- All of T1–T5 merged to `main`, pre-push gate green.
- T4 (family union) is ALREADY live for families on every deploy — it reads door
  check-ins via the read-only bridge and degrades to teacher-only data if the
  bridge can't read (no crash). The flag only controls the **teacher** screens.

## 1. Infra check (REQUIRED before flipping the flag)
The teacher + family screens read the door app's `family-check-ins` /
`guest-families` from prod `chinmaya-setu-715b8` via the **master service
account**. Confirm that SA has Cloud Firestore READ there:

    pnpm --filter @cmt/portal check:door-access

- PASS → door data will appear. Continue.
- FAIL (PERMISSION_DENIED) → grant the master SA `roles/datastore.viewer` on
  `chinmaya-setu-715b8` (GCP IAM), then re-run. Do NOT grant write. (Until
  fixed, the feature still works but shows no door check-ins / no door guests.)

## 2. Assign at least one teacher
As admin (or welcome-team), open `/admin/levels` → "Assign teacher": enter the
teacher's member `mid` (or standalone `tid`) and tick their level(s). The
`teacher` capability is computed from `teacherAssignments/{ref}` at the person's
NEXT sign-in. (Assignment to a non-existent level is now rejected — T5.1.)

## 3. Flip the flag
Set on the Vercel project (Production), then redeploy (NEXT_PUBLIC_* is build-time
inlined, so a redeploy is required):

    vercel env add NEXT_PUBLIC_FEATURE_SETU_TEACHER production
    # value: true

Redeploy by pushing an empty commit (or `git push` any change) — the GitHub
integration auto-deploys. Verify the var landed with `vercel env pull`.

## 4. UAT walkthrough (manual — needs OTP sign-in)
- As the assigned teacher: `/teacher` lists "My classes"; open a class →
  `/teacher/levels/[id]/attendance`. Roster opens all-present; door self-check-ins
  show a `· door` badge; flag late/absent; Save; reopen shows saved marks; prev/
  next Sunday nav works.
- Visitors: `/teacher/levels/[id]/visitors` — door guests matched by grade show;
  Confirm one; quick-add a name-only walk-in; both become guests.
- As that teacher's family: the dashboard BV card, the child profile, and the
  member-detail page show the UNION (a teacher-marked Sunday with no door
  check-in still counts).
- As a non-teacher family: `/teacher` redirects to `/family` (flag/role gate).

## 5. Rollback
Set `NEXT_PUBLIC_FEATURE_SETU_TEACHER=false` (or remove it) and redeploy. The
teacher area returns 404/redirect; family surfaces keep working (union readers
degrade to door-or-portal data independently of the flag).

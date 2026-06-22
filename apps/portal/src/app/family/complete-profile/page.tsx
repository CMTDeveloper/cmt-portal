import { CompleteProfileForm } from '@/features/setu/members/complete-profile-form';

// Profile-completion screen (owner spec 2026-06-22). The family layout's gate
// redirects here whenever the signed-in person's required member info is
// incomplete (a manager → the whole family; a plain member → their own record).
//
// This route is EXEMPT from the gate (see app/family/layout.tsx) so it can
// always render — that's what breaks the redirect loop. The form itself loads
// the family client-side, shows only the missing fields per member, PATCHes
// each via /api/setu/members/{mid}, and returns to /family once nothing is
// missing. All completeness logic comes from the shared @cmt/shared-domain
// helpers so this screen agrees exactly with the gate and the write routes.
export default function CompleteProfilePage() {
  return <CompleteProfileForm />;
}

import { CompleteProfileForm } from '@/features/setu/members/complete-profile-form';

// Profile-completion screen (owner spec 2026-06-22). The /family layout's gate
// redirects here whenever the signed-in person's required member info is
// incomplete (a manager → the whole family; a plain member → their own record).
//
// It lives at a TOP-LEVEL route, OUTSIDE the /family layout, on purpose. When it
// was nested at /family/complete-profile it inherited the /family layout's gate,
// which had to exempt the completion route via the request pathname — and under
// a soft client-side navigation that header is stale (it read '/family' while
// rendering the completion route), so the gate redirected to itself forever
// (blank page + flickering chrome). As a top-level route the /family gate never
// runs here, so there is nothing to loop. The form loads the family client-side,
// shows only the missing fields per member, PATCHes each via
// /api/setu/members/{mid}, and returns to /family once nothing is missing.
export const metadata = { title: 'Complete your profile' };

export default function CompleteProfilePage() {
  return <CompleteProfileForm />;
}

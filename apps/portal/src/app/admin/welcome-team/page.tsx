// SUPERSEDED by the `redirects()` entry in next.config.ts, which answers this
// path with a real 3xx at routing step 2 - before middleware, and before any
// React renders. This file is now unreachable in a deployed app.
//
// Kept rather than deleted: SOME of these routes are still the target of a
// <Link href>, and `typedRoutes` requires a route to exist for those, so the
// build fails if they go. (Not all of them - /admin/welcome, /admin/welcome-team,
// /family/donations and /check-in/teacher/attendance have no inbound Link and
// could be deleted; they are kept for symmetry rather than necessity.)
//
// Do NOT "simplify" by deleting the config entry and relying on this page: with
// cacheComponents, `redirect()` here streams as the LAST BYTES of a 200 body,
// and a cut stream leaves the browser on its own error page (task #114).
import { redirect } from 'next/navigation';

// The welcome-team grant surface has moved to the unified Users & roles screen.
// This redirect preserves bookmarks and any existing links to the old URL.
// The API routes at /api/admin/welcome-team/* remain intact for back-compat.
export default function AdminWelcomeTeamRedirect() {
  redirect('/admin/users');
}

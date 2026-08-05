// SUPERSEDED by the `redirects()` entry in next.config.ts, which answers this
// path with a real 3xx at routing step 2 - before middleware, and before any
// React renders. This file is now unreachable and is kept only because
// `typedRoutes` needs the route to exist for the <Link href> that point here.
//
// Do NOT "simplify" by deleting the config entry and relying on this page: with
// cacheComponents, `redirect()` here streams as the LAST BYTES of a 200 body,
// and a cut stream leaves the browser on its own error page (task #114).
import { redirect } from 'next/navigation';

// /admin/welcome doesn't exist as a real route — the family search hero is
// at /welcome (welcome-team capability, admin inherits) and the grant page
// is at /admin/welcome-team. This stub catches the muscle-memory URL.
export default function AdminWelcomeRedirect() {
  redirect('/welcome');
}

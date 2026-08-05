// SUPERSEDED by the `redirects()` entry in next.config.ts, which answers this
// path with a real 3xx at routing step 2 - before middleware, and before any
// React renders. This file is now unreachable and is kept only because
// `typedRoutes` needs the route to exist for the <Link href> that point here.
//
// Do NOT "simplify" by deleting the config entry and relying on this page: with
// cacheComponents, `redirect()` here streams as the LAST BYTES of a 200 body,
// and a cut stream leaves the browser on its own error page (task #114).
import { redirect } from 'next/navigation';

export const metadata = { title: 'My donations' };

// Receipts / "My donations" is hidden: general donations are handled via a
// separate CMT process, not collected in-portal (CMT decision 2026-06-04).
// Redirect to the dashboard (rather than 404) so any stale bookmark/link lands
// somewhere useful. The prior receipts implementation is in git history if the
// portal ever surfaces its own donation history again.
export default function DonationsPage() {
  redirect('/family');
}

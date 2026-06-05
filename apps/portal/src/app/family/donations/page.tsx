import { redirect } from 'next/navigation';

export const metadata = { title: 'My donations — CMT Portal' };

// Receipts / "My donations" is hidden: general donations are handled via a
// separate CMT process, not collected in-portal (CMT decision 2026-06-04).
// Redirect to the dashboard (rather than 404) so any stale bookmark/link lands
// somewhere useful. The prior receipts implementation is in git history if the
// portal ever surfaces its own donation history again.
export default function DonationsPage() {
  redirect('/family');
}

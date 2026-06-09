import { redirect } from 'next/navigation';

// The welcome-team grant surface has moved to the unified Users & roles screen.
// This redirect preserves bookmarks and any existing links to the old URL.
// The API routes at /api/admin/welcome-team/* remain intact for back-compat.
export default function AdminWelcomeTeamRedirect() {
  redirect('/admin/users');
}

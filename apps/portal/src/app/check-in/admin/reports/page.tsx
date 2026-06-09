import { redirect } from 'next/navigation';

export const metadata = { title: 'Reports — CMT Portal' };

// The legacy check-in reports page has been superseded by the unified Reports
// hub at /welcome/reports (admin-revamp Phase 4). Anyone landing here — old
// bookmarks, the door app, stale links — is sent to the new hub.
export default function AdminReportsPage() {
  redirect('/welcome/reports');
}

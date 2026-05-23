import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { AdminDashboard } from '@/features/check-in/admin';
import { listAllFamilies } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Admin — CMT Portal' };

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function AdminDashboardPage() {
  if (!flags.checkInAdmin) notFound();

  const db = portalFirestore();
  const todayIso = startOfTodayIso();
  const weekIso = startOfWeekIso();

  const [todaySnap, weekSnap, guestsSnap, allFamilies] = await Promise.all([
    db.collection('check_in_events').where('checkedInAt', '>=', todayIso).get(),
    db.collection('check_in_events').where('checkedInAt', '>=', weekIso).get(),
    db.collection('guest_check_ins').where('checkedInAt', '>=', todayIso).get(),
    listAllFamilies(),
  ]);

  const stats = {
    checkInsToday: todaySnap.size,
    checkInsThisWeek: weekSnap.size,
    guestsToday: guestsSnap.size,
    unpaidFamilies: allFamilies.filter((f) => f.paymentStatus !== 'paid').length,
  };

  return <AdminDashboard stats={stats} />;
}

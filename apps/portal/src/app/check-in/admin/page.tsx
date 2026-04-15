import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import { AdminDashboard } from '@/features/check-in/admin';
import { flags } from '@/lib/flags';
import type { Family } from '@cmt/shared-domain/check-in';

export const metadata = { title: 'Admin — CMT Portal' };
export const dynamic = 'force-dynamic';

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
    readRtdb<Record<string, Family>>('/families'),
  ]);

  const stats = {
    checkInsToday: todaySnap.size,
    checkInsThisWeek: weekSnap.size,
    guestsToday: guestsSnap.size,
    unpaidFamilies: Object.values(allFamilies ?? {}).filter((f) => f.paymentStatus !== 'paid').length,
  };

  return <AdminDashboard stats={stats} />;
}

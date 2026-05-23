import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { AdminDashboard } from '@/features/check-in/admin';
import { listAllFamilies } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Admin — CMT Portal' };

async function AdminBody() {
  // connection() marks this subtree as dynamic so the request-time new Date()
  // calls below are excluded from prerender. Live check-in counts must be
  // fresh — caching here would hide kiosk activity from sevaks.
  await connection();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const weekIso = weekStart.toISOString();

  const db = portalFirestore();
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

export default function AdminDashboardPage() {
  if (!flags.checkInAdmin) notFound();
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading dashboard…</div>}>
      <AdminBody />
    </Suspense>
  );
}

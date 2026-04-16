import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listAllFamilies } from '@/features/check-in/shared';

export const runtime = 'nodejs';
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

export async function GET() {
  const db = portalFirestore();
  const todayIso = startOfTodayIso();
  const weekIso = startOfWeekIso();

  const [todaySnap, weekSnap, guestsSnap, allFamilies] = await Promise.all([
    db.collection('check_in_events').where('checkedInAt', '>=', todayIso).get(),
    db.collection('check_in_events').where('checkedInAt', '>=', weekIso).get(),
    db.collection('guest_check_ins').where('checkedInAt', '>=', todayIso).get(),
    listAllFamilies(),
  ]);

  const unpaidFamilies = allFamilies.filter(
    (f) => f.paymentStatus !== 'paid',
  ).length;

  return NextResponse.json(
    {
      checkInsToday: todaySnap.size,
      checkInsThisWeek: weekSnap.size,
      guestsToday: guestsSnap.size,
      unpaidFamilies,
    },
    { status: 200 },
  );
}

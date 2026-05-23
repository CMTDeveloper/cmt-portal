import { NextResponse } from 'next/server';
import { findFamilyById, loadRecentFamilyCheckIns } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';


export async function GET(req: Request) {
  if (!flags.checkInFamily) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const familyId = req.headers.get('x-portal-family-id');
  if (!familyId) {
    return NextResponse.json({ error: 'no-family-id' }, { status: 401 });
  }

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const recentCheckIns = await loadRecentFamilyCheckIns(family);

  const body: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return NextResponse.json(body, { status: 200 });
}

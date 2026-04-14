import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';
import { FamilyDashboard } from '@/features/check-in/family';
import { findFamilyById, loadRecentFamilyCheckIns } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'My family — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function FamilyDashboardPage() {
  if (!flags.checkInFamily) notFound();

  const h = await headers();
  const familyId = h.get('x-portal-family-id');
  if (!familyId) notFound();

  const family = await findFamilyById(familyId);
  if (!family) notFound();

  const recentCheckIns = await loadRecentFamilyCheckIns(family);

  const response: FamilyDashboardResponse = {
    family,
    recentCheckIns,
    paymentStatus: family.paymentStatus,
  };

  return <FamilyDashboard data={response} />;
}

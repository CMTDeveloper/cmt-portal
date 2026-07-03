import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
import { DisclaimerAcceptForm } from '@/features/setu/disclaimers/components/disclaimer-accept-form';

export const metadata = { title: 'Family agreement' };

// Top-level route, OUTSIDE the /family layout (mirrors /complete-profile) so the
// /family DisclaimerGate never re-runs here — nothing to loop.
export default async function DisclaimersPage() {
  await connection();
  if (!flags.setuDisclaimers) redirect('/family');

  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in');
  // Per-family: only the manager accepts. A non-manager who lands here directly
  // is not required — send them on.
  if (!data.isManager) redirect('/family');

  const state = await getDisclaimerStateForFamily(portalFirestore(), data.family);
  if (state.accepted) redirect('/family');

  return <DisclaimerAcceptForm sections={state.sections} />;
}

import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
import { DisclaimerAcceptForm } from '@/features/setu/disclaimers/components/disclaimer-accept-form';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';

export const metadata = { title: 'Acknowledgements' };

// The gate's data access (cookies via getCurrentFamily, Firestore via
// getDisclaimerStateForFamily) is uncached + dynamic. This is a TOP-LEVEL route
// under the ROOT layout (NOT the /family layout, so the DisclaimerGate never
// re-runs here — nothing to loop), and the root layout does NOT wrap children in
// a Suspense boundary. Under cacheComponents, uncached data accessed outside a
// <Suspense> fails the build prerender ("Uncached data was accessed outside of
// <Suspense>"). So the page's default export is a synchronous static shell whose
// only dynamic child (DisclaimersGate) streams inside its own Suspense boundary —
// exactly how ProfileCompletionGate is wrapped in the /family layout.
async function DisclaimersGate() {
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

export default function DisclaimersPage() {
  return (
    <Suspense
      fallback={
        <CspRoot style={{ minHeight: '100dvh' }}>
          <LoadingOm padding={48} />
        </CspRoot>
      }
    >
      <DisclaimersGate />
    </Suspense>
  );
}

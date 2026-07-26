import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { loadAdultClassGateDataOrThrow } from '@/features/setu/adult-class/load-gate-data';
import { isBalaViharPaid } from '@/features/setu/adult-class/needs-selection';
import { selectableAdults } from '@/features/setu/adult-class/selectable-adults';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { AdultClassForm } from '@/features/setu/adult-class/components/adult-class-form';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';

export const metadata = { title: 'Adult Study Class' };

async function AdultClassSelection() {
  await connection();
  if (!flags.setuAdultClass) redirect('/family');

  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in');
  // Per-family: only the manager commits the selection, exactly as only the
  // manager accepts the disclaimers. A non-manager who lands here directly is
  // not required - send them on.
  if (!data.isManager) redirect('/family');

  // The THROWING loader, deliberately. The fail-soft variant is the GATE's, and
  // reusing it here would be the redirect ping-pong: an intermittent read
  // failure would make /family redirect here while this screen read "nothing to
  // select" and redirected back. A throw reaches error.tsx, where the family
  // gets a retry instead of a loop.
  const gate = await loadAdultClassGateDataOrThrow({
    family: data.family,
    members: data.members,
    isManager: true,
  });
  // null is now unambiguous: no open offering, or nobody in this household could
  // ever be selected. Neither is a read failure, so leaving is safe.
  if (!gate) redirect('/family');

  const adults = selectableAdults(gate.members, gate.teacherAssignedMids);
  if (adults.length === 0) redirect('/family');

  // Deliberately NOT gated on the full `needsAdultClassSelection` predicate.
  // This screen is both the gate's destination AND the only way to CHANGE a
  // selection later, so redirecting away as soon as the gate is satisfied would
  // make the choice a one-time, irreversible decision - and would add a second
  // route that redirects based on the same predicate the gate uses, which is the
  // surface the ping-pong lives on. Showing the form to a manager who has
  // already chosen is harmless; the reconcile path handles the re-save.
  const current = gate.enrollments.find(
    (e) => e.status === 'active' && e.oid === gate.currentOffering!.oid,
  );

  const bv = selectBalaViharEnrollment(gate.enrollments);
  const bvPaid = bv
    ? isBalaViharPaid({ bv, donations: gate.donations, legacyPaymentStatus: gate.legacyPaymentStatus })
    : false;

  return (
    <CspRoot style={{ minHeight: '100dvh', padding: 24 }}>
      <h1>Who will attend the Adult Study Class?</h1>
      {/* The WHY, per spec 4.3. A family reading "you must pick an adult" with
          no reason reads it as bureaucracy rather than as the point of the
          programme. */}
      <p>
        One parent stays on site while Bala Vihar is running, so we ask each family to name who
        will join the Adult Study Class during that hour. Pick anyone who is not already teaching.
      </p>
      <AdultClassForm
        adults={adults.map((m) => ({ mid: m.mid, name: `${m.firstName} ${m.lastName}` }))}
        initialSelected={current?.enrolledMids ?? []}
        bvPaid={bvPaid}
      />
    </CspRoot>
  );
}

// The page's default export stays a synchronous static shell. This is a
// TOP-LEVEL route under the ROOT layout, which does NOT wrap children in a
// Suspense boundary, and under cacheComponents uncached data accessed outside
// <Suspense> fails the build prerender. Same shape as /acknowledgements.
export default function AdultClassPage() {
  return (
    <Suspense
      fallback={
        <CspRoot style={{ minHeight: '100dvh' }}>
          <LoadingOm padding={48} />
        </CspRoot>
      }
    >
      <AdultClassSelection />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { markDonationStatus } from '@/features/setu/donations/mark-donation-status';
import { LoadingOm } from '@/components/chrome/loading-om';
import { flags } from '@/lib/flags';
import { loadAdultClassGateDataFailSoft } from '@/features/setu/adult-class/load-gate-data';
import { needsAdultClassSelection, isBalaViharPaid } from '@/features/setu/adult-class/needs-selection';
import {
  selectableAdults,
  teachingAdults,
} from '@/features/setu/adult-class/selectable-adults';
import { selectBalaViharEnrollment } from '@/app/family/_helpers/select-bv-enrollment';
import { AdultClassForm } from '@/features/setu/adult-class/components/adult-class-form';
import { PledgeCard } from '@/features/family/components/pledge-card';
import { loadPledgeSlot, type PledgeSlot } from '@/features/setu/pledges/load-pledge-slot';
import { finalizePledge } from '@/features/setu/pledges/finalize-pledge';

export const metadata = { title: 'Thank you' };

type Ask = {
  adults: { mid: string; name: string }[];
  bvPaid: boolean;
  teachingAdults: { mid: string; name: string }[];
};

/**
 * Whether to ask this family to name an Adult Study Class attendee, and who they
 * may pick. `null` = do not ask.
 *
 * Gated on the SAME `needsAdultClassSelection` predicate `AdultClassGate` uses,
 * so the ask here and the redirect there can never disagree about who owes a
 * selection - a family shown the ask must be exactly a family the gate would
 * catch, or the two surfaces contradict each other.
 */
async function resolveAsk(
  familyData: Awaited<ReturnType<typeof getCurrentFamily>>,
): Promise<Ask | null> {
  if (!flags.setuAdultClass || !familyData) return null;

  const gate = await loadAdultClassGateDataFailSoft(familyData);
  if (!gate || !needsAdultClassSelection(gate)) return null;

  const bv = selectBalaViharEnrollment(gate.enrollments);
  return {
    adults: selectableAdults(gate.members, gate.teacherAssignedMids).map((m) => ({
      mid: m.mid,
      name: `${m.firstName} ${m.lastName}`,
    })),
    // Same greyed rows as on /adult-class - a family who reaches the ask here
    // rather than through the gate is no less confused by a parent missing from
    // their own list.
    teachingAdults: teachingAdults(gate.members, gate.teacherAssignedMids).map((m) => ({
      mid: m.mid,
      name: `${m.firstName} ${m.lastName}`,
    })),
    // Necessarily true whenever the predicate fired (its condition 3), but
    // derived rather than hardcoded so the fee line cannot drift from the rule.
    // Yes, this recomputes what needsAdultClassSelection already decided - over
    // the SAME `gate` object, so the two cannot disagree. Do NOT "DRY" it by
    // threading a value in from somewhere else: the whole point is that this
    // reads the rule rather than trusting a caller's copy of the answer.
    bvPaid: bv
      ? isBalaViharPaid({
          bv,
          donations: gate.donations,
          legacyPaymentStatus: gate.legacyPaymentStatus,
          hasActivePledge: gate.hasActivePledge,
        })
      : false,
  };
}

/**
 * Finish the pledge the family just authorised, then read back what to say
 * about it.
 *
 * This page doubles as the pledge success URL - `start-pledge.ts` points Stripe
 * at `/donate/success?pledge=<pid>` - so arriving here with a `pledge` param
 * means the family has just left the hosted mandate page.
 *
 * ORDER MATTERS, for the same reason it does with markDonationStatus above:
 * finalize writes the state the card then reads. Reading first would show a
 * family whose mandate just confirmed that it is "still being set up".
 *
 * FAIL-SOFT throughout. Neither the finalize nor the read may cost the family
 * their donation receipt, and the reconciler cron resolves the pledge either way
 * - that is precisely what it exists for.
 */
async function resolvePledgeSlot(
  familyData: Awaited<ReturnType<typeof getCurrentFamily>>,
  pledgePid: string | undefined,
): Promise<PledgeSlot | null> {
  // The flag is re-checked here as well as inside loadPledgeSlot, because with
  // the feature dark a `?pledge=` in the URL must not reach the provider at all.
  if (!flags.setuPledge || !familyData) return null;

  // ── STATUS of a pledge just authorised - never a new ASK ───────────────────
  //
  // Only a pledge RETURN gets the card. It used to render on every arrival, so
  // any completed donation was followed by "Monthly giving - support the mission
  // with $51 a month". Reported 2026-07-28 by CMT Developer after an adult who
  // had just paid the $101 adult-class donation was asked for it.
  //
  // Wrong on every arrival it reached, for the same reason each time - the
  // pledge is the Bala Vihar contribution, $500 once or $51 a month, NOT a
  // general "support the mission" ask (Vaibhav, 2026-07-27: *"This should not be
  // separate. It's part of Bala Vihar."*). After an adult-class or general gift
  // it is an unrelated second ask; after the $500 Bala Vihar donation itself it
  // asks the family to pay monthly for the thing they just paid in full.
  //
  // The place to offer the monthly plan is where the family CHOOSES how to pay -
  // `DonationChoice` on the enroll page. A receipt is not a decision point.
  if (!pledgePid) return null;

  try {
    // fid from the SESSION. A pid in a URL is not authority over a pledge.
    await finalizePledge({ pid: pledgePid, fid: familyData.family.fid });
  } catch (err) {
    console.error('[donate/success] finalizePledge failed - the cron will finish it', err);
  }

  return loadPledgeSlot({ fid: familyData.family.fid, isManager: familyData.isManager });
}

// Exported for tests: an async server component does not resolve under jsdom, so
// the suite awaits this directly rather than trying to drive the Suspense shell.
export async function DonateSuccessBody({
  searchParams,
}: {
  searchParams: Promise<{ did?: string; pledge?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS !== 'true') {
    redirect('/family');
  }
  await connection();

  const familyData = await getCurrentFamily();
  const { did, pledge: pledgePid } = await searchParams;
  // Best-effort: mark the donation completed. The cross-family guard lives in
  // markDonationStatus. Not authoritative — accounting's notification is.
  if (familyData && did) {
    try {
      await markDonationStatus(did, familyData.family.fid, 'completed');
    } catch (err) {
      // Best-effort, as its own docstring says, and NOT authoritative -
      // accounting's notification is. Stripe already has the money, so a failed
      // status write is recoverable; a receipt the family never sees is not.
      // Uncaught, this hid the thank-you AND the ask together, which would have
      // made the fail-soft claim below untrue.
      console.error('[donate/success] markDonationStatus failed - showing the receipt anyway', err);
    }
  }

  // The Adult Study Class ask (spec 4.3). Loaded AFTER markDonationStatus on
  // purpose: the predicate's condition 3 asks whether the Bala Vihar donation is
  // paid, and the write above is what makes it so. Reversing these two lines
  // means the family who JUST paid is the one family never asked.
  //
  // FAIL-SOFT, never loadAdultClassGateDataOrThrow. This is a receipt page and
  // the ask is an enhancement on it - a transient Firestore error must cost the
  // ask, never the family's confirmation that their ~$500 arrived. (The opposite
  // call is right on /adult-class, where the whole page IS the ask.)
  const ask = await resolveAsk(familyData);
  const pledgeSlot = await resolvePledgeSlot(familyData, pledgePid);

  // ── WHO IS READING THIS PAGE ──────────────────────────────────────────────
  // It serves two arrivals. `?did=` is a one-time donation that Stripe has
  // already collected - "received" is true. `?pledge=` is a family returning
  // from authorising a pre-authorized debit, where NOTHING has been taken: the
  // mandate still has to clear, which is why the pledge sits in `started` and
  // the reconciler exists.
  //
  // Until 2026-07-28 the copy was unconditional, so a family finishing a pledge
  // was told "your donation has been received" and promised a tax receipt, on
  // the same screen as a card reading "Nothing has been taken from your account
  // yet". Reported from preview. That contradiction is the exact harm this
  // feature is built to avoid: a PAD can fail days later, and someone told they
  // have paid will not look again.
  const isPledgeReturn = !!pledgePid && !did;

  return (
    <CspRoot style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--ok-soft, #d6efe0)', color: 'var(--ok, #3d7a5a)', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <SetuIcon.check />
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 400, marginBottom: 10 }}>
          {isPledgeReturn ? 'Your monthly gift is being set up' : 'Thank you for your donation'}
        </h1>
        {isPledgeReturn ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 8 }}>
              Thank you for setting up a monthly gift to Chinmaya Mission Toronto.{' '}
              <em className="sa">Hari OM</em> — your seva keeps our programs running.
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              Your CRA tax receipt covers what is actually received during the year, and is mailed by{' '}
              <strong>accounting@chinmayatoronto.org</strong> each February.
            </p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 8 }}>
              Your donation to Chinmaya Mission Toronto has been received. <em className="sa">Hari OM</em> — your seva keeps our programs running.
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              Your official CRA tax receipt will be mailed by <strong>accounting@chinmayatoronto.org</strong> each February for the prior calendar year.
            </p>
          </>
        )}
        {/* ── The Adult Study Class ask. FIRST, above the pledge (spec 4.3).
            Quick, free, and part of finishing enrollment - so it leads. ────── */}
        {ask && (
          <section
            style={{ textAlign: 'left', borderTop: '1px solid var(--hairline, #e5e0d8)', paddingTop: 24, marginBottom: 24 }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 400, marginBottom: 8 }}>
              One last thing
            </h2>
            <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 16 }}>
              One parent stays on site while Bala Vihar is running, so we ask each family to name
              who will join the Adult Study Class during that hour. Pick anyone who is not already
              teaching - it takes a moment, and there is nothing more to pay.
            </p>
            <AdultClassForm
              adults={ask.adults}
              initialSelected={[]}
              bvPaid={ask.bvPaid}
              teachingAdults={ask.teachingAdults}
            />
          </section>
        )}

        {/* ══ The monthly pledge. BELOW the adult-class ask, deliberately ══
            Spec 4.3 fixes this order and P5 v3 Task 5 Step 4 repeats it: the
            adult-class ask is first because it is quick and free; the pledge is
            second and quieter, because leading with a money ask straight after a
            ~$500 payment reads badly. A SIBLING of the ask, never nested inside
            it - nested, it would inherit the adult-class predicate and render
            for nobody. Both facts are test-locked in this page's spec. */}
        {pledgeSlot && (
          <div style={{ textAlign: 'left', marginBottom: 24 }}>
            <PledgeCard
              pledge={pledgeSlot.pledge}
              askAmountCAD={pledgeSlot.askAmountCAD}
              canStart={pledgeSlot.canStart}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* This link IS the "not now" path (Task 9 Step 4). Deliberately NOT
              labelled "Skip": skipping writes nothing, so the next /family visit
              trips AdultClassGate and lands the family on /adult-class anyway. A
              button promising to skip something it cannot skip is worse than an
              honest "Back to family" that happens to defer it. The gate remains
              the persistence mechanism, exactly as Step 4 requires. */}
          <Link href="/family" className="btn btn--p" style={{ padding: '12px 20px', textDecoration: 'none' }}>
            Back to family
          </Link>
        </div>
      </div>
    </CspRoot>
  );
}

// This page used to live under `/family`, whose layout wraps children in a
// <Suspense> boundary. The ROOT layout does NOT, and under cacheComponents
// uncached data accessed outside <Suspense> fails the build prerender
// ("Uncached data was accessed outside of <Suspense>"). Moving the page out of
// the gated layout therefore also meant taking over the Suspense the layout used
// to provide - the default export is now a synchronous shell, exactly like
// /acknowledgements and /adult-class.
export default function DonateSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <CspRoot style={{ minHeight: '100dvh' }}>
          <LoadingOm padding={48} />
        </CspRoot>
      }
    >
      <DonateSuccessBody searchParams={searchParams} />
    </Suspense>
  );
}

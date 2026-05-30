import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { DonateForm } from '@/features/family/components/donate-form';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { paymentSourceOf } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';

export const metadata = { title: 'Donate — CMT Portal' };

export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<{ eid?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS !== 'true') {
    redirect('/family/enroll');
  }

  await connection();

  const familyData = await getCurrentFamily();
  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family, isManager } = familyData;
  const { eid } = await searchParams;

  // Resolve mode. `?eid` → bala-vihar (amount pinned to enrollment snapshot/
  // override); no eid → general year-round giving.
  let mode: 'bala-vihar' | 'general' = 'general';
  let suggestedAmount: number | null = null;
  let periodLabel: string | null = null;
  let tiers: number[] = [];
  let resolvedEid: string | null = null;
  // Legacy cutover year already settled offline → block the online checkout.
  let alreadyPaidLegacy = false;

  if (eid) {
    const enrollments = await getEnrollments(family.fid);
    const enrollment = enrollments.find((e) => e.eid === eid && e.status === 'active');
    if (enrollment) {
      mode = 'bala-vihar';
      resolvedEid = enrollment.eid;
      suggestedAmount = enrollment.effectiveSuggestedAmount;
      periodLabel = enrollment.period?.periodLabel ?? null;
      tiers = enrollment.period?.amountTiers ?? [];

      if (enrollment.period && paymentSourceOf(enrollment.period) === 'legacy') {
        alreadyPaidLegacy = (await getLegacyPaymentStatus(family.legacyFid)) === 'paid';
      }
    }
    // If the eid is stale/unknown, fall through to general giving rather than erroring.
  }

  const heading = mode === 'bala-vihar' ? 'Your dakshina' : 'Make a donation';
  const sub =
    mode === 'bala-vihar'
      ? `Bala Vihar${periodLabel ? ` · ${periodLabel}` : ''} · ${family.location}`
      : 'A charitable gift to Chinmaya Mission Toronto';

  const form = alreadyPaidLegacy ? (
    <div style={{ padding: '16px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radius)', fontSize: 14, lineHeight: 1.55 }}>
      <strong>Already paid for {periodLabel}.</strong>
      <div style={{ marginTop: 6, color: 'var(--body-text)' }}>
        Our records show your Bala Vihar contribution for {periodLabel} is paid — thank you. There&apos;s nothing to pay here.
        {' '}<Link href="/family" style={{ color: 'var(--accentDeep)', fontWeight: 600 }}>Back to dashboard</Link>
      </div>
    </div>
  ) : isManager ? (
    <DonateForm
      mode={mode}
      eid={resolvedEid}
      suggestedAmount={suggestedAmount}
      periodLabel={periodLabel}
      tiers={tiers}
    />
  ) : (
    <div style={{ padding: '14px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600 }}>
      Only the family manager can make a donation through the portal.
    </div>
  );

  const why = (
    <div style={{ padding: 16, background: 'var(--accentSoft)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <Rosette size={20} color="var(--accentDeep)" stroke={1.4} />
        <strong style={{ fontSize: 13, color: 'var(--accentDeep)' }}>Why we ask, plainly</strong>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55 }}>
        Chinmaya Mission Toronto is a registered Canadian charity (11885 3456 RR0001). Your donation pays for the hall, materials, snacks and insurance. <strong>It is not a fee.</strong> <em className="sa">Sevaks</em> teach without pay. Giving more keeps the programs healthy for next year&apos;s families.
      </p>
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href={mode === 'bala-vihar' ? '/family/enroll' : '/family'} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{mode === 'bala-vihar' ? 'Donation' : 'Giving'}</span>
              <span style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 84px' }}>
              <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 6 }}>
                {mode === 'bala-vihar' ? <>Your <em className="sa">dakshina</em></> : heading}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 18, lineHeight: 1.5 }}>{sub}</p>
              {form}
              <div style={{ marginTop: 16 }}>{why}</div>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href={mode === 'bala-vihar' ? '/family/enroll' : '/family'} className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back /> {mode === 'bala-vihar' ? 'Back to enrollment' : 'Back to dashboard'}
          </Link>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{sub}</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>
              {mode === 'bala-vihar' ? <>Your <em className="sa">dakshina</em></> : heading}
            </h1>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
          <div>{why}</div>
          <aside>
            <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>{form}</div>
          </aside>
        </div>
      </div>
    </>
  );
}

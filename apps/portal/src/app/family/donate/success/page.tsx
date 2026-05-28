import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { markDonationStatus } from '@/features/setu/donations/mark-donation-status';

export const metadata = { title: 'Thank you — CMT Portal' };

export default async function DonateSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ did?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS !== 'true') {
    redirect('/family');
  }
  await connection();

  const familyData = await getCurrentFamily();
  const { did } = await searchParams;
  // Best-effort: mark the donation completed. The cross-family guard lives in
  // markDonationStatus. Not authoritative — accounting's notification is.
  if (familyData && did) {
    await markDonationStatus(did, familyData.family.fid, 'completed');
  }

  return (
    <CspRoot style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--ok-soft, #d6efe0)', color: 'var(--ok, #3d7a5a)', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <SetuIcon.check />
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 400, marginBottom: 10 }}>
          Thank you for your <em className="sa">dakshina</em>
        </h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 8 }}>
          Your donation to Chinmaya Mission Toronto has been received. <em className="sa">Hari OM</em> — your seva keeps our programs running.
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
          Your official CRA tax receipt will be mailed by <strong>accounting@chinmayatoronto.org</strong> each February for the prior calendar year.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/family/donations" className="btn btn--p" style={{ padding: '12px 20px', textDecoration: 'none' }}>
            View my donations
          </Link>
          <Link href="/family" className="btn btn--g" style={{ padding: '12px 20px', textDecoration: 'none' }}>
            Back to family
          </Link>
        </div>
      </div>
    </CspRoot>
  );
}

import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { markDonationStatus } from '@/features/setu/donations/mark-donation-status';

export const metadata = { title: 'Donation cancelled — CMT Portal' };

export default async function DonateCancelPage({
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
  // markDonationStatus won't downgrade a 'completed' donation to 'abandoned'.
  if (familyData && did) {
    await markDonationStatus(did, familyData.family.fid, 'abandoned');
  }

  return (
    <CspRoot style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--surface-2, #e3edf1)', color: 'var(--muted)', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <SetuIcon.back />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 400, marginBottom: 10 }}>Donation not completed</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 24 }}>
          No charge was made. You can try again any time — and any amount is welcome.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/family/donate" className="btn btn--p" style={{ padding: '12px 20px', textDecoration: 'none' }}>
            Try again
          </Link>
          <Link href="/family" className="btn btn--g" style={{ padding: '12px 20px', textDecoration: 'none' }}>
            Back to family
          </Link>
        </div>
      </div>
    </CspRoot>
  );
}

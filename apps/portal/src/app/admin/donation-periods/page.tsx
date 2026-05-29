import { connection } from 'next/server';
import Link from 'next/link';
import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { SetuIcon } from '@cmt/ui';
import { PeriodsTable, type PeriodRow } from '@/features/admin/donation-periods/periods-table';

export const metadata = { title: 'Donation periods — CMT Portal admin' };

export default async function DonationPeriodsPage() {
  await connection();

  const db = portalFirestore();
  const snap = await db.collection('donationPeriods').orderBy('startDate', 'desc').get();
  const periods: PeriodRow[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      pid: data.pid as string,
      programKey: data.programKey as PeriodRow['programKey'],
      programLabel: data.programLabel as string,
      location: data.location as PeriodRow['location'],
      periodLabel: data.periodLabel as string,
      startDate: (data.startDate as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      endDate: (data.endDate as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      pricingTiers: (data.pricingTiers ?? []) as PeriodRow['pricingTiers'],
      enabled: data.enabled as boolean,
      createdAt: (data.createdAt as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      createdBy: data.createdBy as string,
      updatedAt: (data.updatedAt as ReturnType<typeof Timestamp.now>).toDate().toISOString(),
      updatedBy: data.updatedBy as string,
    };
  });

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back/> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Admin · Bala Vihar
        </p>
        <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Donation periods</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          Configure per-program, per-location donation periods. Families see the active period for their
          location when they enroll. Suggested amounts are locked at the moment a family enrolls — editing
          a period does not change existing enrollments.
        </p>
      </header>

      <div className="card" style={{ padding: 22 }}>
        <PeriodsTable initialPeriods={periods}/>
      </div>
    </>
  );
}

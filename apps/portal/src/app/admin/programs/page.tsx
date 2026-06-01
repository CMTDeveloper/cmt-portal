import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { ProgramsTable, type ProgramRow } from '@/features/admin/programs/programs-table';

export const metadata = { title: 'Programs — CMT Portal admin' };

export default async function AdminProgramsPage() {
  await connection();

  const programs = await listPrograms();

  // Tally OPEN offerings (enabled + endDate null/future) per program so the
  // table can flag active programs that no family can yet see. Single equality
  // query — no composite index needed; endDate is filtered in memory.
  const now = new Date();
  const offeringsSnap = await portalFirestore().collection('offerings').where('enabled', '==', true).get();
  const openCountByProgram = new Map<string, number>();
  for (const d of offeringsSnap.docs) {
    const endTs = d.data()['endDate'] as { toDate: () => Date } | null;
    const endDate = endTs ? endTs.toDate() : null;
    if (endDate == null || endDate >= now) {
      const key = d.data()['programKey'] as string;
      openCountByProgram.set(key, (openCountByProgram.get(key) ?? 0) + 1);
    }
  }

  const rows: ProgramRow[] = programs.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    openOfferingCount: openCountByProgram.get(p.programKey) ?? 0,
  }));

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Admin
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Programs</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          Manage programs offered by Chinmaya Mission Toronto. Each program has its own offerings (terms),
          eligibility rules, and capabilities. Bala Vihar is the reference program.
        </p>
      </header>

      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)' }}>
        <ProgramsTable initialPrograms={rows} />
      </div>
    </>
  );
}

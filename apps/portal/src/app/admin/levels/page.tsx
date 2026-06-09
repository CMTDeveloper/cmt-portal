import { connection } from 'next/server';
import Link from 'next/link';
import { portalFirestore, Timestamp } from '@cmt/firebase-shared/admin/firestore';
import { SetuIcon } from '@cmt/ui';
import { LevelsTable, type LevelRow, type PeriodOption } from '@/features/admin/levels/levels-table';
import { AssignTeacherForm } from '@/features/admin/levels/assign-teacher-form';
import { listPrograms } from '@/features/setu/programs/get-programs';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

export const metadata = { title: 'Level management — CMT Portal admin' };

type TS = ReturnType<typeof Timestamp.now>;

export default async function LevelsPage() {
  await connection();

  const db = portalFirestore();
  const [levelsSnap, periodsSnap, programDocs] = await Promise.all([
    db.collection('levels').orderBy('location', 'asc').orderBy('order', 'asc').get(),
    db.collection('donationPeriods').where('enabled', '==', true).get(),
    listPrograms(),
  ]);

  const levels: LevelRow[] = levelsSnap.docs.map((d) => {
    const data = d.data();
    return {
      levelId: data.levelId as string,
      programKey: data.programKey as LevelRow['programKey'],
      location: data.location as LevelRow['location'],
      levelName: data.levelName as string,
      levelKind: data.levelKind as LevelRow['levelKind'],
      order: data.order as number,
      gradeBand: (data.gradeBand ?? []) as string[],
      ageLabel: data.ageLabel as string,
      curriculum: data.curriculum as string,
      pid: data.pid as string,
      periodLabel: data.periodLabel as string,
      teacherRefs: (data.teacherRefs ?? []) as string[],
      enabled: data.enabled as boolean,
      createdAt: (data.createdAt as TS).toDate().toISOString(),
      createdBy: data.createdBy as string,
      updatedAt: (data.updatedAt as TS).toDate().toISOString(),
      updatedBy: data.updatedBy as string,
    };
  });

  const periods: PeriodOption[] = periodsSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        pid: data.pid as string,
        periodLabel: data.periodLabel as string,
        location: data.location as PeriodOption['location'],
      };
    })
    .sort((a, b) => a.location.localeCompare(b.location) || a.periodLabel.localeCompare(b.periodLabel));

  const programs: ProgramRow[] = programDocs.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin · Bala Vihar</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Level management</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 660, lineHeight: 1.55 }}>
          A level is a Bala Vihar class for a location + period. Level names and grade-bands differ by
          location, so the same grade maps to a different level at a different centre. Configure levels
          below, and assign the teachers who cover each one — the teacher capability takes effect on
          their next sign-in.
        </p>
      </header>

      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <LevelsTable initialLevels={levels} periods={periods} programs={programs} />
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Assign a teacher</h2>
        <AssignTeacherForm levels={levels} />
      </div>
    </>
  );
}

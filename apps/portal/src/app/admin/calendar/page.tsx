import { connection } from 'next/server';
import Link from 'next/link';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { SetuIcon } from '@cmt/ui';
import { LOCATIONS, type Location } from '@cmt/shared-domain';
import { CalendarEditor } from '@/features/admin/calendar/calendar-editor';
import { listPrograms } from '@/features/setu/programs/get-programs';
import type { ProgramRow } from '@/features/admin/programs/programs-table';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { schoolYearDateRange } from '@/features/setu/rollover/school-year';

export const metadata = { title: 'Class calendar' };

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();

  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);

  // schoolYearDateRange returns canonical YYYY-MM-DD strings (Aug-1 → Jul-31),
  // so they compare directly against the entries' "YYYY-MM-DD" date strings.
  const { start: windowStart, end: windowEnd } = schoolYearDateRange(view.year);

  const locations = [...LOCATIONS] as Location[];
  const programDocs = await listPrograms();
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
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Class calendar</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 660, lineHeight: 1.55 }}>
          Publish the school-year Sunday schedule families see on their dashboard and calendar page.
          Replaces the per-year PDF. Admin and welcome-team can edit.
        </p>
      </header>

      <CalendarEditor locations={locations} programs={programs} windowStart={windowStart} windowEnd={windowEnd} readOnly={view.status === 'past'} />
    </>
  );
}

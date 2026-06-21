import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { LOCATIONS, type Location } from '@cmt/shared-domain';
import { CalendarEditor } from '@/features/admin/calendar/calendar-editor';
import { listPrograms } from '@/features/setu/programs/get-programs';
import type { ProgramRow } from '@/features/admin/programs/programs-table';

export const metadata = { title: 'Class calendar' };

export default async function AdminCalendarPage() {
  await connection();
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

      <CalendarEditor locations={locations} programs={programs} />
    </>
  );
}

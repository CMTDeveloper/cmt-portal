import Link from 'next/link';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import type { WithRole } from '@cmt/shared-domain';
import { AllergyCallout, SectionLabel, DetailGroup } from '@/features/family/components/atoms';
import { canTeacherSeeStudent, getStudentDetail } from '@/features/setu/teacher/student-detail';

export const metadata = { title: 'Student — CMT Teacher' };

export default async function StudentDetailPage({ params }: { params: Promise<{ mid: string }> }) {
  const { mid } = await params;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  const claims = (sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null) as
    | (WithRole & { mid?: string | null })
    | null;
  if (!claims) return <p style={{ color: 'var(--err)', fontSize: 14 }}>Please sign in.</p>;

  if (!(await canTeacherSeeStudent(claims, mid))) {
    return <p style={{ color: 'var(--err)', fontSize: 14 }}>You can only view students in your classes.</p>;
  }

  const s = await getStudentDetail(mid);
  if (!s) return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Student not found.</p>;

  const name = `${s.firstName} ${s.lastName}`;
  const ec = s.emergencyContacts[0];

  return (
    <div>
      <Link href="/teacher" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← My classes</Link>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>{name}</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{s.type}{s.schoolGrade ? ` · ${s.schoolGrade}` : ''}</p>

      {/* Safety-first: always-visible allergy + emergency banner (brief §9) */}
      {s.foodAllergies ? (
        <div style={{ marginTop: 16 }}>
          <AllergyCallout severity="severe" summary={s.foodAllergies} detail={ec ? `Emergency: ${ec.relation} · ${ec.phone}` : 'Please inform the class teacher.'} />
        </div>
      ) : ec ? (
        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--surface2)', fontSize: 13 }}>
          <strong>Emergency contact:</strong> {ec.relation} · {ec.phone}
        </div>
      ) : null}

      <div style={{ marginTop: 22 }}>
        <SectionLabel>Attendance</SectionLabel>
        {s.summary.total === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No attendance recorded yet.</div>
        ) : (
          <>
            <DetailGroup rows={[
              ['Attended', `${s.summary.attendedPct}% (${s.summary.present + s.summary.late} of ${s.summary.total})`],
              ['Present', String(s.summary.present)],
              ['Late', String(s.summary.late)],
              ['Absent', String(s.summary.absent)],
            ]} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12 }}>
              {s.records.slice().reverse().map((r) => {
                const bg = r.status === 'absent' ? 'var(--err)' : r.status === 'late' ? 'var(--warn, #a06410)' : 'var(--accent)';
                return <div key={r.aid} title={`${r.date} · ${r.status}`} style={{ width: 16, height: 16, borderRadius: 4, background: bg, opacity: r.status === 'present' ? 0.75 : 1 }} />;
              })}
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionLabel>Parent contact</SectionLabel>
        {s.parents.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>No parent contact on file.</div>
        ) : (
          <DetailGroup rows={s.parents.map((p): [string, string] => [p.name, p.phone || p.email || '—'])} />
        )}
      </div>
    </div>
  );
}

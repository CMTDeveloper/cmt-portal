import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { displayMid, gradeLabel } from '@cmt/shared-domain/setu';
import { CspRoot, AllergyCallout, SectionLabel, DetailGroup } from '@/features/family/components/atoms';
import { mockFamily } from '@/features/family/data/mock';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getMemberUnifiedAttendance } from '@/features/setu/attendance/get-member-attendance';
import type { ResolvedSummary } from '@/features/setu/attendance/resolve-attendance';
import { selectBalaViharEnrollment } from '../../_helpers/select-bv-enrollment';
import { isoToTorontoDateInput } from '@/lib/toronto-date';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getChildBalaViharJourney } from '@/features/setu/rollover/get-child-journey';
import { JourneyStrip } from '@/features/setu/rollover/components/journey-strip';
interface Props {
  params: Promise<{ mid: string }>;
}

function formatEmergencyContact(ec: { relation: string; phone: string; email: string } | null): string {
  if (!ec) return '—';
  return `${ec.relation} · ${ec.phone}`;
}

function AttendanceSummaryBlock({ summary, hasSid }: { summary: ResolvedSummary; hasSid: boolean }) {
  const attended = summary.present + summary.late;
  const lastDate = summary.marks.length > 0 ? summary.marks[summary.marks.length - 1]!.date : null;
  return (
    <>
      <SectionLabel>Bala Vihar attendance</SectionLabel>
      {summary.total === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
          {hasSid
            ? 'No attendance recorded yet — it appears once Sunday classes begin.'
            : "Per-child attendance isn't linked for this member yet."}
        </div>
      ) : (
        <DetailGroup rows={[
          ['Attended', `${attended} of ${summary.total} Sundays`],
          ['Last class', lastDate ?? '—'],
        ]}/>
      )}
    </>
  );
}

export default async function MemberDetailPage({ params }: Props) {
  const { mid } = await params;

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (!data) notFound();

    const member = data.members.find((m) => m.mid === mid);
    if (!member) notFound();

    const name = `${member.firstName} ${member.lastName}`;
    const typeLabel = member.type === 'Child' ? `Child${member.schoolGrade ? ` · ${gradeLabel(member.schoolGrade)}` : ''}` : 'Adult';
    const canEdit = data.isManager || mid === data.currentMid;
    // Scope attendance to the active Bala Vihar enrollment's window (so a prior
    // year's records don't show under this year's enrollment). Per-member
    // attendance is BV's union of teacher marks ∪ door check-ins, so pin to the
    // BV enrollment — a newer non-BV enrollment (e.g. Tabla) must not scope this
    // attendance away.
    const enrollments = await getEnrollments(data.family.fid);
    const bv = selectBalaViharEnrollment(enrollments);
    const off = bv?.offering ?? null;
    const attendanceSummary = await getMemberUnifiedAttendance({
      mid,
      legacyFid: data.family.legacyFid,
      legacySid: member.legacySid ?? null,
      pid: bv?.oid ?? null,
      windowStart: off ? isoToTorontoDateInput(off.startDate.toISOString()) : null,
      windowEnd: off?.endDate ? isoToTorontoDateInput(off.endDate.toISOString()) : null,
    });

    // Year-by-year Bala Vihar grade + level history (children only).
    const journeyRows =
      member.type === 'Child'
        ? await getChildBalaViharJourney(portalFirestore(), {
            fid: data.family.fid,
            mid,
            member: { schoolGrade: member.schoolGrade ?? null, birthMonthYear: member.birthMonthYear ?? null },
          })
        : [];

    return (
      <>
        {/* Mobile */}
        <div className="block md:hidden">
          <CspRoot style={{ minHeight: '100dvh' }}>
            <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
              <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                  <SetuIcon.back/>
                </Link>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Member detail</span>
                {canEdit
                  ? <Link href={`/family/members/${mid}/edit`} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Edit</Link>
                  : <span style={{ width: 32 }}/>
                }
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 30px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                  <SetuAvatar name={name} size={64}/>
                  <div>
                    <h1 style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{typeLabel} · <span style={{ fontFamily: 'var(--mono)' }}>Member ID {displayMid(member)}</span></div>
                  </div>
                </div>

                <Link href={`/family/members/${mid}/profile`} className="btn btn--s" style={{ marginBottom: 20, display: 'inline-flex' }}>View profile</Link>

                {member.foodAllergies && (
                  <AllergyCallout severity="severe" summary={member.foodAllergies} detail="Please inform class teacher."/>
                )}

                <SectionLabel>Identity</SectionLabel>
                <DetailGroup rows={[
                  ['First name', member.firstName],
                  ['Last name', member.lastName],
                  ['Gender', member.gender === 'PreferNotToSay' ? 'Prefer not to say' : member.gender],
                  ['Member type', member.type],
                  ...(member.schoolGrade ? [['School grade', member.schoolGrade] as [string, string]] : []),
                  ...(member.birthMonthYear ? [['Birth', member.birthMonthYear] as [string, string]] : []),
                  ['Joined', member.joinedAt.toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'America/Toronto' })],
                ]}/>

                {(member.emergencyContacts[0] || member.emergencyContacts[1]) && (
                  <>
                    <SectionLabel>Emergency contact</SectionLabel>
                    <DetailGroup rows={[
                      ['Contact 1', formatEmergencyContact(member.emergencyContacts[0])],
                      ...(member.emergencyContacts[1] ? [['Contact 2', formatEmergencyContact(member.emergencyContacts[1])] as [string, string]] : []),
                    ]}/>
                  </>
                )}

                {member.type === 'Child' && <AttendanceSummaryBlock summary={attendanceSummary} hasSid={Boolean(member.legacySid)}/>}

                {member.type === 'Child' && <JourneyStrip rows={journeyRows}/>}

                {canEdit && (
                  <Link href={`/family/members/${mid}/edit`} className="btn btn--s" style={{ marginTop: 22, display: 'inline-flex' }}>Manage member</Link>
                )}
              </div>
            </div>
          </CspRoot>
        </div>

        {/* Desktop — layout.tsx owns sidebar + main wrapper */}
        <div className="hidden md:block">
          <header style={{ marginBottom: 28 }}>
            <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <SetuIcon.back/> Back to family
            </Link>
            <div className="between">
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <SetuAvatar name={name} size={72}/>
                <div>
                  <h1 style={{ fontSize: 38, fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{typeLabel} · <span style={{ fontFamily: 'var(--mono)' }}>Member ID {displayMid(member)}</span></div>
                </div>
              </div>
              <div className="row" style={{ gap: 10, alignSelf: 'flex-start' }}>
                <Link href={`/family/members/${mid}/profile`} className="btn btn--s">View profile</Link>
                {canEdit && (
                  <Link href={`/family/members/${mid}/edit`} className="btn btn--s"><SetuIcon.edit/> Edit member</Link>
                )}
              </div>
            </div>
          </header>

          <div style={{ maxWidth: 720 }}>
            {member.foodAllergies && (
              <AllergyCallout severity="severe" summary={member.foodAllergies} detail="Please inform class teacher."/>
            )}

            <SectionLabel>Identity</SectionLabel>
            <DetailGroup rows={[
              ['First name', member.firstName],
              ['Last name', member.lastName],
              ['Gender', member.gender === 'PreferNotToSay' ? 'Prefer not to say' : member.gender],
              ['Member type', member.type],
              ...(member.schoolGrade ? [['School grade', member.schoolGrade] as [string, string]] : []),
              ...(member.birthMonthYear ? [['Birth', member.birthMonthYear] as [string, string]] : []),
              ['Joined', member.joinedAt.toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'America/Toronto' })],
            ]}/>

            {(member.emergencyContacts[0] || member.emergencyContacts[1]) && (
              <>
                <SectionLabel>Emergency contact</SectionLabel>
                <DetailGroup rows={[
                  ['Contact 1', formatEmergencyContact(member.emergencyContacts[0])],
                  ...(member.emergencyContacts[1] ? [['Contact 2', formatEmergencyContact(member.emergencyContacts[1])] as [string, string]] : []),
                ]}/>
              </>
            )}

            {member.type === 'Child' && <AttendanceSummaryBlock summary={attendanceSummary} hasSid={Boolean(member.legacySid)}/>}

            {member.type === 'Child' && <JourneyStrip rows={journeyRows}/>}

            {canEdit && (
              <Link href={`/family/members/${mid}/edit`} className="btn btn--s" style={{ marginTop: 28, display: 'inline-flex' }}>Manage member</Link>
            )}
          </div>
        </div>
      </>
    );
  }

  // Flag-off: prototype fallback using mock data
  const mockMember = mockFamily.members.find((m) => m.mid === mid) ?? mockFamily.members[2] ?? mockFamily.members[0]!;
  const name = mockMember.name;

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Member detail</span>
              <button className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>Edit</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <SetuAvatar name={name} size={64}/>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{mockMember.type} · <span style={{ fontFamily: 'var(--mono)' }}>Member ID {displayMid(mockMember)}</span></div>
                </div>
              </div>

              {mockMember.allergy && (
                <AllergyCallout severity={mockMember.allergy.severity} summary={mockMember.allergy.summary} detail={mockMember.allergy.detail}/>
              )}

              <SectionLabel>Identity</SectionLabel>
              <DetailGroup rows={[
                ['First name', name.split(' ')[0]],
                ['Last name', name.split(' ')[1]],
                ['Gender', 'Female'],
                ['Member type', mockMember.type],
                ...(mockMember.grade ? [['School grade', mockMember.grade] as [string, string]] : []),
                ['Joined', 'Sep 2022'],
              ]}/>

              <SectionLabel>Emergency contact</SectionLabel>
              <DetailGroup rows={[
                ['Contact 1', 'Aarti Patel (mother) · (416) 555-3387'],
                ['Contact 2', 'Raj Patel (father) · (416) 555-2204'],
              ]}/>

            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back/> Back to family
          </Link>
          <div className="between">
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <SetuAvatar name={name} size={72}/>
              <div>
                <h1 style={{ fontSize: 38, fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{mockMember.type} · <span style={{ fontFamily: 'var(--mono)' }}>Member ID {displayMid(mockMember)}</span></div>
              </div>
            </div>
            <button className="btn btn--s" style={{ alignSelf: 'flex-start' }}><SetuIcon.edit/> Edit member</button>
          </div>
        </header>

        <div style={{ maxWidth: 720 }}>
          {mockMember.allergy && (
            <AllergyCallout severity={mockMember.allergy.severity} summary={mockMember.allergy.summary} detail={mockMember.allergy.detail}/>
          )}

          <SectionLabel>Identity</SectionLabel>
          <DetailGroup rows={[
            ['First name', name.split(' ')[0]],
            ['Last name', name.split(' ')[1]],
            ['Gender', 'Female'],
            ['Member type', mockMember.type],
            ...(mockMember.grade ? [['School grade', mockMember.grade] as [string, string]] : []),
            ['Joined', 'Sep 2022'],
          ]}/>

          <SectionLabel>Emergency contact</SectionLabel>
          <DetailGroup rows={[
            ['Contact 1', 'Aarti Patel (mother) · (416) 555-3387'],
            ['Contact 2', 'Raj Patel (father) · (416) 555-2204'],
          ]}/>

        </div>
      </div>
    </>
  );
}

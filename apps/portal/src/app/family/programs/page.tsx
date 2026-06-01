import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import type { ProgramDoc, OfferingDoc } from '@cmt/shared-domain';

export const metadata = { title: 'Programs — CMT Portal' };

interface ProgramWithOfferings {
  program: ProgramDoc;
  openOfferings: OfferingDoc[];
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

export default async function ProgramsPage() {
  await connection();

  const familyData = await getCurrentFamily();
  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family } = familyData;

  // Load all active programs and their open offerings for this family.
  const allPrograms = await listPrograms();
  const activePrograms = allPrograms.filter((p) => p.status === 'active');

  const programsWithOfferings: ProgramWithOfferings[] = (
    await Promise.all(
      activePrograms.map(async (program) => {
        const openOfferings = await getOpenOfferingsForFamily(program.programKey, family.location);
        return { program, openOfferings };
      }),
    )
  ).filter((p) => p.openOfferings.length > 0);

  return (
    <>
      {/* ── Mobile ───────────────────────────────────────────────── */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Programs</span>
              <span style={{ width: 32 }} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 90px' }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.5 }}>
                Programs available for your family to enroll in.
              </p>

              {programsWithOfferings.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, color: 'var(--muted)' }}>No programs available right now.</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Check back next semester.</div>
                </div>
              ) : (
                <div className="col" style={{ gap: 12 }}>
                  {programsWithOfferings.map(({ program, openOfferings }) => {
                    const firstOffering = openOfferings[0]!;
                    return (
                      <div key={program.programKey} className="card" style={{ padding: 16 }}>
                        <div className="between" style={{ marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{program.label}</span>
                          <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontSize: 11 }}>
                            {firstOffering.termLabel}
                          </span>
                        </div>
                        {program.shortDescription && (
                          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                            {program.shortDescription}
                          </p>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                          {fmtDate(firstOffering.startDate)}
                          {firstOffering.endDate ? ` – ${fmtDate(firstOffering.endDate)}` : ' · ongoing'}
                          {family.location ? ` · ${family.location}` : ''}
                        </div>
                        <Link
                          href={`/family/enroll/${program.programKey}`}
                          className="btn btn--s"
                          style={{ textDecoration: 'none', display: 'inline-block', fontSize: 12 }}
                        >
                          Enroll →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* ── Desktop ──────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back /> Back to dashboard
          </Link>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Enrollment</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Programs</h1>
          </div>
        </header>

        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, maxWidth: 560, lineHeight: 1.6 }}>
          Programs available for your family to enroll in
          {family.location ? ` at ${family.location}` : ''}.
        </p>

        {programsWithOfferings.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 16, color: 'var(--muted)' }}>No programs available right now.</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>Check back next semester for new enrollment periods.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
            {programsWithOfferings.map(({ program, openOfferings }) => {
              const firstOffering = openOfferings[0]!;
              return (
                <div key={program.programKey} className="card" style={{ padding: 24 }}>
                  <div className="between" style={{ marginBottom: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600 }}>{program.label}</h3>
                    <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontSize: 11 }}>
                      {firstOffering.termLabel}
                    </span>
                  </div>
                  {program.shortDescription && (
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
                      {program.shortDescription}
                    </p>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
                    {fmtDate(firstOffering.startDate)}
                    {firstOffering.endDate ? ` – ${fmtDate(firstOffering.endDate)}` : ' · ongoing'}
                    {family.location ? ` · ${family.location}` : ''}
                  </div>
                  <Link
                    href={`/family/enroll/${program.programKey}`}
                    className="btn btn--p btn--block"
                    style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
                  >
                    Enroll →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

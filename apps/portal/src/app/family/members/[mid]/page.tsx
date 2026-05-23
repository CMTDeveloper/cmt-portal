import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, AllergyCallout, SectionLabel, DetailGroup, DesktopSidebar } from '@/features/family/components/atoms';

export default function MemberDetailPage() {
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
                <SetuAvatar name="Diya Patel" size={64}/>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.1 }}>Diya Patel</h1>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--mono)' }}>MID 4421-03 · Child · age 8</div>
                </div>
              </div>

              <AllergyCallout severity="severe" summary="Peanuts" detail="EpiPen carried in lunch bag. Teachers alerted."/>

              <SectionLabel>Identity</SectionLabel>
              <DetailGroup rows={[
                ['First name', 'Diya'],
                ['Last name', 'Patel'],
                ['Gender', 'Female'],
                ['Member type', 'Child'],
                ['School grade', 'Grade 3'],
                ['Birth', 'March 2017'],
                ['Joined', 'Sep 2022'],
              ]}/>

              <SectionLabel>Emergency contact</SectionLabel>
              <DetailGroup rows={[
                ['Contact 1', 'Aarti Patel (mother) · (416) 555-3387'],
                ['Contact 2', 'Raj Patel (father) · (416) 555-2204'],
              ]}/>

              <button className="focus-ring" style={{ width: '100%', marginTop: 22, background: 'transparent', border: '1px solid var(--err)', color: 'var(--err)', padding: '12px 16px', borderRadius: 'var(--radiusSm)', fontWeight: 600, fontSize: 13 }}>
                Remove from family
              </button>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="family"/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <header style={{ marginBottom: 28 }}>
              <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                <SetuIcon.back/> Back to family
              </Link>
              <div className="between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <SetuAvatar name="Diya Patel" size={72}/>
                  <div>
                    <h1 style={{ fontSize: 38, fontWeight: 400, lineHeight: 1.1 }}>Diya Patel</h1>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--mono)' }}>MID 4421-03 · Child · age 8</div>
                  </div>
                </div>
                <button className="btn btn--s" style={{ alignSelf: 'flex-start' }}><SetuIcon.edit/> Edit member</button>
              </div>
            </header>

            <div style={{ maxWidth: 720 }}>
              <AllergyCallout severity="severe" summary="Peanuts" detail="EpiPen carried in lunch bag. Teachers alerted."/>

              <SectionLabel>Identity</SectionLabel>
              <DetailGroup rows={[
                ['First name', 'Diya'],
                ['Last name', 'Patel'],
                ['Gender', 'Female'],
                ['Member type', 'Child'],
                ['School grade', 'Grade 3'],
                ['Birth', 'March 2017'],
                ['Joined', 'Sep 2022'],
              ]}/>

              <SectionLabel>Emergency contact</SectionLabel>
              <DetailGroup rows={[
                ['Contact 1', 'Aarti Patel (mother) · (416) 555-3387'],
                ['Contact 2', 'Raj Patel (father) · (416) 555-2204'],
              ]}/>

              <button className="focus-ring" style={{ marginTop: 28, background: 'transparent', border: '1px solid var(--err)', color: 'var(--err)', padding: '12px 20px', borderRadius: 'var(--radiusSm)', fontWeight: 600, fontSize: 13 }}>
                Remove from family
              </button>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}

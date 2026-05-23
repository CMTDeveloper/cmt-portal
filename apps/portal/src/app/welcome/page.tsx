import { SetuLogo } from '@cmt/ui';
import { CspRoot, DesktopSidebar } from '@/features/family/components/atoms';
import { WelcomeSearch } from './welcome-search';

export default function WelcomeDashboardPage() {
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 32px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div style={{ marginBottom: 22 }}>
              <SetuLogo size={18}/>
            </div>
            <div style={{ marginBottom: 24 }}>
              <h1 data-testid="welcome-headline" style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em' }}>
                Welcome team
              </h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Search families by name, email, phone, or FID.
              </p>
            </div>
            <WelcomeSearch/>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="home" role="welcome-team"/>
          <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
            <header style={{ marginBottom: 28 }}>
              <h1 data-testid="welcome-headline" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }}>
                Welcome team
              </h1>
              <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
                Search families by name, email, phone, or FID.
              </p>
            </header>
            <div style={{ maxWidth: 640 }}>
              <WelcomeSearch/>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}

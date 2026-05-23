import { SetuLogo } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { WelcomeSearch } from './welcome-search';

export default async function WelcomeDashboardPage() {
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

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
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
      </div>
    </>
  );
}

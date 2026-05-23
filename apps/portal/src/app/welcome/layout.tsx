import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { SetuSessionClaimsSchema } from '@cmt/shared-domain/setu';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar } from '@/features/family/components/desktop-sidebar';

export default async function WelcomeLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let isWelcomeTeam = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw) {
      const parsed = SetuSessionClaimsSchema.safeParse(raw);
      if (parsed.success && parsed.data.role === 'welcome-team') {
        isWelcomeTeam = true;
      }
    }
  }

  return (
    <>
      {/* Mobile: pass-through. Each page renders its own mobile chrome. */}
      <div className="block md:hidden">{children}</div>

      {/* Desktop: shared sidebar around the children main area. */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          {isWelcomeTeam ? (
            <DesktopSidebar role="welcome-team" displayName="Welcome team" subtitle="Welcome team" showSignOut/>
          ) : (
            <div style={{ width: 248, background: 'var(--surface)', borderRight: '1px solid var(--line)' }}/>
          )}
          <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
            {isWelcomeTeam ? (
              <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>}>
                {children}
              </Suspense>
            ) : (
              <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
                <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
              </div>
            )}
          </main>
        </CspRoot>
      </div>
    </>
  );
}

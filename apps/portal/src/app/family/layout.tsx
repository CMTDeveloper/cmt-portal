import { Suspense } from 'react';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { CspRoot } from '@/features/family/components/atoms';
import { DesktopSidebar } from '@/features/family/components/desktop-sidebar';

export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const data = await getCurrentFamily();
  let displayName: string | undefined;
  let subtitle: string | undefined;
  if (data) {
    const currentMember = data.members.find((m) => m.mid === data.currentMid);
    if (currentMember) displayName = `${currentMember.firstName} ${currentMember.lastName}`;
    subtitle = `${data.family.name}${data.family.legacyFid ? ` · FID ${data.family.fid} · Legacy ${data.family.legacyFid}` : ` · FID ${data.family.fid}`}`;
  }
  return (
    <>
      {/* Mobile: pass-through. Each page renders its own mobile chrome. */}
      <div className="block md:hidden">{children}</div>

      {/* Desktop: shared sidebar around the children main area. */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar displayName={displayName} subtitle={subtitle} showSignOut/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>}>
              {children}
            </Suspense>
          </main>
        </CspRoot>
      </div>
    </>
  );
}

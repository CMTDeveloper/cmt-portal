'use client';

import Link from 'next/link';
import { CspRoot, DesktopSidebar } from '@/features/family/components/atoms';

export default function EditMemberError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--err)', marginBottom: 8 }}>Something went wrong</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>{error.message}</p>
          <div className="col" style={{ gap: 10, width: '100%' }}>
            <button onClick={reset} className="btn btn--p btn--block">Try again</button>
            <Link href="/family/members" className="btn btn--g btn--block">Back to family</Link>
          </div>
        </CspRoot>
      </div>
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="family"/>
          <main style={{ flex: 1, padding: '32px 48px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
            <p style={{ fontSize: 16, color: 'var(--err)', marginBottom: 8 }}>Something went wrong</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>{error.message}</p>
            <div className="row" style={{ gap: 10 }}>
              <button onClick={reset} className="btn btn--p">Try again</button>
              <Link href="/family/members" className="btn btn--g">Back to family</Link>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}

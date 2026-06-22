import { Suspense } from 'react';
import { SetuLogo, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { JoinRequestReviewClient } from './join-request-review-client';

// Manager-facing approve page, reached from the emailed join-request link.
// Mirrors /invite/[token]: a static CspRoot shell with desktop + mobile branches
// and a client component that GETs the request (manager-only, fid-scoped) and
// renders Approve / Decline. All data access is client-side via the
// join-request -client fetch wrappers — no server-only imports here.
export default function JoinRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={<JoinRequestSkeleton />}>
      <JoinRequestBody params={params} />
    </Suspense>
  );
}

function JoinRequestSkeleton() {
  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '40px 24px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <SetuLogo size={18} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
          Loading request…
        </div>
      </div>
    </CspRoot>
  );
}

async function JoinRequestBody({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '40px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <SetuLogo size={18} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <JoinRequestReviewClient token={token} compact />
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <SetuLogo size={22} />
            </div>
            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              <JoinRequestReviewClient token={token} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>
          <RightPane />
        </CspRoot>
      </div>
    </>
  );
}

function RightPane() {
  return (
    <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
        <Rosette size={520} color="#fff" stroke={.5} />
      </div>
      <div style={{ position: 'relative', color: '#fff' }}>
        <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Join request</p>
        <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
          &ldquo;Approving a request adds a co-manager to your household — one shared view of enrollment, attendance, and giving.&rdquo;
        </p>
        <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
          Only family managers can approve. The requester still proves their email by signing in.
        </p>
      </div>
    </div>
  );
}

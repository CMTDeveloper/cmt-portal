import { Suspense } from 'react';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getInviteByToken } from '@/features/setu/invite/get-invite';
import { flags } from '@/lib/flags';
import { InviteAcceptClient } from './invite-accept-client';

export default function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  return (
    <Suspense fallback={<InviteSkeleton/>}>
      <InviteBody params={params} searchParams={searchParams}/>
    </Suspense>
  );
}

function InviteSkeleton() {
  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ padding: '40px 24px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <SetuLogo size={18}/>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
          Loading invite…
        </div>
      </div>
    </CspRoot>
  );
}

async function InviteBody({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const { token } = await params;
  // Set by invite-accept-client's sign-in redirect: the invitee has proven email
  // ownership and returned here to finish joining — accept automatically.
  const autoAccept = (await searchParams).intent === 'accept';

  // ── Resolve invite ──────────────────────────────────────────────────────────
  type InviteState =
    | { kind: 'ok'; familyName: string; inviterName: string; relation: string; expiresAt: string }
    | { kind: 'expired' | 'accepted' | 'not-found' };

  let invite: InviteState;

  if (!flags.setuAuth) {
    // Prototype: render with hardcoded copy (feature-flagged off)
    invite = { kind: 'ok', familyName: 'Patel', inviterName: 'Raj Patel', relation: 'Spouse', expiresAt: '' };
  } else {
    const result = await getInviteByToken(token);
    if ('error' in result) {
      invite = { kind: result.error };
    } else {
      invite = {
        kind: 'ok',
        familyName: result.familyName,
        inviterName: result.inviterName,
        relation: result.relation,
        expiresAt: result.expiresAt.toISOString(),
      };
    }
  }

  // ── Error states ────────────────────────────────────────────────────────────
  if (invite.kind !== 'ok') {
    const headline =
      invite.kind === 'expired'
        ? 'This invite has expired'
        : invite.kind === 'accepted'
          ? 'This invite has already been accepted'
          : 'Invite not found';
    const body =
      invite.kind === 'expired'
        ? 'Ask the family manager to send a new invite.'
        : invite.kind === 'accepted'
          ? 'Someone already joined using this link. Sign in to access your family.'
          : 'This invite link is invalid or has been removed.';

    const errorContent = (
      <>
        <div style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'var(--surface)', color: 'var(--muted)', borderRadius: 99, fontSize: 11, fontWeight: 600, marginBottom: 18 }}>
          Family invite
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 400, lineHeight: 1.15, marginBottom: 14 }}>{headline}</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 26 }}>{body}</p>
        <Link href="/sign-in" className="btn btn--p btn--block" style={{ display: 'flex' }}>Sign in →</Link>
      </>
    );

    return (
      <>
        <div className="block md:hidden">
          <CspRoot style={{ minHeight: '100dvh' }}>
            <div style={{ padding: '40px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
              <SetuLogo size={18}/>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {errorContent}
              </div>
            </div>
          </CspRoot>
        </div>
        <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
          <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
            <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: 'auto' }}><SetuLogo size={22}/></div>
              <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
                {errorContent}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
                <span>setu.chinmayatoronto.org</span><span>·</span><span>© 2026 CMT</span>
              </div>
            </div>
            <RightPane/>
          </CspRoot>
        </div>
      </>
    );
  }

  // ── Happy path ──────────────────────────────────────────────────────────────
  const { familyName, inviterName, relation } = invite;

  const inviteContent = (
    <>
      <div style={{ alignSelf: 'flex-start', padding: '4px 10px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontSize: 11, fontWeight: 600, marginBottom: 18 }}>
        You've been invited
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 400, lineHeight: 1.15, marginBottom: 14 }}>
        <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{inviterName}</em> is inviting you to join the {familyName} family on Chinmaya Setu.
      </h1>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6, marginBottom: 26 }}>
        {inviterName} has added you as a co-manager ({relation}). Once you accept, you'll be able to manage{' '}
        <em className="sa">Bala Vihar</em> enrollment, attendance, and donations for everyone in your household.
      </p>
      <div style={{ padding: 18, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
        <div className="row" style={{ gap: -6, marginBottom: 10 }}>
          <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
            <SetuAvatar name={inviterName} size={36}/>
          </div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>The {familyName} Family</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Invited by {inviterName} · {relation}</div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '40px 24px 30px', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <SetuLogo size={18}/>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {inviteContent}
            </div>
            <InviteAcceptClient token={token} mobile autoAccept={autoAccept}/>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          {/* Left pane — content */}
          <div style={{ flex: '1.4 1 0', padding: '44px 60px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 'auto' }}>
              <SetuLogo size={22}/>
            </div>

            <div style={{ maxWidth: 480, width: '100%', alignSelf: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 60 }}>
              {inviteContent}
              <InviteAcceptClient token={token} autoAccept={autoAccept}/>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 18 }}>
              <span>setu.chinmayatoronto.org</span>
              <span>·</span>
              <span>© 2026 CMT</span>
            </div>
          </div>

          {/* Right pane — decorative */}
          <RightPane/>
        </CspRoot>
      </div>
    </>
  );
}

function RightPane() {
  return (
    <div style={{ flex: '1 1 0', background: 'var(--accent)', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 48 }}>
      <div style={{ position: 'absolute', inset: 0, opacity: .15, display: 'grid', placeItems: 'center' }}>
        <Rosette size={520} color="#fff" stroke={.5}/>
      </div>
      <div style={{ position: 'relative', color: '#fff' }}>
        <p style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .7, marginBottom: 8 }}>Family invite</p>
        <p style={{ fontFamily: 'var(--display)', fontSize: 26, fontStyle: 'italic', lineHeight: 1.35, fontWeight: 400 }}>
          "Joining your family on Chinmaya Setu means one shared view of enrollment, attendance, and giving - for the whole household."
        </p>
        <p style={{ marginTop: 16, fontSize: 13, opacity: .75, lineHeight: 1.55 }}>
          Co-managers can enroll children, record attendance, and manage donations together.
        </p>
      </div>
    </div>
  );
}

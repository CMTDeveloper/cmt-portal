import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getFamilyForWelcome } from '@/features/setu/search/get-family-for-welcome';
import { getFamilySevaProgress, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';
import { cookies } from 'next/headers';

export default function WelcomeFamilyDetailPage({
  params,
}: {
  params: Promise<{ fid: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading family…</div>}>
      <WelcomeFamilyDetailBody params={params}/>
    </Suspense>
  );
}

// Exported for testing — the page's default export is a thin Suspense wrapper
// (Next.js 16 Cache Components require dynamic data access inside <Suspense>).
export async function WelcomeFamilyDetailBody({
  params,
}: {
  params: Promise<{ fid: string }>;
}) {
  // Defensive role check — middleware enforces this but the Server Component
  // re-verifies (defense in depth). Any failure mode (no cookie, invalid
  // cookie, wrong role) falls through to AccessDenied — we do NOT read family
  // data until welcome-team is positively confirmed.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  // isWelcomeTeam() helper handles multi-role: admin inherits welcome-team,
  // and a family-manager with extraRoles=['welcome-team'] also passes.
  let allowed = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw && isWelcomeTeam(raw as unknown as WithRole)) {
      allowed = true;
    }
  }
  if (!allowed) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { fid } = await params;
  const data = await getFamilyForWelcome(fid);

  if (!data) notFound();

  const sevaProgress = await getFamilySevaProgress(fid);

  const { family, members } = data;
  const adults = members.filter((m) => m.type !== 'Child');
  const children = members.filter((m) => m.type === 'Child');

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/welcome" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Family detail</span>
              <div style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 90px' }}>
              <FamilyDetailBody family={family} members={members} adults={adults} children={children} sevaProgress={sevaProgress}/>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <Link href="/welcome" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
            <SetuIcon.back/> Back to search
          </Link>
          <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
            FID {family.fid}{family.legacyFid ? ` · Legacy ${family.legacyFid}` : ''}
          </p>
          <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>The {family.name} Family</h1>
        </header>
        <FamilyDetailBody family={family} members={members} adults={adults} children={children} sevaProgress={sevaProgress}/>
      </div>
    </>
  );
}

type FamilyDetailBodyProps = {
  family: FamilyDoc;
  members: MemberDoc[];
  adults: MemberDoc[];
  children: MemberDoc[];
  sevaProgress: FamilySevaProgress;
};

function FamilyDetailBody({ family, members, adults, children, sevaProgress }: FamilyDetailBodyProps) {
  const sevaMet = sevaProgress.hoursEarned >= sevaProgress.hoursPerYear;

  return (
    <div>
      {/* Family header card */}
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Family</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>{family.name}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Location: {family.location}</span>
          <span>FID: {family.fid}</span>
          {family.legacyFid && <span>Legacy FID: {family.legacyFid}</span>}
          <span>Members: {members.length}</span>
          <span>Since: {family.createdAt.getFullYear()}</span>
        </div>
      </div>

      {/* Seva hours card — omitted entirely when no current seva year is set */}
      {sevaProgress.currentSevaYear && (
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Seva hours</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {sevaProgress.hoursEarned} of {sevaProgress.hoursPerYear} hrs
              <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {sevaProgress.currentSevaYear}</span>
            </div>
          </div>
          <span
            style={
              sevaMet
                ? { flex: '0 0 auto', fontSize: 10, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--accentSoft)', color: 'var(--accentDeep)' }
                : { flex: '0 0 auto', fontSize: 10, padding: '2px 9px', borderRadius: 99, fontWeight: 600, background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }
            }
          >
            {sevaMet ? 'Met' : 'Short'}
          </span>
        </div>
      )}

      {/* Adults */}
      {adults.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Adults · {adults.length}</div>
          <div className="col" style={{ gap: 8 }}>
            {adults.map((m) => (
              <MemberRow key={m.mid} m={m}/>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Children · {children.length}</div>
          <div className="col" style={{ gap: 8 }}>
            {children.map((m) => (
              <MemberRow key={m.mid} m={m}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberRow({ m }: { m: MemberDoc }) {
  const name = `${m.firstName} ${m.lastName}`;
  const typeLabel = m.type === 'Child'
    ? `Child${m.schoolGrade ? ` · ${m.schoolGrade}` : ''}`
    : 'Adult';

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <SetuAvatar name={name} size={44}/>
      <div style={{ flex: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          {m.manager && <span style={{ fontSize: 10, padding: '1px 7px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 99, fontWeight: 600 }}>Manager</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{typeLabel}</div>
        {m.email && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.email}</div>}
        {m.phone && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.phone}</div>}
        {m.foodAllergies && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <SetuIcon.warn/> {m.foodAllergies}
          </div>
        )}
      </div>
    </div>
  );
}

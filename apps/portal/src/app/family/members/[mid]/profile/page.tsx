import { connection } from 'next/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getChildProfile } from '@/features/setu/members/get-child-profile';
import { ChildProfileView } from '@/features/setu/members/child-profile-view';

export const metadata = { title: 'Profile — CMT Portal' };

export default async function FamilyMemberProfilePage({ params }: { params: Promise<{ mid: string }> }) {
  await connection();
  const { mid } = await params;
  const data = await getCurrentFamily();
  if (!data) redirect(`/sign-in?from=/family/members/${mid}/profile`);
  if (!data.members.some((m) => m.mid === mid)) notFound(); // own-family only
  const profile = await getChildProfile(mid);
  if (!profile) notFound();
  const canEdit = data.isManager || mid === data.currentMid;
  const view = <ChildProfileView profile={profile} {...(canEdit ? { editHref: `/family/members/${mid}/edit` } : {})} />;
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href={`/family/members/${mid}`} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}><SetuIcon.back /></Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Profile</span>
              <div style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 90px' }}>{view}</div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        <Link href={`/family/members/${mid}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 16 }}><SetuIcon.back /> Back to member</Link>
        {view}
      </div>
    </>
  );
}

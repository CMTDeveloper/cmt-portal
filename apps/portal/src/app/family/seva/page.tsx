import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';
import { CspRoot } from '@/features/family/components/atoms';
import { SevaBrowser } from '@/features/setu/seva/seva-browser';

export const metadata = { title: 'Seva — CMT Portal' };

export default async function FamilySevaPage() {
  await connection();
  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in?from=/family/seva');
  const view = await getFamilySevaView(data.family.fid);
  const members = data.members.map((m) => ({ mid: m.mid, name: `${m.firstName} ${m.lastName}`.trim() }));
  const browser = (
    <SevaBrowser
      currentSevaYear={view.currentSevaYear}
      hoursPerYear={view.hoursPerYear}
      initialOpportunities={view.opportunities}
      initialMySignups={view.mySignups}
      members={members}
    />
  );
  // The /family layout renders the mobile branch as a bare pass-through (no
  // CspRoot, no padding) while the desktop <main> is already CspRoot-wrapped
  // and padded (32px 48px). So the mobile branch needs its own CspRoot — both
  // to resolve the --setu-* design tokens (they only resolve inside .csp) and
  // to add page padding that clears the fixed bottom nav (~64px). On desktop
  // the wrapper is a no-op pass-through (nested .csp just re-aliases the same
  // tokens) and the layout owns the padding.
  return (
    <>
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh', padding: '18px 18px 96px' }}>{browser}</CspRoot>
      </div>
      <div className="hidden md:block">{browser}</div>
    </>
  );
}

import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getFamilySevaView } from '@/features/setu/seva/get-family-seva-view';
import { SevaBrowser } from '@/features/setu/seva/seva-browser';

export const metadata = { title: 'Seva — CMT Portal' };

export default async function FamilySevaPage() {
  await connection();
  const data = await getCurrentFamily();
  if (!data) redirect('/sign-in?from=/family/seva');
  const view = await getFamilySevaView(data.family.fid);
  const members = data.members.map((m) => ({ mid: m.mid, name: `${m.firstName} ${m.lastName}`.trim() }));
  return (
    <SevaBrowser
      currentSevaYear={view.currentSevaYear}
      hoursPerYear={view.hoursPerYear}
      initialOpportunities={view.opportunities}
      initialMySignups={view.mySignups}
      members={members}
    />
  );
}

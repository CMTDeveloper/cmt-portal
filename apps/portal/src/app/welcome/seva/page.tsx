import { connection } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { SchoolYearScopeBar } from '@/features/setu/rollover/components/school-year-scope-bar';
import { SevaManager } from '@/features/admin/seva/seva-manager';
import { denyUnlessAdmin } from '@/lib/require-admin-page';

export const metadata = { title: 'Seva' };

export default async function WelcomeSevaPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await connection();
  const denied = await denyUnlessAdmin();
  if (denied) return denied;
  // denyUnlessAdmin above is the only way past this line, so the requirement
  // editor is unconditionally available; this used to re-read the cookie to
  // decide, back when welcome-team could reach the page read-only.
  const canEditRequirement = true;
  const db = portalFirestore();
  const liveYear = await getLiveSchoolYearCached();
  const years = await listKnownSchoolYears(db, liveYear);
  const view = resolveViewYear(years, liveYear, (await searchParams).year ?? null);
  const [requirement, opportunities] = await Promise.all([
    getSevaRequirement(),
    listOpportunities({ sevaYear: view.year }),
  ]);
  const manager = (
    <SevaManager
      initialRequirement={requirement}
      initialOpportunities={opportunities.map(serializeOpportunity)}
      canEditRequirement={canEditRequirement}
      readOnly={view.status === 'past'}
      canCreate={view.status === 'live'}
    />
  );
  // The scope bar moved out of the welcome layout onto the pages that read
  // `?year=`. This one drives readOnly/canCreate above, so losing it would
  // strand a past-year view with no way back.
  const scopeBar = <SchoolYearScopeBar years={years} liveYear={liveYear} canManage={canEditRequirement} />;
  return (
    <>
      {/* Mobile — the welcome layout's mobile branch gives no padding, so the
          page owns it; bottom padding clears the fixed mobile nav. */}
      <div className="block md:hidden" style={{ padding: '16px 18px 96px' }}>
        {scopeBar}
        {manager}
      </div>
      {/* Desktop — layout.tsx owns the sidebar + padded <main>; just cap width. */}
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        {scopeBar}
        {manager}
      </div>
    </>
  );
}

import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';
import { listKnownSchoolYears, resolveViewYear } from '@/features/setu/rollover/view-year';
import { SevaManager } from '@/features/admin/seva/seva-manager';

export const metadata = { title: 'Seva' };

export default async function WelcomeSevaPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  const canEditRequirement = !!raw && isAdmin(raw as unknown as WithRole);
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
  return (
    <>
      {/* Mobile — the welcome layout's mobile branch gives no padding, so the
          page owns it; bottom padding clears the fixed mobile nav. */}
      <div className="block md:hidden" style={{ padding: '16px 18px 96px' }}>
        {manager}
      </div>
      {/* Desktop — layout.tsx owns the sidebar + padded <main>; just cap width. */}
      <div className="hidden md:block" style={{ maxWidth: 760 }}>
        {manager}
      </div>
    </>
  );
}

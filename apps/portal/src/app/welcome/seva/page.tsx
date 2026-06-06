import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';
import { SevaManager } from '@/features/admin/seva/seva-manager';

export const metadata = { title: 'Seva — CMT Portal' };

export default async function WelcomeSevaPage() {
  await connection();
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  const canEditRequirement = !!raw && isAdmin(raw as unknown as WithRole);
  const [requirement, opportunities] = await Promise.all([getSevaRequirement(), listOpportunities()]);
  return (
    <SevaManager
      initialRequirement={requirement}
      initialOpportunities={opportunities.map(serializeOpportunity)}
      canEditRequirement={canEditRequirement}
    />
  );
}

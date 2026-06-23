import { cacheTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getSchoolYearConfig } from './school-year-config';

/** The live (operational) school year, cached. Busted by
 *  revalidateTag('school-year') when an admin Activates a new year. */
export async function getLiveSchoolYearCached(): Promise<string> {
  'use cache';
  cacheTag('school-year');
  const { currentYear } = await getSchoolYearConfig(portalFirestore());
  return currentYear;
}

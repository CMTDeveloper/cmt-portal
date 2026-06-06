import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listCompletedSignupsForYear } from './get-signups';

export interface SetuFamilyLite {
  fid: string;
  name: string;
}

/** Every registered Setu family, lightweight (fid + display name only). */
export async function listAllSetuFamilies(): Promise<SetuFamilyLite[]> {
  const snap = await portalFirestore().collection('families').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      fid: (data['fid'] as string | undefined) ?? d.id,
      name: (data['name'] as string | undefined) ?? d.id,
    };
  });
}

export interface ComplianceRow {
  fid: string;
  name: string;
  hoursEarned: number;
  met: boolean;
}

export interface SevaCompliance {
  currentSevaYear: string | null;
  hoursPerYear: number;
  rows: ComplianceRow[];
  summary: { totalFamilies: number; metCount: number; shortCount: number };
}

/**
 * Builds the seva-hours compliance report for the active year: every
 * registered family left-joined against its completed signups. Families with
 * zero hours still appear (at "0 of {hoursPerYear}"). Rows are returned
 * short-first so the families needing attention lead the list.
 */
export async function getSevaCompliance(): Promise<SevaCompliance> {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return {
      currentSevaYear: null,
      hoursPerYear,
      rows: [],
      summary: { totalFamilies: 0, metCount: 0, shortCount: 0 },
    };
  }

  const [families, completed] = await Promise.all([
    listAllSetuFamilies(),
    listCompletedSignupsForYear(currentSevaYear),
  ]);

  const hoursByFid = new Map<string, number>();
  for (const s of completed) hoursByFid.set(s.fid, (hoursByFid.get(s.fid) ?? 0) + (s.hoursAwarded ?? 0));

  const rows = families
    .map((f) => {
      const hoursEarned = hoursByFid.get(f.fid) ?? 0;
      return { fid: f.fid, name: f.name, hoursEarned, met: hoursEarned >= hoursPerYear };
    })
    .sort((a, b) => a.hoursEarned - b.hoursEarned || a.name.localeCompare(b.name));

  const metCount = rows.filter((r) => r.met).length;
  return {
    currentSevaYear,
    hoursPerYear,
    rows,
    summary: { totalFamilies: rows.length, metCount, shortCount: rows.length - metCount },
  };
}

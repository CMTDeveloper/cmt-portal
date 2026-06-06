import { getSevaRequirement } from '@/lib/seva-requirement';
import { listFamilySignups } from './get-signups';

export interface FamilySevaProgress {
  currentSevaYear: string | null;
  hoursPerYear: number;
  hoursEarned: number;
}

export async function getFamilySevaProgress(fid: string): Promise<FamilySevaProgress> {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) return { currentSevaYear: null, hoursPerYear, hoursEarned: 0 };
  const signups = await listFamilySignups(fid);
  const hoursEarned = signups
    .filter((s) => s.sevaYear === currentSevaYear && s.status === 'completed')
    .reduce((sum, s) => sum + (s.hoursAwarded ?? 0), 0);
  return { currentSevaYear, hoursPerYear, hoursEarned };
}

export interface SevaCardView {
  show: boolean;
  pct: number;
  remaining: number;
  complete: boolean;
}

// Pure derivation for the dashboard card — unit-tested without Firestore.
export function deriveSevaCardView(p: FamilySevaProgress): SevaCardView {
  if (p.currentSevaYear == null) {
    return { show: false, pct: 0, remaining: p.hoursPerYear, complete: false };
  }
  const pct = p.hoursPerYear > 0 ? Math.min(100, Math.round((p.hoursEarned / p.hoursPerYear) * 100)) : 0;
  const remaining = Math.max(0, p.hoursPerYear - p.hoursEarned);
  return { show: true, pct, remaining, complete: p.hoursEarned >= p.hoursPerYear };
}

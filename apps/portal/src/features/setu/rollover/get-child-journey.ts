import type { LevelDoc } from '@cmt/shared-domain';
import { buildLevelSnapshot } from './school-year';

type Db = FirebaseFirestore.Firestore;
type LevelLite = Pick<LevelDoc, 'levelId' | 'levelName' | 'levelKind' | 'gradeBand'>;

/** One year of a child's Bala Vihar history — newest-first when returned. */
export interface JourneyRow {
  termLabel: string;
  schoolGrade: string | null;
  levelName: string | null;
  active: boolean; // status === 'active'
}

export interface JourneyInput {
  fid: string;
  mid: string;
  member: { schoolGrade: string | null; birthMonthYear: string | null };
}

/** A BV enrollment if its programKey says so, or (back-compat) its oid is bv-*. */
function isBalaVihar(data: Record<string, unknown>): boolean {
  const programKey = data['programKey'];
  if (typeof programKey === 'string' && programKey.length > 0) return programKey === 'bala-vihar';
  const oid = data['oid'];
  return typeof oid === 'string' && oid.startsWith('bv-');
}

function mapLevels(docs: Array<{ data: () => Record<string, unknown> }>): LevelLite[] {
  return docs.map((d) => {
    const data = d.data();
    return {
      levelId: String(data['levelId']),
      levelName: String(data['levelName']),
      levelKind: data['levelKind'] as LevelLite['levelKind'],
      gradeBand: (data['gradeBand'] as string[]) ?? [],
    };
  });
}

/**
 * A child's year-by-year Bala Vihar grade + level, newest first.
 *
 * History rows come from the enrollment's `levelSnapshots[mid]`, written by the
 * promotion engine when a year is closed. The CURRENT active year predates any
 * promotion (no snapshot yet), so its row is derived LIVE from the child's
 * current grade against that offering's levels — exactly what the next promotion
 * run would snapshot.
 */
export async function getChildBalaViharJourney(db: Db, input: JourneyInput): Promise<JourneyRow[]> {
  const { fid, mid } = input;
  const snap = await db.collection('families').doc(fid).collection('enrollments').get();

  // Per-pid level cache so a multi-year history doesn't refetch the same levels.
  const levelsByPid = new Map<string, LevelLite[]>();
  async function levelsFor(pid: string): Promise<LevelLite[]> {
    const cached = levelsByPid.get(pid);
    if (cached) return cached;
    const lvlSnap = await db.collection('levels').where('pid', '==', pid).get();
    const levels = mapLevels(lvlSnap.docs);
    levelsByPid.set(pid, levels);
    return levels;
  }

  const now = new Date();
  const rows: JourneyRow[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!isBalaVihar(data)) continue;

    const enrolledMids = (data['enrolledMids'] as string[] | undefined) ?? [];
    const snapshots = data['levelSnapshots'] as
      | Record<string, { schoolGrade: string | null; levelName: string | null }>
      | undefined;
    const hasSnapshot = Boolean(snapshots && Object.prototype.hasOwnProperty.call(snapshots, mid));

    // This enrollment is part of the child's journey if they're enrolled in it
    // OR they have a recorded snapshot for it.
    if (!enrolledMids.includes(mid) && !hasSnapshot) continue;

    const termLabel = String(data['termLabel'] ?? '');
    const active = data['status'] === 'active';

    if (hasSnapshot && snapshots) {
      const s = snapshots[mid]!;
      rows.push({ termLabel, schoolGrade: s.schoolGrade ?? null, levelName: s.levelName ?? null, active });
      continue;
    }

    // No snapshot — derive live from the child's current grade against this
    // offering's levels (the pre-promotion current year).
    const pid = (data['pid'] as string | undefined) ?? (data['oid'] as string | undefined) ?? '';
    const levels = pid ? await levelsFor(pid) : [];
    const derived = buildLevelSnapshot(input.member, levels, now);
    rows.push({ termLabel, schoolGrade: derived.schoolGrade, levelName: derived.levelName, active });
  }

  rows.sort((a, b) => b.termLabel.localeCompare(a.termLabel));
  return rows;
}

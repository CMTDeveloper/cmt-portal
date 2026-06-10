import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { GRADE_LADDER, normalizeGrade, type PrasadEngineFamily, type PrasadEngineInput } from '@cmt/shared-domain';
import { torontoToday } from './constants';

const RUNG = new Map<string, number>(GRADE_LADDER.map((g, i) => [normalizeGrade(g), i]));

function gradeRung(schoolGrade: string | null): number | null {
  if (!schoolGrade || schoolGrade.trim() === '') return null;
  return RUNG.get(normalizeGrade(schoolGrade)) ?? null;
}

function monthOfBmy(birthMonthYear: string | null): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(birthMonthYear ?? '');
  return m ? Number(m[1]) : null;
}

export interface LoadedEngineInput {
  input: PrasadEngineInput;
  defaultCap: number;
  eligibleSundayCount: number;
}

/** Load everything proposePrasadAssignments needs for one (pid, location). */
export async function loadEngineInput(pid: string, location: string, cap?: number): Promise<LoadedEngineInput> {
  const db = portalFirestore();
  const todayYmd = torontoToday();

  // 1) Eligible Sundays: class + enabled + prasadNeeded, future-only.
  const calSnap = await db.collection('classCalendarEntries')
    .where('location', '==', location).where('programKey', '==', 'bala-vihar').get();
  const sundays = calSnap.docs
    .map((d) => d.data() as { date: string; kind: string; enabled?: boolean; prasadNeeded?: boolean })
    .filter((e) => e.kind === 'class' && e.enabled !== false && e.prasadNeeded !== false && e.date > todayYmd)
    .map((e) => ({ date: e.date }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2) Active enrollments for this pid at this location (existing composite
  //    index enrollments(pid,status) COLLECTION_GROUP backs this).
  const enrollSnap = await db.collectionGroup('enrollments')
    .where('pid', '==', pid).where('status', '==', 'active').get();
  const enrolledMidsByFid = new Map<string, Set<string>>();
  for (const d of enrollSnap.docs) {
    const e = d.data() as { fid?: string; location?: string; enrolledMids?: string[] };
    if (e.location !== location || typeof e.fid !== 'string') continue;
    const set = enrolledMidsByFid.get(e.fid) ?? new Set<string>();
    for (const m of e.enrolledMids ?? []) set.add(m);
    enrolledMidsByFid.set(e.fid, set);
  }

  // 3) Existing assignments for this pid.
  const assignSnap = await db.collection('prasadAssignments').where('pid', '==', pid).get();
  const existingByFid = new Map<string, { date: string }>();
  for (const d of assignSnap.docs) {
    const a = d.data() as { fid: string; date: string; status: string };
    if (a.status === 'assigned') existingByFid.set(a.fid, { date: a.date });
  }

  // 4) Family + member docs (bulk per family — same shape as deriveRoster).
  const fids = [...enrolledMidsByFid.keys()];
  const families: PrasadEngineFamily[] = await Promise.all(fids.map(async (fid): Promise<PrasadEngineFamily> => {
    const [famDoc, memSnap] = await Promise.all([
      db.collection('families').doc(fid).get(),
      db.collection('families').doc(fid).collection('members').get(),
    ]);
    const enrolled = enrolledMidsByFid.get(fid)!;
    const children = memSnap.docs
      .map((d) => d.data() as { mid: string; firstName?: string; lastName?: string; type?: string; schoolGrade?: string | null; birthMonth?: number | null; birthMonthYear?: string | null })
      .filter((m) => m.type === 'Child' && enrolled.has(m.mid))
      .map((m) => ({
        mid: m.mid,
        name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.mid,
        gradeRung: gradeRung(m.schoolGrade ?? null),
        birthMonth: m.birthMonth ?? monthOfBmy(m.birthMonthYear ?? null),
      }));
    return {
      fid,
      familyName: (famDoc.data()?.name as string | undefined) ?? fid,
      children,
      existing: existingByFid.get(fid) ?? null,
    };
  }));

  const defaultCap = sundays.length > 0 ? Math.ceil(families.length / sundays.length) : 1;
  return {
    input: { pid, location, cap: cap ?? defaultCap, sundays, families },
    defaultCap,
    eligibleSundayCount: sundays.length,
  };
}

import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { AttendanceReport, ReportQuery } from '@cmt/shared-domain';

type Tally = { present: number; absent: number; late: number };
const zero = (): Tally => ({ present: 0, absent: 0, late: 0 });

// Attendance is sourced from levels (which carry programKey but no display
// label), so derive a readable label from the slug: "bala-vihar" → "Bala Vihar".
// This keeps the attendance card consistent with the enrollment/donations
// reports, which use stored labels of the same form.
function titleCaseProgram(programKey: string): string {
  return programKey
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
function rate(t: Tally): { total: number; rate: number } {
  const total = t.present + t.absent + t.late;
  return { total, rate: total === 0 ? 0 : (t.present + t.late) / total };
}

export async function buildAttendanceReport(params: ReportQuery & { from: string; to: string }): Promise<AttendanceReport> {
  const db = portalFirestore();
  const [evSnap, lvlSnap] = await Promise.all([
    db.collection('attendanceEvents').where('date', '>=', params.from).where('date', '<=', params.to).get(),
    db.collection('levels').get(),
  ]);

  const levelMeta = new Map<string, { name: string; programKey: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown };
    levelMeta.set(d.id, { name: typeof x.levelName === 'string' ? x.levelName : d.id, programKey: String(x.programKey ?? '') });
  }

  const byLevel = new Map<string, Tally>();
  const byProgram = new Map<string, Tally>();
  const programLabel = new Map<string, string>();
  let totalEvents = 0;

  for (const d of evSnap.docs) {
    const e = d.data() as { levelId?: unknown; status?: unknown };
    const levelId = String(e.levelId ?? '');
    const status = e.status === 'present' || e.status === 'absent' || e.status === 'late' ? e.status : null;
    if (!levelId || !status) continue;
    const programKey = levelMeta.get(levelId)?.programKey ?? '';
    if (params.program && programKey !== params.program) continue;
    totalEvents++;
    if (!byLevel.has(levelId)) byLevel.set(levelId, zero());
    byLevel.get(levelId)![status]++;
    if (programKey) {
      if (!byProgram.has(programKey)) byProgram.set(programKey, zero());
      byProgram.get(programKey)![status]++;
      programLabel.set(programKey, titleCaseProgram(programKey));
    }
  }

  return {
    byLevel: [...byLevel.entries()].map(([levelId, t]) => {
      const m = levelMeta.get(levelId);
      return { levelId, levelName: m?.name ?? levelId, programKey: m?.programKey ?? '', ...t, ...rate(t) };
    }).sort((a, b) => a.levelName.localeCompare(b.levelName)),
    byProgram: [...byProgram.entries()].map(([programKey, t]) => ({
      programKey, programLabel: programLabel.get(programKey) ?? programKey, ...t, ...rate(t),
    })).sort((a, b) => a.programKey.localeCompare(b.programKey)),
    from: params.from, to: params.to, totalEvents,
  };
}

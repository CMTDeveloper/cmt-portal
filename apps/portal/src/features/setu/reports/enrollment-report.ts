import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { EnrollmentReport, ReportQuery } from '@cmt/shared-domain';

type RawEnr = {
  fid?: unknown; programKey?: unknown; programLabel?: unknown; status?: unknown;
  enrolledMids?: unknown; levelSnapshots?: unknown; termLabel?: unknown;
};

export async function buildEnrollmentReport(params: ReportQuery): Promise<EnrollmentReport> {
  const db = portalFirestore();
  const [enrSnap, lvlSnap] = await Promise.all([
    db.collectionGroup('enrollments').get(),
    db.collection('levels').get(),
  ]);

  const levelName = new Map<string, { name: string; programKey: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown };
    levelName.set(d.id, { name: typeof x.levelName === 'string' ? x.levelName : d.id, programKey: String(x.programKey ?? '') });
  }

  const byProgramFamilies = new Map<string, Set<string>>();
  const byProgramMembers = new Map<string, Set<string>>();
  const programLabels = new Map<string, string>();
  const byLevelMembers = new Map<string, Set<string>>(); // levelId → mids
  let totalActiveEnrollments = 0;
  const allMembers = new Set<string>();

  for (const d of enrSnap.docs) {
    const e = d.data() as RawEnr;
    if (e.status !== 'active') continue;
    // Year scope (in-memory, no index): the read is already unfiltered.
    if (params.year && String(e.termLabel ?? '') !== params.year) continue;
    const programKey = String(e.programKey ?? '');
    if (!programKey) continue;
    if (params.program && programKey !== params.program) continue;
    const fid = String(e.fid ?? '');
    const mids = Array.isArray(e.enrolledMids) ? e.enrolledMids.map(String) : [];
    totalActiveEnrollments++;
    programLabels.set(programKey, typeof e.programLabel === 'string' ? e.programLabel : programKey);
    if (!byProgramFamilies.has(programKey)) { byProgramFamilies.set(programKey, new Set()); byProgramMembers.set(programKey, new Set()); }
    if (fid) byProgramFamilies.get(programKey)!.add(fid);
    for (const mid of mids) { byProgramMembers.get(programKey)!.add(mid); allMembers.add(mid); }
    const snaps = (e.levelSnapshots && typeof e.levelSnapshots === 'object') ? (e.levelSnapshots as Record<string, { levelId?: unknown }>) : {};
    for (const [mid, snap] of Object.entries(snaps)) {
      const levelId = typeof snap?.levelId === 'string' ? snap.levelId : null;
      if (!levelId) continue;
      if (!byLevelMembers.has(levelId)) byLevelMembers.set(levelId, new Set());
      byLevelMembers.get(levelId)!.add(mid);
    }
  }

  const byProgram = [...byProgramFamilies.keys()].sort().map((programKey) => ({
    programKey,
    programLabel: programLabels.get(programKey) ?? programKey,
    families: byProgramFamilies.get(programKey)!.size,
    members: byProgramMembers.get(programKey)!.size,
  }));

  const byLevel = [...byLevelMembers.keys()]
    .map((levelId) => {
      const meta = levelName.get(levelId);
      return { levelId, levelName: meta?.name ?? levelId, programKey: meta?.programKey ?? '', members: byLevelMembers.get(levelId)!.size };
    })
    .filter((l) => !params.program || l.programKey === params.program)
    .sort((a, b) => a.levelName.localeCompare(b.levelName));

  return { byProgram, byLevel, totalActiveEnrollments, totalMembers: allMembers.size };
}

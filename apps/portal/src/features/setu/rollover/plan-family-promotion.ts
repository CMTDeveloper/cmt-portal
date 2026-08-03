import { decidePromotion, isParticipating, type LevelSnapshot, type PromotionRow } from '@cmt/shared-domain';
import { buildLevelSnapshot } from './school-year';

interface MemberLite {
  mid: string; firstName: string; lastName: string;
  type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null;
  participation?: string | null;
}
interface LevelLite {
  levelId: string; levelName: string;
  levelKind: 'shishu' | 'pre-level' | 'level' | 'parents'; gradeBand: string[];
}
export interface PlanInput {
  fid: string; location: string | null; enrolledMids: string[];
  members: MemberLite[]; srcLevels: LevelLite[]; tgtLevels: LevelLite[]; now: Date;
}
export interface FamilyPromotionPlan {
  fid: string;
  promotedMids: string[];
  gradeUpdates: { mid: string; schoolGrade: string }[];
  /**
   * Children who aged out of the programme this rollover.
   *
   * Recorded because until now graduation left NO trace: the rollover counted
   * graduates and wrote nothing, so a grade-12 graduate and a current grade-12
   * student were indistinguishable afterwards. That is why the family has to be
   * ASKED what a finished child should become - the system cannot tell.
   *
   * Deliberately NOT auto-deactivation: a graduate may stay on as an adult
   * member. This marks the event; the family decides what it means.
   */
  graduatedMids: string[];
  sourceSnapshots: Record<string, LevelSnapshot>;
  targetSnapshots: Record<string, LevelSnapshot>;
  rows: PromotionRow[];
}

/**
 * Pure promotion planner for ONE family. Grade-driven: advance each child's
 * grade one rung (decidePromotion) and re-derive the level from the band.
 * Snapshots the pre-advance grade/level (source) and the new grade/level
 * (target). Graduates / shishu-aged-out / needs-grade are flagged via the row
 * but NOT promoted and NOT grade-updated. N=2 safe (each child independent).
 */
export function planFamilyPromotion(input: PlanInput): FamilyPromotionPlan {
  const byMid = new Map(input.members.map((m) => [m.mid, m]));
  const plan: FamilyPromotionPlan = {
    fid: input.fid, promotedMids: [], gradeUpdates: [], graduatedMids: [],
    sourceSnapshots: {}, targetSnapshots: {}, rows: [],
  };

  for (const mid of input.enrolledMids) {
    const m = byMid.get(mid);
    if (!m || m.type !== 'Child') continue; // BV enrolledMids are children
    // Never promote or graduate someone who has stopped attending. The mid can
    // still be on a PRIOR-year enrollment (this reads last year's roster to
    // build next year's), so reconciliation pruning the current one does not
    // cover this - and a retired child silently gaining a grade every August is
    // how "why is my son in Grade 9?" starts.
    if (!isParticipating(m)) continue;
    const src = buildLevelSnapshot(m, input.srcLevels, input.now); // this-year (pre-advance)
    plan.sourceSnapshots[mid] = src;
    const outcome = decidePromotion(m, input.now);
    const row: PromotionRow = {
      fid: input.fid, mid, childName: `${m.firstName} ${m.lastName}`.trim(),
      location: input.location, outcomeKind: outcome.kind,
      fromGrade: src.schoolGrade, fromLevelName: src.levelName,
      toGrade: null, toLevelName: null,
    };
    if (outcome.kind === 'advance') {
      plan.gradeUpdates.push({ mid, schoolGrade: outcome.to });
      const tgt = buildLevelSnapshot({ schoolGrade: outcome.to, birthMonthYear: m.birthMonthYear }, input.tgtLevels, input.now);
      plan.targetSnapshots[mid] = tgt;
      plan.promotedMids.push(mid);
      row.toGrade = outcome.to;
      row.toLevelName = tgt.levelName;
    } else if (outcome.kind === 'shishu-stays') {
      const tgt = buildLevelSnapshot({ schoolGrade: null, birthMonthYear: m.birthMonthYear }, input.tgtLevels, input.now);
      plan.targetSnapshots[mid] = tgt;
      plan.promotedMids.push(mid);
      row.toGrade = null;
      row.toLevelName = tgt.levelName;
    }
    if (outcome.kind === 'graduate') plan.graduatedMids.push(mid);
    // graduate / shishu-aged-out / needs-grade → no promotion, no grade update.
    plan.rows.push(row);
  }
  return plan;
}

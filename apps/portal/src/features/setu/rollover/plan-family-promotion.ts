import { decidePromotion, type LevelSnapshot, type PromotionRow } from '@cmt/shared-domain';
import { buildLevelSnapshot } from './school-year';

interface MemberLite {
  mid: string; firstName: string; lastName: string;
  type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null;
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
    fid: input.fid, promotedMids: [], gradeUpdates: [],
    sourceSnapshots: {}, targetSnapshots: {}, rows: [],
  };

  for (const mid of input.enrolledMids) {
    const m = byMid.get(mid);
    if (!m || m.type !== 'Child') continue; // BV enrolledMids are children
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
    // graduate / shishu-aged-out / needs-grade → no promotion, no grade update.
    plan.rows.push(row);
  }
  return plan;
}

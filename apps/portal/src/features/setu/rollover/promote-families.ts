import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  resolveSuggestedAmount,
  type LevelDoc,
  type OfferingDoc,
  type PromotionRow,
  type RolloverReport,
} from '@cmt/shared-domain';
import { BV_SOURCE_OIDS, DEFAULT_FROM_YEAR, DEFAULT_TO_YEAR, targetOidOf } from './school-year';
import { planFamilyPromotion, type FamilyPromotionPlan } from './plan-family-promotion';

type Db = FirebaseFirestore.Firestore;

export interface PromoteArgs {
  fromYear?: string;
  toYear?: string;
  actorMid?: string;
  dryRun: boolean;
  limit?: number;
  fidFilter?: string;
}

/** Cap rows we keep on a commit run so a 800-family roster doesn't bloat the report. */
const COMMIT_ROW_CAP = 500;

type LevelLite = Pick<LevelDoc, 'levelId' | 'levelName' | 'levelKind' | 'gradeBand'>;
interface MemberLite {
  mid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  birthMonthYear: string | null;
}

/** Per-sourceOid resolved context: target oid + levels + offering pricing/labels. */
interface SourceContext {
  sourceOid: string;
  targetOid: string;
  srcLevels: LevelLite[];
  tgtLevels: LevelLite[];
  pricingTiers: OfferingDoc['pricingTiers'];
  // Fallbacks pulled from the source enrollment when the target offering is missing.
  programKey: string | null;
  programLabel: string | null;
  location: LevelDoc['location'];
}

/** One discoverable family with an active source enrollment, tagged with its context. */
interface FamilyEntry {
  fid: string;
  enrolledMids: string[];
  location: LevelDoc['location'];
  programKey: string;
  programLabel: string;
  ctx: SourceContext;
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

async function buildSourceContext(db: Db, sourceOid: string, fromYear: string, toYear: string): Promise<SourceContext> {
  const targetOid = targetOidOf(sourceOid, fromYear, toYear);

  const [srcLevelsSnap, tgtLevelsSnap, offeringSnap] = await Promise.all([
    db.collection('levels').where('pid', '==', sourceOid).get(),
    db.collection('levels').where('pid', '==', targetOid).get(),
    db.collection('offerings').doc(targetOid).get(),
  ]);

  const srcLevels = mapLevels(srcLevelsSnap.docs);
  const tgtLevels = mapLevels(tgtLevelsSnap.docs);

  let pricingTiers: SourceContext['pricingTiers'] = [];
  let programKey: string | null = null;
  let programLabel: string | null = null;
  let location: LevelDoc['location'] = null;
  if (offeringSnap.exists) {
    const od = offeringSnap.data() as Record<string, unknown>;
    pricingTiers = (od['pricingTiers'] as SourceContext['pricingTiers']) ?? [];
    programKey = (od['programKey'] as string | undefined) ?? null;
    programLabel = (od['programLabel'] as string | undefined) ?? null;
    location = (od['location'] ?? null) as LevelDoc['location'];
  }

  return { sourceOid, targetOid, srcLevels, tgtLevels, pricingTiers, programKey, programLabel, location };
}

/** Discover every family with an ACTIVE source enrollment via a collectionGroup sweep. */
async function discoverFamilies(db: Db, ctx: SourceContext): Promise<FamilyEntry[]> {
  const snap = await db
    .collectionGroup('enrollments')
    .where('oid', '==', ctx.sourceOid)
    .where('status', '==', 'active')
    .get();

  const entries: FamilyEntry[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const fid = data['fid'] as string | undefined;
    if (!fid) continue; // defensive — every enrollment carries fid
    entries.push({
      fid,
      enrolledMids: (data['enrolledMids'] as string[]) ?? [],
      location: (data['location'] ?? null) as LevelDoc['location'],
      programKey: (data['programKey'] as string | undefined) ?? '',
      programLabel: (data['programLabel'] as string | undefined) ?? '',
      ctx,
    });
  }
  return entries;
}

function mapMembers(docs: Array<{ data: () => Record<string, unknown> }>): MemberLite[] {
  return docs.map((d) => {
    const m = d.data();
    return {
      mid: String(m['mid']),
      firstName: (m['firstName'] as string | undefined) ?? '',
      lastName: (m['lastName'] as string | undefined) ?? '',
      type: (m['type'] as 'Adult' | 'Child' | undefined) ?? 'Child',
      schoolGrade: (m['schoolGrade'] ?? null) as string | null,
      birthMonthYear: (m['birthMonthYear'] ?? null) as string | null,
    };
  });
}

/** Mutable accumulator folded into the final RolloverReport. */
interface Acc {
  familiesProcessed: number;
  familiesSkippedAlreadyPromoted: number;
  promoted: number;
  advanced: number;
  shishuStayed: number;
  graduated: number;
  needsAttention: number;
  byTransition: Map<string, number>;
  graduates: PromotionRow[];
  attention: PromotionRow[];
  rows: PromotionRow[];
  // fids actually written on a commit run (uncapped); stays empty on dry-run.
  affectedFids: string[];
}

function newAcc(): Acc {
  return {
    familiesProcessed: 0,
    familiesSkippedAlreadyPromoted: 0,
    promoted: 0,
    advanced: 0,
    shishuStayed: 0,
    graduated: 0,
    needsAttention: 0,
    byTransition: new Map<string, number>(),
    graduates: [],
    attention: [],
    rows: [],
    affectedFids: [],
  };
}

/**
 * A family "progressed" if any child advanced, graduated, or stayed in shishu.
 * An all-needs-attention family (every child is needs-grade / shishu-aged-out)
 * must NOT have its source enrollment cancelled — those children need a human
 * to fix their data before the next run can pick them up.
 */
function familyProgressed(plan: FamilyPromotionPlan): boolean {
  return plan.promotedMids.length > 0 || plan.rows.some((r) => r.outcomeKind === 'graduate');
}

/** Fold one family's plan into the accumulator. */
function aggregate(acc: Acc, plan: FamilyPromotionPlan, dryRun: boolean): void {
  acc.promoted += plan.promotedMids.length;
  for (const row of plan.rows) {
    switch (row.outcomeKind) {
      case 'advance':
        acc.advanced++;
        break;
      case 'shishu-stays':
        acc.shishuStayed++;
        break;
      case 'graduate':
        acc.graduated++;
        acc.graduates.push(row);
        break;
      case 'shishu-aged-out':
      case 'needs-grade':
        acc.needsAttention++;
        acc.attention.push(row);
        break;
    }
    // byTransition is over PROMOTED rows only (advance + shishu-stays).
    if (row.outcomeKind === 'advance' || row.outcomeKind === 'shishu-stays') {
      const label = `${row.fromLevelName ?? '—'} → ${row.toLevelName ?? '—'}`;
      acc.byTransition.set(label, (acc.byTransition.get(label) ?? 0) + 1);
    }
    if (dryRun || acc.rows.length < COMMIT_ROW_CAP) acc.rows.push(row);
  }
}

export async function promoteFamilies(db: Db, args: PromoteArgs): Promise<RolloverReport> {
  const fromYear = args.fromYear ?? DEFAULT_FROM_YEAR;
  const toYear = args.toYear ?? DEFAULT_TO_YEAR;
  const now = new Date();

  // 1. Build per-sourceOid context.
  const contexts = await Promise.all(
    BV_SOURCE_OIDS.map((sourceOid) => buildSourceContext(db, sourceOid, fromYear, toYear)),
  );

  // 2. Discover families across all source offerings.
  let families: FamilyEntry[] = [];
  for (const ctx of contexts) {
    families = families.concat(await discoverFamilies(db, ctx));
  }
  if (args.fidFilter) families = families.filter((f) => f.fid === args.fidFilter);
  if (args.limit != null) families = families.slice(0, args.limit);

  const acc = newAcc();

  // 3. Process each family.
  for (const fam of families) {
    const { ctx } = fam;
    const tgtEid = `${fam.fid}-${ctx.targetOid}`;
    const srcEid = `${fam.fid}-${ctx.sourceOid}`;
    const enrollmentsCol = db.collection('families').doc(fam.fid).collection('enrollments');
    const membersCol = db.collection('families').doc(fam.fid).collection('members');
    const tgtRef = enrollmentsCol.doc(tgtEid);
    const srcRef = enrollmentsCol.doc(srcEid);

    const programKey = ctx.programKey ?? fam.programKey;
    const programLabel = ctx.programLabel ?? fam.programLabel;
    const location = ctx.location ?? fam.location;

    if (args.dryRun) {
      // Match commit semantics: already-promoted families are skipped (not counted).
      const tgtSnap = await tgtRef.get();
      if (tgtSnap.exists && (tgtSnap.data() as Record<string, unknown>)['status'] === 'active') {
        acc.familiesSkippedAlreadyPromoted++;
        continue;
      }
      const membersSnap = await membersCol.get();
      const members = mapMembers(membersSnap.docs);
      const plan = planFamilyPromotion({
        fid: fam.fid,
        location,
        enrolledMids: fam.enrolledMids,
        members,
        srcLevels: ctx.srcLevels,
        tgtLevels: ctx.tgtLevels,
        now,
      });
      acc.familiesProcessed++;
      aggregate(acc, plan, true);
      continue;
    }

    // Commit path — one atomic transaction per family.
    const plan = await db.runTransaction(async (txn) => {
      // READS FIRST.
      const tgtSnap = await txn.get(tgtRef);
      if (tgtSnap.exists && (tgtSnap.data() as Record<string, unknown>)['status'] === 'active') {
        return null; // already promoted → skip sentinel
      }
      const membersSnap = await txn.get(membersCol);
      const members = mapMembers(membersSnap.docs);
      const familyPlan = planFamilyPromotion({
        fid: fam.fid,
        location,
        // NOTE: enrolledMids comes from the pre-txn discovery snapshot, not re-read
        // inside the txn. This batch is admin-triggered and effectively single-writer
        // (once-a-year), so a concurrent enrolledMids edit between discovery and
        // commit is not a concern.
        enrolledMids: fam.enrolledMids,
        members,
        srcLevels: ctx.srcLevels,
        tgtLevels: ctx.tgtLevels,
        now,
      });

      // WRITES — only when the family made progress (at least one child
      // advanced, graduated, or stayed in shishu). A family whose every child
      // is needs-grade / shishu-aged-out keeps its source enrollment ACTIVE so
      // a re-run can pick it up once the data is corrected.
      if (familyProgressed(familyPlan)) {
        for (const upd of familyPlan.gradeUpdates) {
          txn.set(membersCol.doc(upd.mid), { schoolGrade: upd.schoolGrade }, { merge: true });
        }
        txn.set(
          srcRef,
          {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledReason: `promoted-${toYear}`,
            levelSnapshots: familyPlan.sourceSnapshots,
          },
          { merge: true },
        );
        if (familyPlan.promotedMids.length > 0) {
          txn.set(tgtRef, {
            eid: tgtEid,
            fid: fam.fid,
            oid: ctx.targetOid,
            pid: ctx.targetOid,
            programKey,
            programLabel,
            termLabel: toYear,
            location,
            enrolledAt: FieldValue.serverTimestamp(),
            enrolledVia: 'promotion',
            enrolledByMid: args.actorMid ?? null,
            enrolledMids: familyPlan.promotedMids,
            suggestedAmountSnapshot: resolveSuggestedAmount({ pricingTiers: ctx.pricingTiers }, now),
            suggestedAmountOverride: null,
            status: 'active',
            cancelledAt: null,
            cancelledReason: null,
            levelSnapshots: familyPlan.targetSnapshots,
          });
        }
      }
      return familyPlan;
    });

    if (plan === null) {
      acc.familiesSkippedAlreadyPromoted++;
    } else {
      acc.familiesProcessed++;
      aggregate(acc, plan, false);
      // Record the fid only when the txn actually wrote (family progressed); an
      // all-needs-attention family is examined but unmutated, so it must NOT be
      // revalidated. Uncapped — unlike `rows`.
      if (familyProgressed(plan)) acc.affectedFids.push(fam.fid);
    }
  }

  // 4. Assemble the report.
  const byTransition = [...acc.byTransition.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    fromYear,
    toYear,
    dryRun: args.dryRun,
    familiesProcessed: acc.familiesProcessed,
    familiesSkippedAlreadyPromoted: acc.familiesSkippedAlreadyPromoted,
    promoted: acc.promoted,
    advanced: acc.advanced,
    shishuStayed: acc.shishuStayed,
    graduated: acc.graduated,
    needsAttention: acc.needsAttention,
    byTransition,
    graduates: acc.graduates,
    attention: acc.attention,
    rows: acc.rows,
    affectedFids: acc.affectedFids,
  };
}

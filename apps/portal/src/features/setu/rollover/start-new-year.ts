import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR, type StartYearResult } from '@cmt/shared-domain';
import { targetOidOf } from './school-year';
import { resolveRolloverYearContext } from './school-year-config';

type Db = FirebaseFirestore.Firestore;

export interface StartArgs {
  fromYear?: string;
  toYear?: string;
  actorMid: string;
  dryRun: boolean;
}

/** Read a Firestore date field that may be a JS Date or a {toDate()} Timestamp. */
function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v as Date;
}

/** Same calendar month/day/time, one year later (UTC, the storage convention). */
function plusOneYear(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear() + 1,
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/**
 * Clone a school year's Bala Vihar levels + offerings (and the legacy
 * donationPeriods mirror) from `fromYear` to `toYear`. Idempotent: an existing
 * target doc is skipped and never overwritten — crucially preserving any
 * admin-assigned teacherRefs on a target level. `dryRun` computes the same
 * created/existing lists by reading existence but performs no writes.
 */
export async function startNewYear(db: Db, args: StartArgs): Promise<StartYearResult> {
  const { fromYear, toYear } = await resolveRolloverYearContext(db, args);

  const offeringsCreated: string[] = [];
  const offeringsExisting: string[] = [];
  const levelsCreated: string[] = [];
  const levelsExisting: string[] = [];
  const donationPeriodsCreated: string[] = [];

  // ── Source offerings ──────────────────────────────────────────────────────
  const offeringsSnap = await db
    .collection('offerings')
    .where('programKey', '==', BALA_VIHAR)
    .where('termLabel', '==', fromYear)
    .get();

  for (const offeringDoc of offeringsSnap.docs) {
    const src = offeringDoc.data();
    const sourceOid = String(src['oid']);
    const targetOid = targetOidOf(sourceOid, fromYear, toYear);

    // ── Offering ─────────────────────────────────────────────────────────────
    const targetOfferingRef = db.collection('offerings').doc(targetOid);
    const targetOfferingSnap = await targetOfferingRef.get();
    if (targetOfferingSnap.exists) {
      offeringsExisting.push(targetOid);
    } else {
      offeringsCreated.push(targetOid);
      if (!args.dryRun) {
        const startDate = plusOneYear(toDate(src['startDate']));
        const endDate = src['endDate'] != null ? plusOneYear(toDate(src['endDate'])) : null;
        const amountTiers = src['amountTiers'];
        await targetOfferingRef.set({
          oid: targetOid,
          programKey: src['programKey'],
          programLabel: src['programLabel'],
          location: src['location'],
          termLabel: toYear,
          termType: src['termType'],
          startDate,
          endDate,
          pricingTiers: src['pricingTiers'] ?? [],
          ...(amountTiers !== undefined ? { amountTiers } : {}),
          paymentSource: 'portal',
          enabled: true,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: args.actorMid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: args.actorMid,
        });
      }
    }

    // ── donationPeriods mirror (legacy admin levels-pid dropdown) ─────────────
    const dpRef = db.collection('donationPeriods').doc(targetOid);
    const dpSnap = await dpRef.get();
    if (!dpSnap.exists) {
      donationPeriodsCreated.push(targetOid);
      if (!args.dryRun) {
        const startDate = plusOneYear(toDate(src['startDate']));
        const endDate = src['endDate'] != null ? plusOneYear(toDate(src['endDate'])) : null;
        await dpRef.set({
          pid: targetOid,
          programKey: src['programKey'],
          programLabel: src['programLabel'],
          location: src['location'],
          periodLabel: toYear,
          startDate,
          endDate,
          pricingTiers: src['pricingTiers'] ?? [],
          paymentSource: 'portal',
          enabled: true,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: args.actorMid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: args.actorMid,
        });
      }
    }

    // ── Source levels for this offering ───────────────────────────────────────
    const levelsSnap = await db.collection('levels').where('pid', '==', sourceOid).get();
    for (const levelDoc of levelsSnap.docs) {
      const lvl = levelDoc.data();
      const sourceLevelId = String(lvl['levelId']);
      // Preserve the exact `{location}-{levelSlug}-` prefix; only the pid suffix swaps.
      // Suffix-anchor the swap so a levelSlug that happens to contain the oid string
      // can't be mangled by replacing the first occurrence.
      const newLevelId = sourceLevelId.endsWith(sourceOid)
        ? sourceLevelId.slice(0, -sourceOid.length) + targetOid
        : sourceLevelId.replace(sourceOid, targetOid);

      const targetLevelRef = db.collection('levels').doc(newLevelId);
      const targetLevelSnap = await targetLevelRef.get();
      if (targetLevelSnap.exists) {
        levelsExisting.push(newLevelId);
        continue; // never overwrite — preserves admin-assigned teacherRefs
      }
      levelsCreated.push(newLevelId);
      if (!args.dryRun) {
        await targetLevelRef.set({
          levelId: newLevelId,
          programKey: lvl['programKey'],
          location: lvl['location'],
          levelName: lvl['levelName'],
          levelKind: lvl['levelKind'],
          order: lvl['order'],
          gradeBand: lvl['gradeBand'],
          ageLabel: lvl['ageLabel'],
          curriculum: lvl['curriculum'],
          pid: targetOid,
          periodLabel: toYear,
          teacherRefs: [],
          enabled: true,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: args.actorMid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: args.actorMid,
        });
      }
    }
  }

  return {
    fromYear,
    toYear,
    offeringsCreated,
    offeringsExisting,
    levelsCreated,
    levelsExisting,
    donationPeriodsCreated,
  };
}

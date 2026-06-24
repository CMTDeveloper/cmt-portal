import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  SchoolYearConfigSchema,
  SevaRequirementConfigSchema,
  type SchoolYearConfig,
} from '@cmt/shared-domain';
import { DEFAULT_SEVA_REQUIREMENT } from '@/lib/seva-requirement';

type Db = FirebaseFirestore.Firestore;

const CONFIG_COLLECTION = 'app_config';
const SCHOOL_YEAR_DOC = 'school_year';
const SEVA_REQUIREMENT_DOC = 'seva_requirement';

export interface ActivateSchoolYearResult {
  config: SchoolYearConfig;
  /** The seva year, now aligned to the new live school year. */
  sevaYear: string;
}

/**
 * Atomically flip the live school year forward AND align seva's active year, in a
 * SINGLE Firestore transaction so the two `app_config` docs commit together or not
 * at all — neither can be left pointing at a different year if one write fails.
 * The existing seva requirement is read inside the transaction so `hoursPerYear`
 * is preserved (falling back to the default when the config has never been
 * written). The doc shapes mirror `setSchoolYearConfig()` / `setSevaRequirement()`.
 */
export async function activateSchoolYear(
  db: Db,
  args: { toYear: string; actorMid: string },
): Promise<ActivateSchoolYearResult> {
  const { currentYear: toYear } = SchoolYearConfigSchema.parse({ currentYear: args.toYear });
  const yearRef = db.collection(CONFIG_COLLECTION).doc(SCHOOL_YEAR_DOC);
  const sevaRef = db.collection(CONFIG_COLLECTION).doc(SEVA_REQUIREMENT_DOC);

  await db.runTransaction(async (tx) => {
    const sevaSnap = await tx.get(sevaRef);
    const parsedSeva = SevaRequirementConfigSchema.safeParse(sevaSnap.data());
    const hoursPerYear = parsedSeva.success
      ? parsedSeva.data.hoursPerYear
      : DEFAULT_SEVA_REQUIREMENT.hoursPerYear;

    tx.set(
      yearRef,
      { currentYear: toYear, updatedAt: FieldValue.serverTimestamp(), updatedBy: args.actorMid },
      { merge: true },
    );
    tx.set(sevaRef, {
      hoursPerYear,
      currentSevaYear: toYear,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { config: { currentYear: toYear }, sevaYear: toYear };
}

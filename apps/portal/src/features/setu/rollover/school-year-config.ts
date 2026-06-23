import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { BALA_VIHAR, SchoolYearConfigSchema, type SchoolYearConfig } from '@cmt/shared-domain';
import {
  DEFAULT_FROM_YEAR,
  balaViharSourceOidsForYear,
  deriveNextSchoolYear,
} from './school-year';

type Db = FirebaseFirestore.Firestore;

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'school_year';

export const DEFAULT_SCHOOL_YEAR_CONFIG: SchoolYearConfig = { currentYear: DEFAULT_FROM_YEAR };

export interface RolloverYearContext {
  fromYear: string;
  toYear: string;
}

export async function getSchoolYearConfig(db: Db): Promise<SchoolYearConfig> {
  const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SCHOOL_YEAR_CONFIG };

  const parsed = SchoolYearConfigSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : { ...DEFAULT_SCHOOL_YEAR_CONFIG };
}

export async function setSchoolYearConfig(
  db: Db,
  config: SchoolYearConfig,
  actorMid: string,
): Promise<SchoolYearConfig> {
  const parsed = SchoolYearConfigSchema.parse(config);
  const data: Record<string, unknown> = {
    currentYear: parsed.currentYear,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (actorMid) data['updatedBy'] = actorMid;

  await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set(data, { merge: true });
  return parsed;
}

export async function resolveRolloverYearContext(
  db: Db,
  overrides: { fromYear?: string; toYear?: string },
): Promise<RolloverYearContext> {
  const fromYear = overrides.fromYear ?? (await getSchoolYearConfig(db)).currentYear;
  const toYear = overrides.toYear ?? deriveNextSchoolYear(fromYear);
  return { fromYear, toYear };
}

export async function listBalaViharSourceOids(db: Db, fromYear: string): Promise<string[]> {
  const snap = await db
    .collection('offerings')
    .where('programKey', '==', BALA_VIHAR)
    .where('termLabel', '==', fromYear)
    .get();

  return snap.docs
    .map((doc) => doc.data()['oid'])
    .filter((oid): oid is string => typeof oid === 'string' && oid.length > 0);
}

export async function resolveBalaViharSourceOids(db: Db, fromYear: string): Promise<string[]> {
  const configuredOids = await listBalaViharSourceOids(db, fromYear);
  return configuredOids.length > 0 ? configuredOids : balaViharSourceOidsForYear(fromYear);
}

import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  isDisclaimerAccepted,
  type DisclaimerSection,
  type FamilyDoc,
} from '@cmt/shared-domain/setu';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { getDisclaimersConfig } from './config';

type Db = FirebaseFirestore.Firestore;

export interface DisclaimerState {
  version: number;
  schoolYear: string;
  sections: DisclaimerSection[];
  accepted: boolean;
}

/** The disclaimer state for a specific family: current content + whether this
 *  family's stored acceptance is current. Shared by the gate, GET
 *  /api/setu/disclaimers, and the dashboard so they never diverge. */
export async function getDisclaimerStateForFamily(
  db: Db,
  family: Pick<FamilyDoc, 'disclaimersAccepted'>,
): Promise<DisclaimerState> {
  const [config, schoolYearConfig] = await Promise.all([
    getDisclaimersConfig(db),
    getSchoolYearConfig(db),
  ]);
  const currentYear = schoolYearConfig.currentYear;
  return {
    version: config.version,
    schoolYear: currentYear,
    sections: config.sections,
    accepted: isDisclaimerAccepted(family.disclaimersAccepted ?? null, config, currentYear),
  };
}

/** Record a family's acceptance of the current content version + school year. */
export async function recordDisclaimerAcceptance(
  db: Db,
  fid: string,
  input: { version: number; schoolYear: string; byMid: string },
): Promise<void> {
  await db.collection('families').doc(fid).set(
    {
      disclaimersAccepted: {
        schoolYear: input.schoolYear,
        version: input.version,
        acceptedByMid: input.byMid,
        acceptedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );
}

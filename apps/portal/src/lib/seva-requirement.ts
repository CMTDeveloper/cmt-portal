import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { SevaRequirementConfigSchema, type SevaRequirementConfig } from '@cmt/shared-domain';

/**
 * Default seva-hours requirement. Returned until an admin saves their own
 * config (first write to the {@link CONFIG_DOC} doc). `currentSevaYear` is
 * `null` until an admin picks the active year from /admin/seva.
 */
export const DEFAULT_SEVA_REQUIREMENT: SevaRequirementConfig = { hoursPerYear: 20, currentSevaYear: null };

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'seva_requirement';

/**
 * Reads the admin-managed seva-hours requirement from PORTAL_FIREBASE.
 * Falls back to {@link DEFAULT_SEVA_REQUIREMENT} when the config doc has never
 * been written — no lazy write, so the read path needs no write permission;
 * the first admin Save persists the doc. Malformed stored data also falls back
 * to the default (schema-validated via safeParse).
 */
export async function getSevaRequirement(): Promise<SevaRequirementConfig> {
  const snap = await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SEVA_REQUIREMENT };
  const parsed = SevaRequirementConfigSchema.safeParse(snap.data());
  return parsed.success ? parsed.data : { ...DEFAULT_SEVA_REQUIREMENT };
}

/**
 * Overwrites the seva-hours requirement config doc. The caller (the admin PUT
 * route) is responsible for validating the input before calling.
 */
export async function setSevaRequirement(config: SevaRequirementConfig): Promise<void> {
  await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    hoursPerYear: config.hoursPerYear,
    currentSevaYear: config.currentSevaYear,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

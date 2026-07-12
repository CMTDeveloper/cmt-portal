import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

/**
 * Default centre locations, seeded into every location picker until an admin
 * saves their own list at /admin/locations. Once the config doc is written the
 * stored options take precedence. Location is a plain display string (the name
 * IS the key), so there is no slug and no migration of stored `location` fields.
 */
export const DEFAULT_LOCATIONS: readonly string[] = ['Brampton', 'Scarborough'];

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'locations';

/**
 * Reads the admin-managed centre locations from PORTAL_FIREBASE. Falls back to
 * {@link DEFAULT_LOCATIONS} when the config doc has never been written (no lazy
 * write, so the read path needs no write permission). The writer enforces a
 * non-empty list, so a present doc always has at least one centre.
 */
export async function getLocationOptions(): Promise<string[]> {
  const snap = await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return [...DEFAULT_LOCATIONS];
  const options = snap.data()?.['options'];
  if (!Array.isArray(options)) return [...DEFAULT_LOCATIONS];
  return options.filter((o): o is string => typeof o === 'string');
}

/**
 * Overwrites the locations config doc. The caller (the admin PUT route) trims,
 * dedupes, validates non-empty, and runs the referential-safety guard before
 * calling.
 */
export async function setLocationOptions(options: string[]): Promise<void> {
  await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    options,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

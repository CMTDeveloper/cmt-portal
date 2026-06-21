import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

/**
 * Default volunteering-skill options. Seeded into the admin picker until an
 * admin saves their own list. Once the config doc is written (first Save),
 * the stored options take precedence over this list — admins may add/remove
 * freely from /admin/volunteering-skills.
 */
export const DEFAULT_VOLUNTEERING_SKILLS: readonly string[] = [
  'Teaching / Facilitation',
  'Program Planning & Coordination',
  'Audio Visual / Technology',
  'Financial & Bookkeeping',
  'Bookstore Operations',
  'Kitchen / Prasad',
  'Decoration & Event Setup',
  'General Maintenance (Handyman)',
  'Skilled Trades (Electrical, Drywall, etc.)',
  'Landscaping & Groundskeeping',
  'General Volunteer Support (happy to help where needed)',
];

const CONFIG_COLLECTION = 'app_config';
const CONFIG_DOC = 'volunteering_skills';

/**
 * Reads the admin-managed volunteering-skill options from PORTAL_FIREBASE.
 * Falls back to {@link DEFAULT_VOLUNTEERING_SKILLS} when the config doc has
 * never been written — no lazy write, so the read path needs no write
 * permission; the first admin Save persists the doc. An existing doc with an
 * empty `options` array is honoured (admins may intentionally clear the list).
 */
export async function getVolunteeringSkillOptions(): Promise<string[]> {
  const snap = await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
  if (!snap.exists) return [...DEFAULT_VOLUNTEERING_SKILLS];
  const options = snap.data()?.['options'];
  if (!Array.isArray(options)) return [...DEFAULT_VOLUNTEERING_SKILLS];
  return options.filter((o): o is string => typeof o === 'string');
}

/**
 * Overwrites the volunteering-skill options config doc. The caller (the admin
 * PUT route) is responsible for trimming, deduping, and validating before
 * calling.
 */
export async function setVolunteeringSkillOptions(options: string[]): Promise<void> {
  await portalFirestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC).set({
    options,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

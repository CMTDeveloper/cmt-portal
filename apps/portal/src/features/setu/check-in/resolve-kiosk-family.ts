import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { Location } from '@cmt/shared-domain';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';

export type ResolvedKioskFamily = {
  fid: string; // CMT- doc id (join key)
  location: Location | null;
  publicFid: string | null;
  legacyFid: string | null;
  name: string;
  matchedOn: 'publicFid' | 'legacyFid';
};

/**
 * Resolve a Setu family from the number a family/sevak enters at the kiosk.
 *
 * Resolves the LEGACY check-in id FIRST, then the new publicFid as a fallback.
 * At the door, families still use their legacy check-in number (the new publicFid
 * has not been distributed yet), and ~60% of legacy ids happen to equal SOME
 * other family's publicFid (both are 4-digit numbers in overlapping ranges). A
 * publicFid-first lookup therefore resolved the WRONG family for most legacy
 * entries. Legacy-first is unambiguous for the real door flow: a legacy match
 * always wins, and the publicFid fallback only fires when the number is NOT any
 * family's legacy id, so it can never mis-route a legacy entry. The fallback
 * still lets a Setu-only family (no legacy id) check in by its publicFid.
 * (Both queries are single-field equality - limit(1), first hit wins.)
 */
export async function resolveKioskFamily(id: string): Promise<ResolvedKioskFamily | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const families = portalFirestore().collection('families');

  const byLegacy = await families.where('legacyFid', '==', trimmed).limit(1).get();
  const legacyDoc = byLegacy.docs[0];
  const doc = legacyDoc ?? (await families.where('publicFid', '==', trimmed).limit(1).get()).docs[0];
  if (!doc) return null;

  const data = doc.data() as Record<string, unknown>;
  return {
    fid: doc.id,
    location: (typeof data.location === 'string' ? data.location : null) as Location | null,
    publicFid: typeof data.publicFid === 'string' ? data.publicFid : null,
    legacyFid: typeof data.legacyFid === 'string' ? data.legacyFid : null,
    name: typeof data.name === 'string' && data.name ? data.name : doc.id,
    matchedOn: legacyDoc ? 'legacyFid' : 'publicFid',
  };
}

/**
 * Resolve a kiosk family, lazily migrating a LEGACY family that is not in Setu
 * yet (their first touch is the door). Under lazy publicFid minting, legacy
 * families are pulled into Setu on first engagement rather than bulk-migrated,
 * so a first-time family at the door will miss the Setu lookup above.
 *
 * On a Setu miss we treat the entered number as a legacy check-in id and run the
 * idempotent lazyMigrateLegacyFamily; on success we re-resolve. A number that is
 * in neither Setu nor the legacy roster makes lazyMigrateLegacyFamily throw, and
 * we return null (genuinely unknown) - matching the previous not-found behavior.
 * The migrate creates the family record WITHOUT a publicFid; that is minted when
 * the check-in auto-enrolls the family (enrollFamily).
 */
export async function resolveKioskFamilyOrMigrate(id: string): Promise<ResolvedKioskFamily | null> {
  const found = await resolveKioskFamily(id);
  if (found) return found;

  const trimmed = id.trim();
  if (!trimmed) return null;
  try {
    await lazyMigrateLegacyFamily(trimmed);
  } catch {
    return null;
  }
  return resolveKioskFamily(trimmed);
}

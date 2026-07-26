import 'server-only';
import { listAllFamilies } from '@/features/check-in/shared/rtdb/family-lookup';
import type { MigrationStatusResponse } from '@cmt/shared-domain/setu';
import { listDormantLegacyFids } from '@/features/setu/registration/legacy-parser';
import { listSetuLegacyFids } from './setu-legacy-fids';

const MISSING_SAMPLE_CAP = 200;

/**
 * Read-only reconciliation: every legacy 715b8 RTDB roster family vs the
 * Setu families that carry its legacyFid. NEVER writes 715b8.
 *
 * Dormant families are excluded from the expected set. The bulk migration skips
 * them on purpose (spec 1.9b), so counting them as missing would leave this
 * check permanently amber at ~299 with no way for staff to distinguish a
 * deliberate skip from a broken migration. They are reported separately instead.
 *
 * Dormancy is recomputed from the roster rather than read from anything the
 * migration persisted, so the two can never disagree - see listDormantLegacyFids.
 */
export async function getMigrationStatus(opts: { checkedAt: string }): Promise<MigrationStatusResponse> {
  const [legacy, setuLegacyFids, dormantFids] = await Promise.all([
    listAllFamilies(),
    listSetuLegacyFids(),
    listDormantLegacyFids(),
  ]);
  // Guard against a malformed RTDB family lacking `fid`: String(undefined) is the
  // truthy string 'undefined', which would otherwise count as a spurious missing fid.
  const allLegacyFids = [
    ...new Set(
      legacy
        .filter((f) => typeof f.fid === 'string' || typeof f.fid === 'number')
        .map((f) => String(f.fid))
        .filter(Boolean),
    ),
  ];

  // A dormant family that has since signed in IS in Setu, so it counts as
  // migrated, not skipped - otherwise the numbers stop adding up as families
  // trickle in after cutover.
  const skippedFids = allLegacyFids.filter((fid) => dormantFids.has(fid) && !setuLegacyFids.has(fid));
  const skipped = new Set(skippedFids);

  const expectedFids = allLegacyFids.filter((fid) => !skipped.has(fid));
  const missingFids = expectedFids.filter((fid) => !setuLegacyFids.has(fid));

  return {
    legacyTotal: expectedFids.length,
    migrated: expectedFids.length - missingFids.length,
    missing: missingFids.length,
    missingFids: missingFids.slice(0, MISSING_SAMPLE_CAP),
    skippedDormant: skipped.size,
    checkedAt: opts.checkedAt,
  };
}

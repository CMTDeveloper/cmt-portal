import 'server-only';
import { listAllFamilies } from '@/features/check-in/shared/rtdb/family-lookup';
import type { MigrationStatusResponse } from '@cmt/shared-domain/setu';
import { listSetuLegacyFids } from './setu-legacy-fids';

const MISSING_SAMPLE_CAP = 200;

/**
 * Read-only reconciliation: every legacy 715b8 RTDB roster family vs the
 * Setu families that carry its legacyFid. NEVER writes 715b8.
 */
export async function getMigrationStatus(opts: { checkedAt: string }): Promise<MigrationStatusResponse> {
  const [legacy, setuLegacyFids] = await Promise.all([listAllFamilies(), listSetuLegacyFids()]);
  // Guard against a malformed RTDB family lacking `fid`: String(undefined) is the
  // truthy string 'undefined', which would otherwise count as a spurious missing fid.
  const legacyFids = [
    ...new Set(
      legacy
        .filter((f) => typeof f.fid === 'string' || typeof f.fid === 'number')
        .map((f) => String(f.fid))
        .filter(Boolean),
    ),
  ];
  const missingFids = legacyFids.filter((fid) => !setuLegacyFids.has(fid));
  return {
    legacyTotal: legacyFids.length,
    migrated: legacyFids.length - missingFids.length,
    missing: missingFids.length,
    missingFids: missingFids.slice(0, MISSING_SAMPLE_CAP),
    checkedAt: opts.checkedAt,
  };
}

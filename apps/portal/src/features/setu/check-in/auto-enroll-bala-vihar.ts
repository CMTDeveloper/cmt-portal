import 'server-only';
import { BALA_VIHAR } from '@cmt/shared-domain';
import type { Location } from '@cmt/shared-domain';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import { enrollFamily } from '@/features/setu/enrollment/enroll-family';

export type AutoEnrollResult =
  | { enrolled: true; created: boolean; eid: string }
  | { enrolled: false; reason: 'no-open-offering' | 'no-eligible-members' };

/**
 * Auto-enroll a resolved kiosk family into the CURRENT Bala Vihar offering.
 *
 * Idempotent, and it must stay that way - this runs repeatedly at the door on
 * Sunday mornings. enrollFamily's already-active branch writes NOTHING when the
 * caller supplies none of `enrolledMids` / `suggestedAmountOverride` /
 * `membershipMode`, which is exactly what this call does. If you ever add one
 * of those here, this stops being a no-op and starts issuing a write per
 * check-in scan.
 *
 * Swallows the two expected skip cases; real offering/family errors bubble to
 * the caller.
 */
export async function autoEnrollBalaVihar(
  family: { fid: string; location: Location | null },
): Promise<AutoEnrollResult> {
  const offerings = await getOpenOfferingsForFamily(BALA_VIHAR, family.location);
  const oid = offerings[0]?.oid;
  if (!oid) return { enrolled: false, reason: 'no-open-offering' };

  try {
    const res = await enrollFamily({ fid: family.fid, oid, enrolledVia: 'kiosk', enrolledByMid: null });
    return { enrolled: true, created: res.created, eid: res.eid };
  } catch (e) {
    if (e instanceof Error && e.message === 'no-eligible-members') {
      return { enrolled: false, reason: 'no-eligible-members' };
    }
    throw e;
  }
}

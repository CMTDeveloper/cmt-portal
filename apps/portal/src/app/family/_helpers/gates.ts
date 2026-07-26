import { cache } from 'react';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import {
  incompleteMembers,
  membersRequiringCompletion,
  isFamilyAddressComplete,
  needsCentreConfirmation,
} from '@cmt/shared-domain';
import type { FamilyDoc } from '@cmt/shared-domain/setu';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';
import { flags } from '@/lib/flags';

/**
 * Everything `ProfileCompletionGate` would redirect on, as ONE definition.
 *
 * The `/family` layout mounts its gates as SIBLING `<Suspense>` boundaries, so
 * their resolution order is not guaranteed and each gate has to decide for
 * itself whether an earlier one is still pending. Copying that condition list
 * per gate is O(n²) and has already gone wrong once: P6 added
 * `needsCentreConfirmation` and both copies had to be edited, with a miss
 * routing a family that needs to confirm its centre off to the wrong screen.
 * One function, called by all three gates, makes that class of bug impossible.
 *
 * **Scope is `membersRequiringCompletion`, i.e. pending invitees excluded** -
 * and adopting it here is a deliberate BEHAVIOUR CHANGE for `DisclaimerGate`,
 * which used to check `incompleteMembers(data.members)` over ALL members. The
 * two disagreed, and the disagreement was a hole: a family with a pending
 * co-manager invite whose invitee row is incomplete saw NEITHER gate.
 * `ProfileCompletionGate` did not fire (the narrow scope drops the invitee) and
 * `DisclaimerGate` deferred to it forever (the wide scope saw the invitee), so
 * those families never accepted the disclaimers at all. The narrow scope is the
 * correct one - an invitee has no session and completes their own profile after
 * accepting - so unifying closes the hole. Expect those families to start being
 * sent to `/acknowledgements`.
 */
export function profileGatePending(data: FamilyWithMembers): boolean {
  const scope = membersRequiringCompletion(data.members, data.currentMid, data.isManager);
  return (
    incompleteMembers(scope).length > 0 ||
    (data.isManager && !isFamilyAddressComplete(data.family)) ||
    needsCentreConfirmation(data.family, data.isManager)
  );
}

/**
 * The disclaimer state, shared across the gates that need it in one render.
 *
 * React `cache()` keys on argument identity, and `data.family` comes from the
 * React-`cache()`d `getCurrentFamily()`, so `DisclaimerGate` and any gate
 * deferring to it get the SAME object and therefore ONE Firestore read - rather
 * than one read per gate on every `/family/*` render.
 */
export const getDisclaimerStateCached = cache(async function getDisclaimerStateCached(
  family: FamilyDoc,
) {
  return getDisclaimerStateForFamily(portalFirestore(), family);
});

/**
 * True while ANY gate ordered before the adult-class gate would still fire.
 *
 * A third gate has to defer to both earlier ones, and the disclaimer half is not
 * an in-memory check - it needs a Firestore read, and it must respect the
 * `flags.setuDisclaimers` short-circuit. **When disclaimers are OFF,
 * `DisclaimerGate` never fires, so deferring to it must not block** - otherwise
 * turning the flag off would silently disable the adult-class gate too.
 */
export async function earlierGatesPending(data: FamilyWithMembers): Promise<boolean> {
  if (profileGatePending(data)) return true;
  // Mirrors DisclaimerGate's own two short-circuits, in its order: the flag,
  // then manager-scope. A family-member is never disclaimer-gated, so there is
  // nothing pending for them to wait on.
  if (!flags.setuDisclaimers) return false;
  if (!data.isManager) return false;
  const state = await getDisclaimerStateCached(data.family);
  return !state.accepted;
}

'use client';

import { MemberEditForm, type MemberEditInitial } from './member-edit-form';

/**
 * Client wrapper for the staff member edit screen.
 *
 * It exists because `MemberEditForm` takes function props (`save`, `onSaved`)
 * and a Server Component cannot pass a function across the boundary. The page
 * does the session check and the Firestore read; this closes over fid/mid and
 * points the form at the staff endpoint.
 *
 * Everything a staff editor is allowed to do is `true` here, and the reasons
 * are worth stating because they are the opposite of the family screen's:
 *
 *  - canSetManagerFlag: this is the office's tool for a family locked out of
 *    its own account. The route already passes canSetManagerFlag:true into the
 *    write core, whose last-manager and manager-must-be-adult guards are what
 *    keep it safe - the UI is not the protection.
 *  - canSetParticipation / canGraduate: staff are cross-family by construction
 *    (the fid comes from the path, never the session), so the "don't let people
 *    retire themselves to escape their own required fields" concern that scopes
 *    these on the family screen does not arise.
 */
export function StaffMemberEditClient({
  fid,
  mid,
  initial,
}: {
  fid: string;
  mid: string;
  initial: MemberEditInitial;
}) {
  return (
    <MemberEditForm
      initial={initial}
      loading={false}
      permissions={{ canSetManagerFlag: true, canSetParticipation: true, canGraduate: true }}
      save={(body) =>
        fetch(`/api/welcome/families/${fid}/members/${mid}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      onSaved={() => {
        // HARD navigation, same rule as the family screen: the member page it
        // returns to reads through `use cache`, and a soft push can land on a
        // stale value and show what was just edited away.
        window.location.assign(`/welcome/family/${fid}/members/${mid}`);
      }}
      backHref={`/welcome/family/${fid}/members/${mid}`}
      heading="Edit member"
      audience="staff"
    />
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { MemberEditForm } from '@/features/setu/members/member-edit-form';
import type { FamilyWithMembers } from '@/features/setu/members/get-current-family';

/**
 * The family's own member edit screen.
 *
 * The form itself lives in `features/setu/members/member-edit-form.tsx`, shared
 * with the staff screen at /welcome/family/[fid]/members/[mid]/edit. This page
 * keeps the three things that are genuinely family-specific: where the member
 * is loaded from, which controls this viewer is allowed to be offered, and
 * where the PATCH goes.
 *
 * The extraction was made behaviour-neutral on purpose - this file's existing
 * test suite passed unchanged across it, which is the only real evidence that
 * ~570 households editing their own members every week were not disturbed.
 * One exception, found by review afterwards and kept deliberately: the shared
 * form now clears "no known allergies" when it is re-seeded with a different
 * member, which the old code here did not. See member-edit-form.tsx.
 *
 * "Remove from family" is deliberately absent. Vaibhav, 2026-08-04: *"please
 * remove the button as we do not want families to remove any members. At the
 * very least, they can only disable."* Same reasoning he gave on 2026-08-02 for
 * adding the disable control: *"Not to delete as we loose history."* Staff keep
 * the capability at /welcome/family/[fid] - so a duplicate created by mistake is
 * still fixable, just not by the family, and never without an audit row.
 */
export default function EditMemberPage() {
  const params = useParams<{ mid: string }>();
  const mid = params.mid;

  const [data, setData] = useState<FamilyWithMembers | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch via the API route — calling getCurrentFamily() directly from a
    // 'use client' component would crash at runtime (it uses next/headers +
    // firebase-admin, both server-only). getCurrentFamilyClient wraps the
    // GET /api/setu/family call so it's mockable in component tests.
    getCurrentFamilyClient()
      .then((result: FamilyWithMembers | null) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [mid]);

  const member = data?.members.find((m) => m.mid === mid) ?? null;

  // isEditingOther: manager editing a different member's profile. It gates all
  // three optional controls:
  //  - the manager toggle, because Vaibhav asked for it not to appear on a
  //    child and the server has always refused it there anyway;
  //  - participation, for the same reason /complete-profile scopes it that way:
  //    retiring YOURSELF while signed in and using the portal is a way to
  //    excuse your own required fields, not an answer about attendance;
  //  - graduation, which is the same conversion seen from the parent's side.
  const isEditingOther = data ? (data.isManager && mid !== data.currentMid) : false;

  // Member not found in family — show explicit message (notFound() not available in client components)
  if (!loading && !member) {
    return (
      <div style={{ padding: 32 }}>
        <h2>Member not found</h2>
        <p>This member may have been removed.</p>
        <Link href="/family/members">← Back to members</Link>
      </div>
    );
  }

  return (
    <MemberEditForm
      initial={
        member
          ? {
              mid: member.mid,
              firstName: member.firstName,
              lastName: member.lastName,
              type: member.type,
              gender: member.gender,
              schoolGrade: member.schoolGrade ?? null,
              birthMonthYear: member.birthMonthYear ?? null,
              foodAllergies: member.foodAllergies ?? null,
              email: member.email ?? null,
              phone: member.phone ?? null,
              volunteeringSkills: member.volunteeringSkills,
              manager: member.manager,
              ...(member.participation ? { participation: member.participation } : {}),
            }
          : null
      }
      loading={loading}
      permissions={{
        canSetManagerFlag: isEditingOther,
        canSetParticipation: isEditingOther,
        canGraduate: isEditingOther,
      }}
      save={(body) =>
        fetch(`/api/setu/members/${mid}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      onSaved={() => {
        // HARD nav, not router.push: a soft push into the gated /family layout
        // can bounce on a stale cached read and show the member's OLD values
        // right after saving them.
        window.location.assign(`/family/members/${mid}`);
      }}
      backHref={`/family/members/${mid}`}
      heading="Edit member"
    />
  );
}

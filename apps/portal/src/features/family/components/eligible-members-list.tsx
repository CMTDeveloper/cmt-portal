'use client';

import { memberEligibleForProgram, type ProgramEligibility } from '@cmt/shared-domain';
import { SetuAvatar } from '@cmt/ui';

export interface EligibleMember {
  mid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  birthMonthYear: string | null;
  schoolGrade?: string | null;
}

interface EligibleMembersListProps {
  members: EligibleMember[];
  eligibility: ProgramEligibility;
  now: Date;
}

/**
 * Renders the list of family members eligible for a program, filtered by
 * memberEligibleForProgram(). Shows an empty-state when none qualify.
 * Server-safe — no router/navigation needed.
 */
export function EligibleMembersList({ members, eligibility, now }: EligibleMembersListProps) {
  const eligible = members.filter((m) =>
    memberEligibleForProgram(m, eligibility, now),
  );

  if (eligible.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0' }}>
        No eligible members for this program.
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {eligible.map((m, i) => (
        <div
          key={m.mid}
          style={{
            padding: 14,
            borderTop: i > 0 ? '1px solid var(--line)' : undefined,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <SetuAvatar name={`${m.firstName} ${m.lastName}`} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{m.firstName} {m.lastName}</div>
            {m.schoolGrade && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.schoolGrade}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

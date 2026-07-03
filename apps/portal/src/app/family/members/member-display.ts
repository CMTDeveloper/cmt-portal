import { whatsMissingForMember, type MemberDoc } from '@cmt/shared-domain/setu';

/** The roster-card view of a member used by the My Family page. */
export type DisplayMember = {
  mid: string;
  name: string;
  type: string;
  tag: string | null;
  isManager: boolean;
  /** Only Adults can be promoted to Family Manager (children never). */
  isAdult: boolean;
  warn: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  isCurrent: boolean;
  nameMissing: boolean;
  /** Count of still-missing required fields for this member (0 ⇒ complete). */
  missingCount: number;
};

/** Pure mapper from a stored member to its roster-card display shape. */
export function memberToDisplay(m: MemberDoc, currentMid: string | null): DisplayMember {
  const isCurrent = currentMid !== null && m.mid === currentMid;
  const rawName = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
  const nameMissing = rawName.length === 0;
  const name = nameMissing ? (isCurrent ? 'Your profile' : 'Unnamed member') : rawName;
  const typeLabel = m.type === 'Child'
    ? `Child${m.schoolGrade ? ` · ${m.schoolGrade}` : ''}`
    : 'Adult';
  return {
    mid: m.mid,
    name,
    type: typeLabel,
    tag: m.manager ? 'Manager' : null,
    isManager: m.manager,
    isAdult: m.type === 'Adult',
    warn: m.foodAllergies ?? null,
    email: m.email,
    phone: m.phone,
    role: m.volunteeringSkills.length > 0 ? m.volunteeringSkills.join(', ') : null,
    isCurrent,
    nameMissing,
    missingCount: whatsMissingForMember(m).length,
  };
}

import { whatsMissingForMember, isParticipating, gradeLabel, recordedAllergy, INACTIVE_LABEL, INACTIVE_FROM_LEGACY_LABEL, type MemberDoc } from '@cmt/shared-domain/setu';

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
  /** Co-manager invited but not yet accepted — shows an "Invite pending" badge. */
  invitePending: boolean;
  /**
   * The family has said this person no longer takes part. They stay LISTED —
   * "not to delete as we lose history" was the whole request — but the card has
   * to say so, or a member nothing asks about any more looks like a normal one.
   */
  inactive: boolean;
  /**
   * True when the PORTAL retired them, not the family - lazy migration marks a
   * child whose legacy roster row had no class level. It is a good guess, not a
   * fact, so the card has to say where it came from: a family that sees their
   * own words reflected has nothing to check, but a family that sees a call the
   * portal made on their behalf can correct it.
   */
  inactiveBySystem: boolean;
};

/** The single status chip on a member card. */
export interface MemberStatusChip {
  /** Short form (desktop pill, which carries `title` for the detail). */
  label: string;
  /** Fuller form for the phone card, which has no hover. */
  labelLong: string;
  bg: string;
  fg: string;
  title: string;
  /** Non-null makes the chip a link (only the "complete info" state is one). */
  href: string | null;
}

/**
 * Which chip a member's card shows, in ONE place.
 *
 * The phone and desktop trees BOTH render, always, and they had a copy of this
 * ternary each. A state added to one and forgotten in the other is invisible in
 * review and invisible in tests - the layout the reviewer happens to look at is
 * the one that works. This is the shape that has already bitten the repo (a
 * shared radio `name` across the two trees), so the decision lives here and the
 * pages only paint it.
 *
 * Order is precedence, and `inactive` is first on purpose: a retired member has
 * no missing fields to chase and no invite to await - the family has been told
 * the portal will stop asking, so nothing else may speak over it.
 */
export function memberStatusChip(m: DisplayMember): MemberStatusChip {
  if (m.inactive) {
    return {
      // Through the shared labels, so this screen and /welcome/family/{fid}
      // can never name the same person's status differently.
      label: m.inactiveBySystem ? INACTIVE_FROM_LEGACY_LABEL : INACTIVE_LABEL,
      labelLong: m.inactiveBySystem
        ? 'Finished — from our old records. Edit if that is wrong.'
        : INACTIVE_LABEL,
      bg: 'var(--surface2)',
      fg: 'var(--muted)',
      title: m.inactiveBySystem
        ? 'Our old roster had no class for them, so we assumed they had finished'
        : 'Kept for their history - nothing is asked of them',
      href: m.inactiveBySystem ? `/family/members/${m.mid}/edit` : null,
    };
  }
  if (m.invitePending) {
    return {
      label: 'Invite pending',
      labelLong: 'Invite pending · awaiting sign-in',
      bg: 'var(--info-soft)',
      fg: 'var(--info-deep)',
      title: 'Invited — awaiting their sign-in',
      href: null,
    };
  }
  if (m.missingCount > 0) {
    const n = m.missingCount;
    return {
      label: `Complete info (${n})`,
      labelLong: `${n} field${n !== 1 ? 's' : ''} to complete`,
      bg: 'var(--setu-warn-soft)',
      fg: 'var(--warn, #a06410)',
      title: 'Some required profile info is still missing',
      href: `/family/members/${m.mid}/edit`,
    };
  }
  return {
    label: '✓ Complete',
    labelLong: '✓ Complete',
    bg: 'var(--setu-ok-soft)',
    fg: 'var(--ok)',
    title: 'All required profile info is on file',
    href: null,
  };
}

/** Pure mapper from a stored member to its roster-card display shape. */
export function memberToDisplay(m: MemberDoc, currentMid: string | null): DisplayMember {
  const isCurrent = currentMid !== null && m.mid === currentMid;
  const invitePending = m.inviteStatus === 'pending';
  // Through the shared helper, never `=== 'active'` inline: absent means active,
  // and every migrated member doc predates the field.
  const inactive = !isParticipating(m);
  const inactiveBySystem = inactive && m.inactiveSource === 'legacy-migration';
  const rawName = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
  const nameMissing = rawName.length === 0;
  const name = nameMissing ? (isCurrent ? 'Your profile' : 'Unnamed member') : rawName;
  const typeLabel = m.type === 'Child'
    ? `Child${m.schoolGrade ? ` · ${gradeLabel(m.schoolGrade)}` : ''}`
    : 'Adult';
  return {
    mid: m.mid,
    name,
    // A pending invitee shows "Invite pending"; else the Manager tag (or none).
    tag: invitePending ? 'Invite pending' : m.manager ? 'Manager' : null,
    type: typeLabel,
    isManager: m.manager,
    isAdult: m.type === 'Adult',
    // The card renders this in red as "Allergy: …", so it must be the allergy
    // the family actually recorded - not the 'None' the "No known allergies"
    // box writes. See `recordedAllergy`.
    warn: recordedAllergy(m.foodAllergies),
    email: m.email,
    phone: m.phone,
    role: m.volunteeringSkills.length > 0 ? m.volunteeringSkills.join(', ') : null,
    isCurrent,
    nameMissing,
    // A pending member completes their own profile AFTER accepting, so never
    // surface a missing-fields count on their card in the meantime. A retired
    // member is excused for the opposite reason - the portal has just finished
    // promising it would stop asking, so "3 fields to complete" would be a
    // demand it said it would not make.
    missingCount: invitePending || inactive ? 0 : whatsMissingForMember(m).length,
    invitePending,
    inactive,
    inactiveBySystem,
  };
}

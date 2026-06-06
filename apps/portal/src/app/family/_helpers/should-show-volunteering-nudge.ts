// Show the one-time "set your volunteering skills" nudge only for an ADULT
// member who has no skills on file yet and has never dismissed it. Children
// don't have volunteering skills; an absent member never shows it.
export function shouldShowVolunteeringSkillsNudge(
  // Accept Date | null | undefined on the timestamp (z.date().nullable().optional())
  // so this composes with the dashboard's currentMember under
  // exactOptionalPropertyTypes. Null/absent/undefined all mean "not dismissed".
  member:
    | {
        type?: 'Adult' | 'Child';
        volunteeringSkills?: string[];
        volunteeringSkillsNudgeDismissedAt?: Date | null | undefined;
      }
    | undefined,
): boolean {
  if (!member) return false;
  if (member.type !== 'Adult') return false;
  if ((member.volunteeringSkillsNudgeDismissedAt ?? null) !== null) return false;
  return (member.volunteeringSkills?.length ?? 0) === 0;
}

// Show the one-time "add your other contacts" nudge only when the current
// member exists and has never dismissed it. Null/absent timestamp = show.
export function shouldShowContactsNudge(
  // MemberDoc carries `Date | null | undefined` (z.date().nullable().optional());
  // accept all three so this composes with the dashboard's currentMember under
  // exactOptionalPropertyTypes. Null/absent/undefined timestamp all mean "show".
  member: { contactsNudgeDismissedAt?: Date | null | undefined } | undefined,
): boolean {
  if (!member) return false;
  return (member.contactsNudgeDismissedAt ?? null) === null;
}

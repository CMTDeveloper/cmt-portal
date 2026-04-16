export interface FamilyContactSet {
  emails: string[];
  phones: string[];
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits;
}

export function collectFamilyContactSet(
  roster: Record<string, Record<string, unknown>>,
  fid: number,
): FamilyContactSet {
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const key of Object.keys(roster)) {
    const entry = roster[key];
    if (!entry || entry.fid !== fid) continue;

    for (const field of [entry.email, entry.pemail, entry.emergency_email]) {
      if (field && typeof field === 'string' && field !== 'NULL') {
        emails.add(field.toLowerCase().trim());
      }
    }

    for (const field of [
      entry.phone,
      entry.phphone,
      entry.pmphone,
      entry.emergency_hphone,
      entry.emergency_mphone,
    ]) {
      if (field === null || field === undefined || field === 'NULL') continue;
      const asString = String(field);
      const normalized = normalizePhone(asString);
      if (normalized.length >= 7) phones.add(normalized);
    }
  }

  return { emails: [...emails], phones: [...phones] };
}

export function validateBvContact(
  email: string,
  phone: string,
  familyEmails: string[],
  familyPhones: string[],
): boolean {
  const canCheckEmail = familyEmails.length > 0;
  const canCheckPhone = familyPhones.length > 0;
  if (!canCheckEmail && !canCheckPhone) return true;
  const emailMatch =
    canCheckEmail && familyEmails.includes(email.toLowerCase().trim());
  const phoneMatch =
    canCheckPhone && familyPhones.includes(normalizePhone(phone));
  return emailMatch || phoneMatch;
}

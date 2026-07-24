import { z } from 'zod';

export const ContactKeyDocSchema = z.object({
  contactKey: z.string().min(1),
  type: z.enum(['email', 'phone']),
  fid: z.string().min(1),
  mid: z.string().min(1),
});

export type ContactKeyDoc = z.infer<typeof ContactKeyDocSchema>;

/**
 * Normalize a contact value for key derivation.
 * Email: lowercase + trim.
 * Phone:
 *  - An explicit non-North-American country code (the user typed a leading '+'
 *    that is not '+1', e.g. an Indian '+91…') is preserved as full E.164 —
 *    `+` followed by every digit. This is what lets families with international
 *    numbers register without their key being corrupted into a +1 form.
 *  - Otherwise (no '+', or a '+1…' NANP number) the legacy North American form
 *    is used: digits-only, drop a leading country-code 1, then `+1` + 10 digits.
 *    This branch is byte-identical to the pre-international behaviour, so every
 *    existing family's contact key is unchanged (no re-keying / dedup drift).
 * Must match the logic in apps/portal/src/features/setu/registration/hash-contact-key.ts.
 */
export function normalizeContactForKey(type: 'email' | 'phone', value: string): string {
  if (type === 'email') {
    return value.trim().toLowerCase();
  }
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) {
    return `+${digits}`;
  }
  const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${tenDigit}`;
}

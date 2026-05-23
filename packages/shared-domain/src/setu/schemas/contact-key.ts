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
 * Email: lowercase + trim. Phone: digits-only, then +1-prefixed 10-digit form.
 * Must match the logic in apps/portal/src/features/setu/registration/hash-contact-key.ts.
 */
export function normalizeContactForKey(type: 'email' | 'phone', value: string): string {
  if (type === 'email') {
    return value.trim().toLowerCase();
  }
  const digits = value.replace(/\D/g, '');
  const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${tenDigit}`;
}

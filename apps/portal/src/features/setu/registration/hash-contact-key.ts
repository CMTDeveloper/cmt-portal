import { createHash } from 'node:crypto';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';

export function hashContactKey(type: 'email' | 'phone', value: string): string {
  const normalized = normalizeContactForKey(type, value);
  // Prefix with type so email and phone never collide on the same raw string
  return createHash('sha256').update(`${type}:${normalized}`).digest('hex');
}

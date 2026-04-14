import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';
import type { Family } from '@cmt/shared-domain/check-in/family';

export function normalizeContact(type: 'email' | 'phone', value: string): string {
  if (type === 'email') return value.trim().toLowerCase();
  return value.replace(/\D/g, '');
}

export async function findFamilyById(fid: string): Promise<Family | null> {
  return readRtdb<Family>(`/families/${fid}`);
}

export async function findFamilyByContact(
  type: 'email' | 'phone',
  value: string,
): Promise<Family | null> {
  const target = normalizeContact(type, value);
  const all = (await readRtdb<Record<string, Family>>('/families')) ?? {};

  for (const family of Object.values(all)) {
    for (const contact of family.contacts ?? []) {
      if (contact.type !== type) continue;
      const candidate = normalizeContact(type, contact.value);
      const matches =
        type === 'phone'
          ? candidate === target || candidate === `1${target}` || `1${candidate}` === target
          : candidate === target;

      if (matches) {
        return family;
      }
    }
  }

  return null;
}

import 'server-only';

import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';

export type TeacherEmailResolutionErrorCode =
  | 'invalid-teacher-email'
  | 'teacher-not-found'
  | 'teacher-not-active';

export class TeacherEmailResolutionError extends Error {
  constructor(public readonly code: TeacherEmailResolutionErrorCode) {
    super(code);
  }
}

export interface ResolvedTeacherEmail {
  ref: string;
  email: string;
  name: string | null;
}

export async function resolveTeacherEmail(email: string): Promise<ResolvedTeacherEmail> {
  const normalized = normalizeContactForKey('email', email);
  if (!normalized || !normalized.includes('@')) {
    throw new TeacherEmailResolutionError('invalid-teacher-email');
  }

  const result = await findSetuFamilyByContact('email', normalized);
  if (result.source !== 'setu' || !result.mid || !result.member) {
    throw new TeacherEmailResolutionError('teacher-not-found');
  }

  if (result.member.manager !== true && result.member.portalAccess === 'pending') {
    throw new TeacherEmailResolutionError('teacher-not-active');
  }

  const first = typeof result.member.firstName === 'string' ? result.member.firstName : '';
  const last = typeof result.member.lastName === 'string' ? result.member.lastName : '';
  const name = `${first} ${last}`.trim() || null;

  return { ref: result.mid, email: normalized, name };
}


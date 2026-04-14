import type { UserRecord } from 'firebase-admin/auth';
import { portalAuth } from './auth';

export type PortalRole = 'admin' | 'teacher' | 'family';
export interface PortalClaims {
  role: PortalRole;
  familyId?: string;
  email?: string;
  phone?: string;
}

export async function setPortalUserClaims(uid: string, claims: PortalClaims): Promise<void> {
  await portalAuth().setCustomUserClaims(uid, claims);
}

export interface UserWithClaims {
  uid: string;
  email?: string | undefined;
  claims: PortalClaims | Record<string, never>;
}

export async function getPortalUserWithClaims(uid: string): Promise<UserWithClaims> {
  const user = await portalAuth().getUser(uid);
  return {
    uid: user.uid,
    ...(user.email !== undefined ? { email: user.email } : {}),
    claims: (user.customClaims as PortalClaims | undefined) ?? {},
  };
}

export const SHARED_TEACHER_UID = 'teacher-shared-v1';

export async function getOrCreateSharedTeacherUser(): Promise<UserRecord> {
  let user: UserRecord;
  try {
    user = await portalAuth().getUser(SHARED_TEACHER_UID);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      user = await portalAuth().createUser({
        uid: SHARED_TEACHER_UID,
        disabled: false,
      });
    } else {
      throw err;
    }
  }
  await portalAuth().setCustomUserClaims(SHARED_TEACHER_UID, { role: 'teacher' });
  return user;
}

export async function createPortalCustomToken(
  uid: string,
  claims: PortalClaims,
): Promise<string> {
  return portalAuth().createCustomToken(uid, claims);
}

export async function getOrCreateAdminUser(
  email: string,
  password: string,
): Promise<UserRecord> {
  let user: UserRecord;
  try {
    user = await portalAuth().getUserByEmail(email);
    await portalAuth().updateUser(user.uid, { password, disabled: false });
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      user = await portalAuth().createUser({ email, password, disabled: false });
    } else {
      throw err;
    }
  }
  await portalAuth().setCustomUserClaims(user.uid, { role: 'admin', email });
  return user;
}

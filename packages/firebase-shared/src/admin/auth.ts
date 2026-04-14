import { getAuth, type Auth } from 'firebase-admin/auth';
import { getPortalApp } from './apps';

export function portalAuth(): Auth {
  return getAuth(getPortalApp());
}

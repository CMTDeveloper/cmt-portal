import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp } from './apps';

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}

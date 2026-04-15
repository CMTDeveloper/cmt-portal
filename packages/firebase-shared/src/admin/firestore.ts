import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp } from './apps';

export { FieldValue };

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}

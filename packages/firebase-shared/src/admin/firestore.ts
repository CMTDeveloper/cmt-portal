import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp } from './apps';

export { FieldValue, Timestamp };

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}

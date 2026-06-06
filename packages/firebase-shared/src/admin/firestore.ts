import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getPortalApp, getMasterApp } from './apps';

export { FieldValue, Timestamp };

export function portalFirestore(): Firestore {
  return getFirestore(getPortalApp());
}

/**
 * READ-ONLY Firestore on the master app (prod `chinmaya-setu-715b8`) — the home
 * of the standalone check-in app's `family-check-ins` / `guest-families`.
 * Read-only by convention, exactly like `masterRtdb()`: the portal never writes
 * the door app's collections. Used only via the `checkInSourceFirestore()` seam.
 */
export function masterFirestore(): Firestore {
  return getFirestore(getMasterApp());
}

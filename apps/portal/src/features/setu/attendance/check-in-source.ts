import { masterFirestore, portalFirestore } from '@cmt/firebase-shared/admin/firestore';

type Firestore = ReturnType<typeof portalFirestore>;

/**
 * READ-ONLY Firestore handle to the standalone check-in app's data
 * (`family-check-ins` / `guest-families`). The door app writes these in prod
 * `chinmaya-setu-715b8`.
 *
 * - Today the portal runs on UAT, so the door data lives in a *different*
 *   project → read it via the master app (`masterFirestore()`).
 * - Once the portal itself runs on `715b8` (its project id equals the master
 *   project id), read it from the portal app directly so we don't depend on
 *   master creds. This collapse is automatic — no env flip needed.
 *
 * Either way we only READ these collections; we never write them.
 */
export function checkInSourceFirestore(): Firestore {
  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID;
  const masterProject = process.env.MASTER_FIREBASE_PROJECT_ID;
  if (portalProject && masterProject && portalProject === masterProject) {
    return portalFirestore();
  }
  return masterFirestore();
}

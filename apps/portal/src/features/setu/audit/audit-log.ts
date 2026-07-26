import { FieldValue } from '@cmt/firebase-shared/admin/firestore';

export interface AuditEntry {
  actorUid: string;
  actorMid: string | null;
  /** The session's PRIMARY role. See `actorExtraRoles` before reading it alone. */
  actorRole: string;
  /**
   * The rest of the actor's roles.
   *
   * Load-bearing, not decorative: welcome-team volunteers are usually parents,
   * so their primary role is `family-manager` and the staff capability rides in
   * extraRoles. A row saying only `actorRole: 'family-manager'` against another
   * family's child reads as a family manager reaching across families - a
   * security incident - when it is in fact routine staff work.
   */
  actorExtraRoles: string[];
  action: string;
  fid: string;
  mid: string | null;
  before: unknown;
  after: unknown;
  /** Set by E2E fixtures so the cleanup sweep, which keys on `_test: true`,
   *  can find and remove these rows. Without it Playwright audit rows
   *  accumulate in UAT forever. */
  _test?: true;
}

/**
 * Appends one audit row INSIDE the caller's transaction.
 *
 * Taking the transaction rather than opening its own is the whole point: a
 * rejected write leaves no row, and a committed write can never lack one. An
 * audit gap is structurally impossible rather than merely unlikely, which is
 * the property that makes the log worth trusting when someone asks who changed
 * a child's grade.
 *
 * Returns void, not the ref: nothing should read this row back inside the same
 * transaction, and handing out the id invites exactly that.
 */
export function writeAuditLog(
  txn: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  entry: AuditEntry,
): void {
  const ref = db.collection('audit_log').doc();
  txn.set(ref, { ...entry, at: FieldValue.serverTimestamp() });
}

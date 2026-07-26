import { describe, it, expect, vi } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { writeAuditLog, type AuditEntry } from '../audit-log';

const ENTRY: AuditEntry = {
  actorUid: 'u1',
  actorMid: null,
  actorRole: 'welcome-team',
  action: 'member.update',
  fid: 'CMT-X',
  mid: 'CMT-X-02',
  before: { schoolGrade: '3' },
  after: { schoolGrade: '4' },
};

function harness() {
  const set = vi.fn();
  const txn = { set } as unknown as FirebaseFirestore.Transaction;
  const doc = vi.fn(() => ({ id: 'audit-1' }));
  const collection = vi.fn(() => ({ doc }));
  const db = { collection } as unknown as FirebaseFirestore.Firestore;
  return { set, txn, db, collection };
}

describe('writeAuditLog', () => {
  it('writes through the CALLER transaction, never its own', () => {
    // The property that makes the log trustworthy: a rejected write leaves no
    // row and a committed write cannot lack one. If this helper ever opened its
    // own transaction or wrote via db.collection().add(), an audit gap becomes
    // possible again - so assert the txn is what performed the write.
    const { set, txn, db, collection } = harness();

    writeAuditLog(txn, db, ENTRY);

    expect(collection).toHaveBeenCalledWith('audit_log');
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![1]).toMatchObject({
      action: 'member.update',
      fid: 'CMT-X',
      mid: 'CMT-X-02',
      actorRole: 'welcome-team',
      at: 'SERVER_TS',
    });
  });

  it('records both sides of the change', () => {
    const { set, txn, db } = harness();
    writeAuditLog(txn, db, ENTRY);
    const written = set.mock.calls[0]![1] as { before: unknown; after: unknown };
    expect(written.before).toEqual({ schoolGrade: '3' });
    expect(written.after).toEqual({ schoolGrade: '4' });
  });

  it('carries a _test marker when one is supplied', () => {
    // E2E cleanup sweeps on `_test: true`; without this, Playwright audit rows
    // accumulate in UAT forever.
    const { set, txn, db } = harness();
    writeAuditLog(txn, db, { ...ENTRY, _test: true });
    expect(set.mock.calls[0]![1]).toMatchObject({ _test: true });
  });

  it('omits _test entirely for a real staff edit', () => {
    // Not cosmetic: a stray `_test: true` on a production row would make the
    // cleanup sweep delete a real audit record.
    const { set, txn, db } = harness();
    writeAuditLog(txn, db, ENTRY);
    expect(set.mock.calls[0]![1]).not.toHaveProperty('_test');
  });
});

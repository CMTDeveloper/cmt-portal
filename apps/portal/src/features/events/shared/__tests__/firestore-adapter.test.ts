import { describe, it, expect, vi } from 'vitest';

const mockDoc = vi.fn();
const mockCollection = vi.fn(() => ({ doc: mockDoc }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: mockCollection,
      })),
    })),
  })),
}));

import { registrationsCollection } from '../firestore-adapter';

describe('registrationsCollection', () => {
  it('returns a collection reference for the given campaign', () => {
    const coll = registrationsCollection('2026MothersDay');
    expect(coll).toBeDefined();
    expect(coll.doc).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mocks = vi.hoisted(() => {
  // chain: db.collection(date).doc(classId).collection(classId).doc(sid).set(...)
  // Actually: db.collection('attendance').doc(date).collection(classId).doc(sid).set(...)
  const leafDoc = { set: vi.fn() };                          // .doc(sid)
  const classCollection = { doc: vi.fn() };                  // .collection(classId)
  const dateDoc = { collection: vi.fn() };                   // .doc(date)
  const attendanceCollection = { doc: vi.fn() };             // .collection('attendance')
  const fakeFirestore = { collection: vi.fn() };
  return { leafDoc, classCollection, dateDoc, attendanceCollection, fakeFirestore };
});

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => mocks.fakeFirestore),
}));

import * as appHandler from '../attendance/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.leafDoc.set.mockResolvedValue(undefined);
  mocks.classCollection.doc.mockReturnValue(mocks.leafDoc);
  mocks.dateDoc.collection.mockReturnValue(mocks.classCollection);
  mocks.attendanceCollection.doc.mockReturnValue(mocks.dateDoc);
  mocks.fakeFirestore.collection.mockReturnValue(mocks.attendanceCollection);
});

describe('POST /api/check-in/teacher/attendance', () => {
  it('returns 401 without uid header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ classId: 'K', date: '2026-04-13', statuses: { '1': 'present' } }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ classId: 'K' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('rejects unknown status values', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classId: 'K',
            date: '2026-04-13',
            statuses: { '1': 'chilling' },
          }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('writes one record per student and returns count', async () => {
    await testApiHandler({
      appHandler,
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'teacher-shared-v1'),
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            classId: 'K',
            date: '2026-04-13',
            statuses: { '1': 'present', '2': 'late', '3': 'absent' },
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recorded).toBe(3);
      },
    });
    expect(mocks.leafDoc.set).toHaveBeenCalledTimes(3);
  });
});

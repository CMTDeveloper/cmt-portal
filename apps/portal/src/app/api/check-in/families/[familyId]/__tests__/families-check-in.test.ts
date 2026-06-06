import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const fakeCollection = { add: vi.fn() };
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: vi.fn(() => fakeCollection) })),
}));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyById: vi.fn(),
}));

const fakeSender = { sendEmail: vi.fn(), sendSMS: vi.fn() };
vi.mock('@/lib/aws/resolve-sender', () => ({
  resolveSender: vi.fn(() => fakeSender),
}));

import { findFamilyById } from '@/features/check-in/shared';
import * as appHandler from '../check-in/route';

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
  fakeCollection.add.mockResolvedValue({ id: 'ci-new' });
});

describe('POST /api/check-in/families/:familyId/check-in', () => {
  it('returns 404 when kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(findFamilyById).not.toHaveBeenCalled();
    expect(fakeCollection.add).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 404 when family does not exist', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await testApiHandler({
      appHandler,
      params: { familyId: '999' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it('writes one event per student with checkedInBy=sevak', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'paid',
      students: [],
      contacts: [],
      name: 'Acme',
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true, '2': false, '3': true } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.checkInIds).toHaveLength(3);
      },
    });
    expect(fakeCollection.add).toHaveBeenCalledTimes(3);
    const firstCall = (fakeCollection.add as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstCall.checkedInBy).toBe('sevak');
  });

  it('does not send payment reminder for paid families', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'paid',
      name: 'Acme',
      students: [],
      contacts: [{ type: 'email', value: 'a@b.com' }],
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    expect(fakeSender.sendEmail).not.toHaveBeenCalled();
  });

  it('sends payment reminder for unpaid families with email contact', async () => {
    (findFamilyById as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      fid: '42',
      paymentStatus: 'unpaid',
      name: 'Acme',
      students: [],
      contacts: [{ type: 'email', value: 'a@b.com' }],
    });
    await testApiHandler({
      appHandler,
      params: { familyId: '42' },
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ students: { '1': true } }),
        });
      },
    });
    expect(fakeSender.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com' }),
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/features/setu/seva/get-opportunities', () => ({ getOpportunity: vi.fn() }));
const mockSet = vi.fn();
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => ({ doc: () => ({ set: mockSet }) }) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

import { PATCH } from '../route';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';

function reqCtx(method: string, body: unknown, role: string | null = 'welcome-team') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers['x-portal-role'] = role;
  headers['x-portal-uid'] = 'u-staff';
  const req = new Request('http://localhost/api/welcome/seva/opportunities/o1', {
    method, headers, body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ oppId: 'o1' }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  vi.mocked(getOpportunity).mockResolvedValue({ oppId: 'o1', status: 'open' } as never);
});

describe('PATCH /api/welcome/seva/opportunities/[oppId]', () => {
  it('403 for family-manager', async () => {
    const [r, c] = reqCtx('PATCH', { title: 'X' }, 'family-manager');
    expect((await PATCH(r, c)).status).toBe(403);
  });
  it('404 when the opportunity is missing', async () => {
    vi.mocked(getOpportunity).mockResolvedValue(null);
    const [r, c] = reqCtx('PATCH', { title: 'X' });
    expect((await PATCH(r, c)).status).toBe(404);
  });
  it('400 on invalid status', async () => {
    const [r, c] = reqCtx('PATCH', { status: 'bogus' });
    expect((await PATCH(r, c)).status).toBe(400);
  });
  it('200 edits a field', async () => {
    const [r, c] = reqCtx('PATCH', { title: 'New title' });
    expect((await PATCH(r, c)).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ title: 'New title', updatedBy: 'u-staff' }), { merge: true });
  });
  it('200 closes an opportunity', async () => {
    const [r, c] = reqCtx('PATCH', { status: 'closed' });
    expect((await PATCH(r, c)).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }), { merge: true });
  });
});

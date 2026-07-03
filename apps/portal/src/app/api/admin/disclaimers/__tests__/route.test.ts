import { describe, it, expect, vi, beforeEach } from 'vitest';

const readSession = vi.fn();
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: (r: Request) => readSession(r) }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: () => ({}) }));
const getConfig = vi.fn();
const setConfig = vi.fn();
vi.mock('@/features/setu/disclaimers/config', () => ({
  getDisclaimersConfig: (...a: unknown[]) => getConfig(...a),
  setDisclaimersConfig: (...a: unknown[]) => setConfig(...a),
}));

import { GET, PUT } from '../route';

beforeEach(() => { readSession.mockReset(); getConfig.mockReset(); setConfig.mockReset(); });

const SECTION = { id: 'respect-responsibility', title: 'T', body: 'B' };

describe('GET /api/admin/disclaimers', () => {
  it('403 for a non-admin', async () => {
    readSession.mockReturnValue({ role: 'family-manager' });
    expect((await GET(new Request('http://x'))).status).toBe(403);
  });
  it('returns the editable config for an admin', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u' });
    getConfig.mockResolvedValue({ version: 4, sections: [SECTION] });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 4, sections: [SECTION] });
  });
});

describe('PUT /api/admin/disclaimers', () => {
  it('rejects empty title/body (400)', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u', mid: 'm-admin' });
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ sections: [{ id: 'a', title: '', body: 'b' }] }) }));
    expect(res.status).toBe(400);
  });
  it('publishes and returns the new version', async () => {
    readSession.mockReturnValue({ role: 'admin', uid: 'u', mid: 'm-admin' });
    setConfig.mockResolvedValue({ version: 5, sections: [SECTION] });
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ sections: [SECTION] }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 5 });
    expect(setConfig).toHaveBeenCalledWith(expect.anything(), [SECTION], 'm-admin');
  });
});

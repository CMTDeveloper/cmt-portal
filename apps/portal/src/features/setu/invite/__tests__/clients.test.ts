import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getInviteClient } from '../get-invite-client';
import { acceptInviteClient } from '../accept-invite-client';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => fetchMock.mockReset());

describe('getInviteClient', () => {
  it('returns metadata on 200', async () => {
    const meta = { familyName: 'Patel', inviterName: 'Raj Patel', relation: 'Spouse', expiresAt: '2026-06-01T00:00:00.000Z' };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => meta });
    const result = await getInviteClient('tok-123');
    expect(result).toEqual(meta);
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/invite/tok-123', { credentials: 'same-origin' });
  });

  it('returns { error: "expired" } on 410', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410 });
    expect(await getInviteClient('tok-exp')).toEqual({ error: 'expired' });
  });

  it('returns { error: "accepted" } on 409', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
    expect(await getInviteClient('tok-acc')).toEqual({ error: 'accepted' });
  });

  it('returns { error: "not-found" } on 404', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await getInviteClient('tok-nf')).toEqual({ error: 'not-found' });
  });
});

describe('acceptInviteClient', () => {
  it('returns ok:true with fid+mid on success', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ fid: 'f1', mid: 'm1' }) });
    const result = await acceptInviteClient('tok-123');
    expect(result).toEqual({ ok: true, fid: 'f1', mid: 'm1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/invite/accept', expect.objectContaining({ method: 'POST' }));
  });

  it('returns ok:false with error message on failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({ error: 'invite expired' }) });
    const result = await acceptInviteClient('tok-exp');
    expect(result).toEqual({ ok: false, error: 'invite expired' });
  });

  it('returns ok:false with "unknown" when no error body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
    const result = await acceptInviteClient('tok-bad');
    expect(result).toEqual({ ok: false, error: 'unknown' });
  });
});

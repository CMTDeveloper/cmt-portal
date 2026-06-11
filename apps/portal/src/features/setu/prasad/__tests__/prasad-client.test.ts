import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  fetchMyPrasad,
  fetchMoveOptions,
  movePrasad,
  confirmPrasad,
  fetchPrasadPreview,
  publishPrasad,
  fetchPrasadAssignments,
  adminReassignPrasad,
  assignRemainingPrasad,
  type AdminPrasadAssignment,
} from '../prasad-client';
import type { FamilyPrasadView, MoveOption } from '../family-assignment';
import type { PrasadPreviewResult } from '../publish-assignments';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => fetchMock.mockReset());

const familyView: FamilyPrasadView = {
  paid: '2026-brampton-CMT-100',
  pid: '2026-brampton',
  date: '2026-09-13',
  youngestName: 'Aanya',
  birthMonth: 4,
  reason: 'youngest-birth-month',
  status: 'assigned',
  movable: true,
};

const moveOptions: MoveOption[] = [
  { date: '2026-09-20', seatsLeft: 3 },
  { date: '2026-09-27', seatsLeft: 1 },
];

const previewResult: PrasadPreviewResult = {
  pid: '2026-brampton',
  cap: 6,
  rows: [],
  unplaced: [],
  perSunday: [],
  stats: { families: 0, keptExisting: 0, birthdayMonth: 0, spill: 0, noBirthMonth: 0, unplaced: 0 },
  defaultCap: 6,
  eligibleSundayCount: 30,
};

const adminAssignments: AdminPrasadAssignment[] = [
  {
    paid: '2026-brampton-CMT-100',
    fid: 'CMT-100',
    familyName: 'Sharma',
    location: 'Brampton',
    date: '2026-09-13',
    youngestName: 'Aanya',
    reason: 'youngest-birth-month',
    source: 'auto',
    status: 'assigned',
  },
];

describe('fetchMyPrasad', () => {
  it('returns the assignment on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assignment: familyView }) });
    const result = await fetchMyPrasad();
    expect(result).toEqual(familyView);
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/prasad');
  });

  it('returns null when there is no assignment', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assignment: null }) });
    expect(await fetchMyPrasad()).toBeNull();
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(fetchMyPrasad()).rejects.toThrow('401');
  });
});

describe('fetchMoveOptions', () => {
  it('returns the options array on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ options: moveOptions }) });
    const result = await fetchMoveOptions();
    expect(result).toEqual(moveOptions);
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/prasad/options');
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchMoveOptions()).rejects.toThrow('500');
  });
});

describe('movePrasad', () => {
  it('POSTs the target date and resolves on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'moved' }) });
    await movePrasad('2026-09-20');
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/prasad/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-09-20' }),
    });
  });

  it('throws the body error field when present', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'target-full' }) });
    await expect(movePrasad('2026-09-20')).rejects.toThrow('target-full');
  });

  it('throws a status fallback when the body has no error field', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(movePrasad('2026-09-20')).rejects.toThrow('500');
  });

  it('throws a status fallback when the body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(movePrasad('2026-09-20')).rejects.toThrow('502');
  });
});

describe('confirmPrasad', () => {
  it('POSTs an empty body to confirm in place', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await confirmPrasad();
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/prasad/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  });

  it('POSTs the target date when given one', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await confirmPrasad('2026-09-20');
    expect(fetchMock).toHaveBeenCalledWith('/api/setu/prasad/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-09-20' }),
    });
  });

  it('throws the body error field when present', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'already-confirmed' }) });
    await expect(confirmPrasad()).rejects.toThrow('already-confirmed');
  });

  it('throws a status fallback when the body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(confirmPrasad('2026-09-20')).rejects.toThrow('502');
  });
});

describe('fetchPrasadPreview', () => {
  it('POSTs pid only when cap is omitted', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => previewResult });
    const result = await fetchPrasadPreview('2026-brampton');
    expect(result).toEqual(previewResult);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: '2026-brampton' }),
    });
  });

  it('POSTs pid + cap when cap is provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => previewResult });
    await fetchPrasadPreview('2026-brampton', 8);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: '2026-brampton', cap: 8 }),
    });
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(fetchPrasadPreview('2026-brampton')).rejects.toThrow('403');
  });
});

describe('publishPrasad', () => {
  it('POSTs pid + cap and parses the result', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => previewResult });
    const result = await publishPrasad('2026-brampton', 6);
    expect(result).toEqual(previewResult);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: '2026-brampton', cap: 6 }),
    });
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(publishPrasad('2026-brampton', 6)).rejects.toThrow('500');
  });
});

describe('fetchPrasadAssignments', () => {
  it('GETs with pid only when date is omitted', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assignments: adminAssignments }) });
    const result = await fetchPrasadAssignments('2026-brampton');
    expect(result).toEqual(adminAssignments);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad?pid=2026-brampton');
  });

  it('GETs with pid + date when date is provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assignments: adminAssignments }) });
    await fetchPrasadAssignments('2026-brampton', '2026-09-13');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad?pid=2026-brampton&date=2026-09-13');
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(fetchPrasadAssignments('2026-brampton')).rejects.toThrow('403');
  });
});

describe('adminReassignPrasad', () => {
  it('PATCHes the body and resolves on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'moved' }) });
    await adminReassignPrasad({ paid: '2026-brampton-CMT-100', date: '2026-09-20' });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/assignment', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paid: '2026-brampton-CMT-100', date: '2026-09-20' }),
    });
  });

  it('PATCHes a cancel body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'cancelled' }) });
    await adminReassignPrasad({ paid: '2026-brampton-CMT-100', cancel: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/assignment', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paid: '2026-brampton-CMT-100', cancel: true }),
    });
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
    await expect(adminReassignPrasad({ paid: '2026-brampton-CMT-100', cancel: true })).rejects.toThrow('409');
  });

  it('PATCHes an assign body (assign:true passed through)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await adminReassignPrasad({ paid: '2026-brampton-CMT-100', assign: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/assignment', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paid: '2026-brampton-CMT-100', assign: true }),
    });
  });
});

describe('assignRemainingPrasad', () => {
  it('POSTs the pid and returns the assigned count', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, assigned: 12 }) });
    const result = await assignRemainingPrasad('2026-brampton');
    expect(result).toBe(12);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/prasad/assign-remaining', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: '2026-brampton' }),
    });
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(assignRemainingPrasad('2026-brampton')).rejects.toThrow('403');
  });
});

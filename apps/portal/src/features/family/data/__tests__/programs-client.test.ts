/**
 * TDD tests for the programs-client fetch wrapper (Phase F3).
 *
 * The wrapper calls GET /api/setu/programs and returns the parsed program list.
 * It throws on non-OK responses (per feedback_client_server_boundary).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
});

import { fetchEligiblePrograms, type ClientProgramItem } from '../programs-client';

describe('fetchEligiblePrograms', () => {
  it('returns parsed program list on 200', async () => {
    const programs: ClientProgramItem[] = [
      {
        programKey: 'bala-vihar',
        label: 'Bala Vihar',
        shortDescription: 'Sunday school for children',
        termType: 'term',
        openOfferings: [
          {
            oid: 'bv-brampton-fall-2026',
            termLabel: 'Fall 2026',
            startDate: '2026-09-07T00:00:00.000Z',
            endDate: '2027-01-25T00:00:00.000Z',
          },
        ],
      },
    ];

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ programs }),
    } as Response);

    const result = await fetchEligiblePrograms();
    expect(result).toHaveLength(1);
    expect(result[0]!.programKey).toBe('bala-vihar');
    expect(result[0]!.label).toBe('Bala Vihar');
    expect(result[0]!.openOfferings).toHaveLength(1);
  });

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'no-session' }),
    } as Response);

    await expect(fetchEligiblePrograms()).rejects.toThrow();
  });

  it('throws on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));

    await expect(fetchEligiblePrograms()).rejects.toThrow('network error');
  });

  it('calls GET /api/setu/programs with no body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ programs: [] }),
    } as Response);

    await fetchEligiblePrograms();

    expect(global.fetch).toHaveBeenCalledWith('/api/setu/programs', expect.objectContaining({ method: 'GET' }));
  });

  it('returns empty array when programs list is empty', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ programs: [] }),
    } as Response);

    const result = await fetchEligiblePrograms();
    expect(result).toEqual([]);
  });
});

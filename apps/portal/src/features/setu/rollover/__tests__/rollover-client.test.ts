import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  commitPromotionClient,
  previewPromotionClient,
  saveSchoolYearConfigClient,
  startNewYearClient,
} from '../rollover-client';
import type { RolloverReport, StartYearResult } from '@cmt/shared-domain';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => fetchMock.mockReset());

const startResult: StartYearResult = {
  fromYear: '2025-2026',
  toYear: '2026-2027',
  offeringsCreated: ['bala-vihar'],
  offeringsExisting: [],
  levelsCreated: ['grade-1'],
  levelsExisting: [],
  donationPeriodsCreated: ['2026-2027'],
};

const rolloverReport: RolloverReport = {
  fromYear: '2025-2026',
  toYear: '2026-2027',
  dryRun: true,
  familiesProcessed: 3,
  familiesSkippedAlreadyPromoted: 0,
  promoted: 2,
  advanced: 2,
  shishuStayed: 0,
  graduated: 1,
  needsAttention: 0,
  byTransition: [{ label: 'Grade 1 → Grade 2', count: 2 }],
  graduates: [],
  attention: [],
  rows: [],
  affectedFids: [],
};

describe('startNewYearClient', () => {
  it('parses StartYearResult on 200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => startResult });
    const result = await startNewYearClient();
    expect(result).toEqual(startResult);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/school-year/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(startNewYearClient()).rejects.toThrow('403');
  });
});

describe('saveSchoolYearConfigClient', () => {
  it('persists the current year with PUT and parses the config', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ config: { currentYear: '2026-27' }, nextYear: '2027-28' }),
    });
    const result = await saveSchoolYearConfigClient('2026-27');
    expect(result).toEqual({ currentYear: '2026-27' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/school-year',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ currentYear: '2026-27' }) }),
    );
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(saveSchoolYearConfigClient('bad')).rejects.toThrow('400');
  });
});

describe('previewPromotionClient', () => {
  it('parses RolloverReport and sends dryRun:true', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => rolloverReport });
    const result = await previewPromotionClient();
    expect(result).toEqual(rolloverReport);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/school-year/promote',
      expect.objectContaining({ body: JSON.stringify({ dryRun: true }) }),
    );
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(previewPromotionClient()).rejects.toThrow('500');
  });
});

describe('commitPromotionClient', () => {
  it('parses RolloverReport and sends dryRun:false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...rolloverReport, dryRun: false }),
    });
    const result = await commitPromotionClient();
    expect(result.dryRun).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/school-year/promote',
      expect.objectContaining({ body: JSON.stringify({ dryRun: false }) }),
    );
  });

  it('throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(commitPromotionClient()).rejects.toThrow('401');
  });
});

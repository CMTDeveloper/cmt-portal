import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/locations', () => ({
  getLocationOptions: vi.fn(),
}));

import { GET } from '../route';
import { getLocationOptions } from '@/lib/locations';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/setu/locations', () => {
  it('returns the current options publicly - no session (the register picker is pre-auth)', async () => {
    vi.mocked(getLocationOptions).mockResolvedValue(['Brampton', 'Scarborough']);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: string[] };
    expect(body.options).toEqual(['Brampton', 'Scarborough']);
  });
});

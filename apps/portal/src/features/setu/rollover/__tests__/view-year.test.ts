import { describe, it, expect } from 'vitest';
import { resolveViewYear } from '../view-year';

const YEARS = ['2024-25', '2025-26', '2026-27']; // sorted ascending

describe('resolveViewYear', () => {
  it('defaults to the live year when the param is absent', () => {
    expect(resolveViewYear(YEARS, '2025-26', null)).toEqual({ year: '2025-26', status: 'live' });
  });
  it('classifies a past / preparing year', () => {
    expect(resolveViewYear(YEARS, '2025-26', '2024-25')).toEqual({ year: '2024-25', status: 'past' });
    expect(resolveViewYear(YEARS, '2025-26', '2026-27')).toEqual({ year: '2026-27', status: 'preparing' });
  });
  it('falls back to live on an unknown/garbage param', () => {
    expect(resolveViewYear(YEARS, '2025-26', '1999-00')).toEqual({ year: '2025-26', status: 'live' });
    expect(resolveViewYear(YEARS, '2025-26', 'garbage')).toEqual({ year: '2025-26', status: 'live' });
  });
});

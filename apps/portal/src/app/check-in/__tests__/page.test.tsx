import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
});

describe('/check-in page flag gate', () => {
  it('calls notFound when flag is off', async () => {
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN = 'true';
    process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK = 'false';
    const notFound = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    vi.doMock('next/navigation', () => ({ notFound }));
    const { default: Page } = await import('../page');
    expect(() => render(<Page />)).toThrow(/NEXT_NOT_FOUND/);
    expect(notFound).toHaveBeenCalled();
  });
});

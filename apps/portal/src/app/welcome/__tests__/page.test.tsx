import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Next.js navigation ──────────────────────────────────────────────────────
const mockRedirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

import WelcomeIndexPage from '../page';

beforeEach(() => {
  mockRedirect.mockReset();
});

describe('WelcomeIndexPage', () => {
  it('redirects to /welcome/roster', () => {
    WelcomeIndexPage();
    expect(mockRedirect).toHaveBeenCalledWith('/welcome/roster');
  });
});

/**
 * The legacy /check-in/admin/reports page now redirects to the unified Reports
 * hub at /welcome/reports (admin-revamp Phase 4). Mock redirect (the real one
 * throws internally) and assert the destination.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import AdminReportsPage from '../page';

describe('legacy /check-in/admin/reports', () => {
  it('redirects to the unified /welcome/reports hub', () => {
    expect(() => AdminReportsPage()).toThrow('REDIRECT:/welcome/reports');
  });
});

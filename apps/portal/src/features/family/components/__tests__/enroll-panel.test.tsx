/**
 * Component tests for EnrollPanel (Phase F final-review FIX 1).
 *
 * EnrollPanel owns the selected-offering state and renders the OfferingPicker
 * together with the EnrollCta, so changing the selected radio changes the oid
 * POSTed to /api/setu/enrollments.
 *
 * Key behaviours:
 *   • TWO offerings → selecting the second and submitting POSTs the second oid.
 *   • ONE offering  → auto-selected; submitting POSTs that single oid (BV).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockPush = vi.fn();

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { check: () => null, edit: () => null, back: () => null },
  SetuAvatar: () => null,
  SetuLogo: () => null,
}));

import { EnrollPanel } from '../enroll-panel';
import type { OfferingDoc } from '@cmt/shared-domain';

function makeOffering(overrides: Partial<OfferingDoc> = {}): OfferingDoc {
  return {
    oid: 'bv-brampton-fall-2026',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    termLabel: 'Fall 2026',
    termType: 'term',
    startDate: new Date('2026-09-07'),
    endDate: new Date('2027-01-25'),
    pricingTiers: [],
    enabled: true,
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

function lastPostBody(fetchSpy: ReturnType<typeof vi.spyOn>): unknown {
  const calls = fetchSpy.mock.calls;
  const init = calls[calls.length - 1]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockReset();
  mockPush.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe('EnrollPanel', () => {
  it('two offerings: selecting the second then submitting POSTs the second oid', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'x', donateUrl: '/family/donate?eid=x' }),
    } as Response);

    const o1 = makeOffering({ oid: 'bv-brampton-fall-2026', termLabel: 'Fall 2026' });
    const o2 = makeOffering({ oid: 'bv-brampton-spring-2027', termLabel: 'Spring 2027' });

    render(<EnrollPanel offerings={[o1, o2]} defaultOid={o1.oid} donationsEnabled={false} />);

    // Pick the second offering, then submit.
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    await user.click(radios[1]!);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(lastPostBody(fetchSpy)).toEqual({ oid: 'bv-brampton-spring-2027' });
  });

  it('two offerings: submitting WITHOUT changing selection POSTs the default oid', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'x', donateUrl: '/family/donate?eid=x' }),
    } as Response);

    const o1 = makeOffering({ oid: 'bv-brampton-fall-2026', termLabel: 'Fall 2026' });
    const o2 = makeOffering({ oid: 'bv-brampton-spring-2027', termLabel: 'Spring 2027' });

    render(<EnrollPanel offerings={[o1, o2]} defaultOid={o1.oid} donationsEnabled={false} />);
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(lastPostBody(fetchSpy)).toEqual({ oid: 'bv-brampton-fall-2026' });
  });

  it('single offering: auto-selected — no radios, submit POSTs that oid', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eid: 'x', donateUrl: '/family/donate?eid=x' }),
    } as Response);

    const only = makeOffering({ oid: 'bv-brampton-fall-2026' });

    render(<EnrollPanel offerings={[only]} defaultOid={only.oid} donationsEnabled={false} />);

    // No radio UI for the single-offering case.
    expect(screen.queryByRole('radio')).toBeNull();
    await user.click(screen.getByRole('button', { name: /enroll/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(lastPostBody(fetchSpy)).toEqual({ oid: 'bv-brampton-fall-2026' });
  });
});

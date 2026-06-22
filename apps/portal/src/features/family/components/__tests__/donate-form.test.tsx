import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
}));

import { DonateForm } from '../donate-form';

beforeEach(() => {
  mockPush.mockReset();
  toastMock.error.mockReset();
  vi.restoreAllMocks();
});

describe('DonateForm', () => {
  it('requires all Bala Vihar acknowledgements before checkout can start', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'checkout-not-configured' }),
    } as Response);

    render(
      <DonateForm
        mode="enrollment"
        eid="CMT-AAAA1111-bv-brampton-fall-2026"
        suggestedAmount={500}
        periodLabel="Fall 2026"
        tiers={[500, 750, 1000]}
      />,
    );

    const giveButton = screen.getByRole('button', { name: /give \$500\.00/i });
    expect(giveButton).toBeDisabled();

    await user.click(giveButton);
    expect(fetchSpy).not.toHaveBeenCalled();

    const acknowledgementGroup = screen.getByRole('group', {
      name: /bala vihar donation acknowledgements/i,
    });
    const acknowledgementBoxes = within(acknowledgementGroup).getAllByRole('checkbox');
    expect(acknowledgementBoxes).toHaveLength(4);

    for (const checkbox of acknowledgementBoxes) {
      await user.click(checkbox);
    }

    expect(giveButton).not.toBeDisabled();

    await user.click(giveButton);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'enrollment',
      eid: 'CMT-AAAA1111-bv-brampton-fall-2026',
      amountCAD: 500,
      coverFee: false,
    });
  });

  it('does not require Bala Vihar acknowledgements for other enrollment donations', () => {
    render(
      <DonateForm
        mode="enrollment"
        eid="CMT-AAAA1111-tabla-2026"
        suggestedAmount={500}
        periodLabel="2026"
        tiers={[500, 750, 1000]}
        requiresAcknowledgements={false}
      />,
    );

    expect(screen.queryByRole('group', { name: /bala vihar donation acknowledgements/i })).toBeNull();
    expect(screen.getByRole('button', { name: /give \$500\.00/i })).not.toBeDisabled();
  });
});

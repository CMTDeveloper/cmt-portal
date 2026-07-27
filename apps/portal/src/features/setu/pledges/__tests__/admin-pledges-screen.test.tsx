import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminPledgeRow } from '../list-pledges-for-admin';

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@cmt/ui', () => ({ toast: mockToast }));

import { AdminPledgesScreen, CANCEL_WARNING } from '../components/admin-pledges-screen';

function row(over: Partial<AdminPledgeRow> = {}): AdminPledgeRow {
  return {
    pid: 'PLG-1', fid: 'CMT-A', familyName: 'Rao', status: 'active', monthlyAmountCAD: 51,
    startedAt: new Date('2026-02-01T12:00:00Z'), activatedAt: new Date('2026-02-03T12:00:00Z'),
    cancelledAt: null, cancellable: true, needsStripeVerification: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe('AdminPledgesScreen - the warning that has to be there', () => {
  it('says in as many words that cancelling here does not stop the debit', async () => {
    // The temple stops the real debit MANUALLY in Stripe. Left implicit, staff
    // click Cancel, believe the money stopped, and the family keeps being
    // charged. This assertion is the reason the copy is a named export.
    render(<AdminPledgesScreen rows={[row()]} />);
    expect(CANCEL_WARNING).toMatch(/cancel the actual debit in stripe/i);
    // getByRole, NOT getByText: a role query consults the ACCESSIBILITY TREE, so
    // a `hidden` attribute or aria-hidden fails it. getByText only proves the
    // string is somewhere in the DOM - a mutation that hid the banner left it in
    // the DOM and passed. The question this warning has to survive is "can a
    // human see it", not "is the string present".
    expect(screen.getByRole('note').textContent).toMatch(new RegExp(CANCEL_WARNING, 'i'));
  });

  it('repeats it at the moment of the click, not only in the banner', async () => {
    // By the time someone reaches the button, the banner has scrolled out of
    // mind. The confirmation is the last chance to say it.
    render(<AdminPledgesScreen rows={[row()]} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel the record for Rao/i }));
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('Cancel the actual debit in Stripe'));
  });

  it('shows the warning even when there are no pledges at all', async () => {
    // The empty state is what an admin sees before launch. If the warning only
    // rendered alongside rows, the first person to use this screen would meet
    // the button before the caveat.
    render(<AdminPledgesScreen rows={[]} />);
    expect(screen.getByRole('note').textContent).toMatch(new RegExp(CANCEL_WARNING, 'i'));
    expect(screen.getByText(/no monthly pledges yet/i)).toBeTruthy();
  });
});

describe('AdminPledgesScreen - the rows', () => {
  it('posts to the cancel route and marks the row cancelled', async () => {
    render(<AdminPledgesScreen rows={[row()]} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel the record for Rao/i }));
    expect(fetch).toHaveBeenCalledWith('/api/admin/pledges/PLG-1/cancel', { method: 'POST' });
    expect(screen.getByText('cancelled')).toBeTruthy();
    // And no second chance to cancel the same row.
    expect(screen.queryByRole('button', { name: /cancel the record/i })).toBeNull();
  });

  it('offers no cancel control for a pledge that is already settled', async () => {
    render(<AdminPledgesScreen rows={[row({ status: 'failed' }), row({ pid: 'PLG-2', status: 'cancelled' })]} />);
    expect(screen.queryByRole('button', { name: /cancel the record/i })).toBeNull();
  });

  it('offers a cancel control for a pledge that is only started', async () => {
    // The orphan case: a mandate that never confirmed still blocks the family
    // from starting a new one, so staff must be able to clear it.
    render(<AdminPledgesScreen rows={[row({ status: 'started', activatedAt: null })]} />);
    expect(screen.getByRole('button', { name: /cancel the record for Rao/i })).toBeTruthy();
  });

  it('surfaces a subscription created after the pledge left started', async () => {
    // The flag exists because a recorded subscriptionId that nothing displays is
    // not "findable by a human", it is merely present in Firestore. This is the
    // screen where someone would act on it, so this is where it has to appear -
    // and through the a11y tree, so hiding it fails.
    render(<AdminPledgesScreen rows={[row({ status: 'cancelled', needsStripeVerification: true })]} />);
    const flag = screen.getByRole('status', { name: /verify in stripe/i });
    expect(flag.textContent).toMatch(/verify in stripe/i);
  });

  it('shows no such flag on an ordinary row', async () => {
    // A badge on every row is a badge nobody reads.
    render(<AdminPledgesScreen rows={[row(), row({ pid: 'PLG-2', status: 'cancelled' })]} />);
    expect(screen.queryByRole('status', { name: /verify in stripe/i })).toBeNull();
  });

  it('still does not print the subscription id itself', async () => {
    // The FACT is actionable; the handle is not, and this page renders to HTML.
    render(<AdminPledgesScreen rows={[row({ status: 'cancelled', needsStripeVerification: true })]} />);
    expect(document.body.textContent ?? '').not.toMatch(/sub_/);
  });

  it('never renders a provider handle - they are not in the row type at all', async () => {
    render(<AdminPledgesScreen rows={[row()]} />);
    expect(document.body.textContent ?? '').not.toMatch(/cs_|sub_|cus_/);
  });

  it('falls back to the fid when a family name could not be joined', async () => {
    render(<AdminPledgesScreen rows={[row({ familyName: null })]} />);
    expect(screen.getAllByText('CMT-A').length).toBeGreaterThan(0);
  });

  it('treats a 409 as already-cancelled rather than a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    render(<AdminPledgesScreen rows={[row()]} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel the record for Rao/i }));
    expect(screen.getByText('cancelled')).toBeTruthy();
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/already cancelled/i));
  });

  it('leaves the row alone when the request fails', async () => {
    // The opposite of the 409 case: showing `cancelled` after a failed write
    // would tell staff the record changed when it did not.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<AdminPledgesScreen rows={[row()]} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel the record for Rao/i }));
    expect(screen.getByText('active')).toBeTruthy();
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

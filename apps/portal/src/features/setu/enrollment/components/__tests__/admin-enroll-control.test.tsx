import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

const enrollMock = vi.hoisted(() => vi.fn());
const overrideMock = vi.hoisted(() => vi.fn());
vi.mock('../../override-client', () => ({
  enrollFamilyAsAdmin: enrollMock,
  setEnrollmentOverride: overrideMock,
}));

import { AdminEnrollControl } from '../admin-enroll-control';

const OFFERING = {
  oid: 'bv-brampton-2026-27',
  programLabel: 'Bala Vihar',
  termLabel: '2026-27',
  suggestedAmount: 500,
};
const FID = 'CMT-O465XAZE';

beforeEach(() => {
  vi.clearAllMocks();
  enrollMock.mockResolvedValue({ ok: true, eid: `${FID}-bv-brampton-2026-27`, suggestedAmount: 500 });
  overrideMock.mockResolvedValue({ ok: true });
});

describe('AdminEnrollControl — enrol AND mark paid', () => {
  it('enrols first, then marks the resulting enrollment settled', async () => {
    const user = userEvent.setup();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /enrol and mark paid/i }));
    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - enrol and mark paid/i }));

    await waitFor(() => expect(overrideMock).toHaveBeenCalled());
    expect(enrollMock).toHaveBeenCalledWith(FID, OFFERING.oid);
    // The eid comes from the ENROLL response - it does not exist before it.
    expect(overrideMock).toHaveBeenCalledWith(`${FID}-bv-brampton-2026-27`, 0, 'existing PAD with CMT');
  });

  it('requires a reason before it will do anything', async () => {
    const user = userEvent.setup();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /enrol and mark paid/i }));

    expect(screen.getByRole('button', { name: /confirm - enrol and mark paid/i })).toBeDisabled();
    // Not even the ENROLLMENT should fire - a half-done action is worse here
    // than none, because enrolling is the visible half.
    expect(enrollMock).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The failure that must not read as a total failure. The enrollment DID
   * land; only the bookkeeping flag did not. Telling the admin "could not
   * enrol" would send them to do it a second time.
   */
  it('says the enrollment succeeded when only the mark-paid fails', async () => {
    overrideMock.mockResolvedValue({ ok: false, reason: 'error' });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: /enrol and mark paid/i }));
    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - enrol and mark paid/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/enrolled, but could not mark it paid/i)));
    // And the page still re-reads, because something DID change.
    expect(onDone).toHaveBeenCalled();
  });
});

describe('AdminEnrollControl — enrol only', () => {
  it('enrols without touching the override, and needs no reason', async () => {
    const user = userEvent.setup();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^enrol only$/i }));
    await user.click(screen.getByRole('button', { name: /confirm - enrol only/i }));

    await waitFor(() => expect(enrollMock).toHaveBeenCalledWith(FID, OFFERING.oid));
    // Marking a family settled who intends to pay in the portal would stop them
    // ever being asked. The two buttons mean two different things.
    expect(overrideMock).not.toHaveBeenCalled();
  });
});

describe('AdminEnrollControl — failures', () => {
  it('names the eligibility problem instead of "please try again"', async () => {
    enrollMock.mockResolvedValue({ ok: false, reason: 'no-eligible-members' });
    const user = userEvent.setup();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^enrol only$/i }));
    await user.click(screen.getByRole('button', { name: /confirm - enrol only/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/nobody in this family is eligible/i)));
    expect(overrideMock).not.toHaveBeenCalled();
  });

  it('does not mark anything paid when the enrollment itself failed', async () => {
    enrollMock.mockResolvedValue({ ok: false, reason: 'offering-unavailable' });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<AdminEnrollControl fid={FID} offering={OFFERING} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: /enrol and mark paid/i }));
    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - enrol and mark paid/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(overrideMock).not.toHaveBeenCalled();
    // Nothing changed, so the page must not be told it did.
    expect(onDone).not.toHaveBeenCalled();
  });
});

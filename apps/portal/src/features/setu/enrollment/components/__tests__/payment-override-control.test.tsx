import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The CLIENT WRAPPER is mocked, never `fetch` - so these assert against the code
// that reads the response, not against a mocked network.
const setOverrideMock = vi.hoisted(() => vi.fn());
vi.mock('../../override-client', () => ({ setEnrollmentOverride: setOverrideMock }));

import { PaymentOverrideControl } from '../payment-override-control';

const UNSET = {
  eid: 'CMT-F1-bv-brampton-2026-27',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  termLabel: '2026-27',
  effectiveSuggestedAmount: 500,
  suggestedAmountOverride: null,
};
const SETTLED = { ...UNSET, effectiveSuggestedAmount: 0, suggestedAmountOverride: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  setOverrideMock.mockResolvedValue({ ok: true });
});

describe('PaymentOverrideControl — the confirm step', () => {
  it('does not write on the first click; it opens a confirmation', async () => {
    const user = userEvent.setup();
    render(<PaymentOverrideControl enrollment={UNSET} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));

    // 🔴 The whole reason the confirm exists: this control sits on a page a
    // coordinator also reads, and a misclick means a household is never billed.
    expect(setOverrideMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('shows what the family currently owes before anything is changed', () => {
    render(<PaymentOverrideControl enrollment={UNSET} onDone={vi.fn()} />);
    expect(screen.getByText(/currently asked for \$500/i)).toBeTruthy();
  });
});

describe('PaymentOverrideControl — the note is required', () => {
  it('keeps Confirm disabled until a real reason is typed', async () => {
    const user = userEvent.setup();
    render(<PaymentOverrideControl enrollment={UNSET} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));

    const confirm = screen.getByRole('button', { name: /confirm - mark paid/i });
    expect(confirm).toBeDisabled();

    // Whitespace is the way a required field gets defeated in practice, and the
    // server trims before checking - so the form must agree, or the admin gets
    // an unexplained 400 after typing.
    await user.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: /confirm - mark paid/i })).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    expect(screen.getByRole('button', { name: /confirm - mark paid/i })).toBeEnabled();
  });

  it('sends the TRIMMED note and a zero amount', async () => {
    const user = userEvent.setup();
    render(<PaymentOverrideControl enrollment={UNSET} onDone={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));
    await user.type(screen.getByRole('textbox'), '  existing PAD with CMT  ');
    await user.click(screen.getByRole('button', { name: /confirm - mark paid/i }));

    await waitFor(() => expect(setOverrideMock).toHaveBeenCalledTimes(1));
    expect(setOverrideMock).toHaveBeenCalledWith(UNSET.eid, 0, 'existing PAD with CMT');
  });
});

describe('PaymentOverrideControl — undo', () => {
  it('offers Undo for an already-settled enrollment and clears with null, not 0', async () => {
    const user = userEvent.setup();
    render(<PaymentOverrideControl enrollment={SETTLED} onDone={vi.fn()} />);

    expect(screen.getByText(/marked settled outside the portal/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /undo/i }));
    await user.type(screen.getByRole('textbox'), 'set in error, family will pay online');
    await user.click(screen.getByRole('button', { name: /confirm undo/i }));

    // null REMOVES the override; 0 would re-assert "settled". The two are not
    // interchangeable and reversing them would silently do nothing.
    await waitFor(() => expect(setOverrideMock).toHaveBeenCalledWith(SETTLED.eid, null, 'set in error, family will pay online'));
  });
});

describe('PaymentOverrideControl — failures', () => {
  it('names the role problem rather than saying "try again"', async () => {
    setOverrideMock.mockResolvedValue({ ok: false, reason: 'forbidden' });
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<PaymentOverrideControl enrollment={UNSET} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));
    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - mark paid/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/only an admin/i)));
    // Nothing changed, so the page must NOT be told it did.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('re-reads only after a write that actually succeeded', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<PaymentOverrideControl enrollment={UNSET} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));
    await user.type(screen.getByRole('textbox'), 'existing PAD with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - mark paid/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalled();
  });
});

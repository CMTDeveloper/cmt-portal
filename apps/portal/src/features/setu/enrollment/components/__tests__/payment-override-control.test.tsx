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
  settledOffPortal: false,
  isAdultClass: false,
};
// An admin recorded an off-portal arrangement. THIS is what "settled" means.
const SETTLED = { ...UNSET, effectiveSuggestedAmount: 0, suggestedAmountOverride: 0, settledOffPortal: true };
// The Adult Study Class fee, waived because the family paid Bala Vihar
// (api/setu/adult-class/route.ts writes the same zero). Identical amount,
// completely different fact - and until 2026-08-04 this fixture did not exist,
// which is why the control rendered it as "settled" with an Undo button.
const WAIVED = {
  ...UNSET,
  // The program matters: `api/setu/adult-class/route.ts` is the ONLY writer of a
  // waiver zero, and it only ever enrols into this program.
  programKey: 'adult-study-class',
  programLabel: 'Adult Study Class',
  effectiveSuggestedAmount: 0,
  suggestedAmountOverride: 0,
  settledOffPortal: false,
  isAdultClass: true,
};
// ── The N=2 case, and the whole reason `isAdultClass` is a prop ──────────────
// Scarborough runs its OWN adult-class program (`adult-study-east`, created
// 2026-07-28) because CMT decided each centre may. A fixture with only the
// literal-keyed Brampton class above passes while the bug is live, which is
// exactly what happened: for one day the control asked
// `programKey === ADULT_STUDY_CLASS`, so this family's genuine waiver rendered
// as an unexplained zero WITH a "Mark paid off-portal" button - one click from
// recording a payment that never happened. Reported on FID 5010, 2026-08-04.
const WAIVED_OTHER_CENTRE = {
  ...WAIVED,
  eid: 'CMT-F1-adult-east-2026-27',
  programKey: 'adult-study-east',
  programLabel: 'Adult Class Scarborough',
};

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

// ─────────────────────────────────────────────────────────────────────────────
// A waiver is not a settlement (2026-08-04, found by Codex review)
// ─────────────────────────────────────────────────────────────────────────────
//
// Both are stored as `suggestedAmountOverride: 0`. This control read the amount
// and called both "settled", so a family with a paid Bala Vihar AND an Adult
// Study Class enrollment saw the WAIVED class labelled "Marked settled outside
// the portal" with an Undo button - and Undo clears the override, which starts
// billing them for a class their donation already covers.
describe('PaymentOverrideControl — a waiver is not a settlement', () => {
  it('does not call a Bala-Vihar-waived enrollment "settled"', () => {
    render(<PaymentOverrideControl enrollment={WAIVED} />);
    expect(screen.queryByText(/settled outside the portal/i)).toBeNull();
    expect(screen.getByText(/covered by this family/i)).toBeTruthy();
  });

  // The load-bearing one: no Undo means no way to clear a waiver by accident.
  it('offers NO action on a waived enrollment - there is nothing to undo', () => {
    render(<PaymentOverrideControl enrollment={WAIVED} />);
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark paid off-portal/i })).toBeNull();
  });

  // The other half of the distinction, so the fix cannot be "hide the button
  // whenever the amount is 0" - a genuinely settled family must keep its Undo.
  it('still offers Undo on a genuinely settled enrollment', () => {
    render(<PaymentOverrideControl enrollment={SETTLED} />);
    expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy();
    expect(screen.getByText(/settled outside the portal/i)).toBeTruthy();
  });

  // The two differ ONLY by the flag. If this ever passes with both fixtures
  // rendering the same thing, the component is back to reading the amount.
  it('renders the two zero-amount states differently', () => {
    const { unmount } = render(<PaymentOverrideControl enrollment={WAIVED} />);
    const waivedHasUndo = screen.queryByRole('button', { name: /undo/i }) !== null;
    unmount();
    render(<PaymentOverrideControl enrollment={SETTLED} />);
    const settledHasUndo = screen.queryByRole('button', { name: /undo/i }) !== null;
    expect(waivedHasUndo).toBe(false);
    expect(settledHasUndo).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A bare zero on any OTHER program is not a waiver (2026-08-04)
// ─────────────────────────────────────────────────────────────────────────────
//
// The production case, and one I broke while fixing the previous one: family
// CMT-SXO5QWFI was settled off-portal on 2026-08-04, hours BEFORE the
// settledOffPortal flag existed. Their Bala Vihar enrollment therefore carries
// `suggestedAmountOverride: 0` with no flag. Treating every bare zero as a
// waiver told them "covered by this family's Bala Vihar donation" on their Bala
// Vihar enrollment - and, far worse, removed the only button an admin could use
// to re-record the settlement, which is exactly the remediation the runbook
// documents.
const LEGACY_SETTLED = { ...UNSET, effectiveSuggestedAmount: 0, suggestedAmountOverride: 0 };

describe('PaymentOverrideControl — a bare zero outside the adult class', () => {
  it('does NOT claim a Bala Vihar enrollment is covered by its own donation', () => {
    render(<PaymentOverrideControl enrollment={LEGACY_SETTLED} />);
    expect(screen.queryByText(/covered by this family/i)).toBeNull();
    expect(screen.getByText(/no reason recorded/i)).toBeTruthy();
  });

  // 🔴 The load-bearing one. Without this button the documented fix for the one
  // affected production family is impossible through the UI.
  it('still offers "Mark paid off-portal", so the settlement can be re-recorded', () => {
    render(<PaymentOverrideControl enrollment={LEGACY_SETTLED} />);
    expect(screen.getByRole('button', { name: /mark paid off-portal/i })).toBeTruthy();
  });

  // Never Undo on a zero nobody explained: it might be clearing something
  // load-bearing, and the amount alone cannot tell us which.
  it('does not offer Undo on an unattributed zero', () => {
    render(<PaymentOverrideControl enrollment={LEGACY_SETTLED} />);
    expect(screen.queryByRole('button', { name: /^undo$/i })).toBeNull();
  });

  it('writes the flag when that button is used, which is what fixes the roster', async () => {
    const user = userEvent.setup();
    render(<PaymentOverrideControl enrollment={LEGACY_SETTLED} onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /mark paid off-portal/i }));
    await user.type(screen.getByRole('textbox'), 'existing pre-authorized debit with CMT');
    await user.click(screen.getByRole('button', { name: /confirm - mark paid/i }));

    // Amount 0 is what the route turns into `settledOffPortal: true`.
    await waitFor(() =>
      expect(setOverrideMock).toHaveBeenCalledWith(LEGACY_SETTLED.eid, 0, 'existing pre-authorized debit with CMT'),
    );
  });
});


describe('PaymentOverrideControl — a centre whose adult class is its own program', () => {
  // Guards the one-day regression: these assertions all PASS for the
  // literal-keyed Brampton fixture while failing for Scarborough's, so a
  // single-program fixture cannot catch it. Keep BOTH.
  it('treats a waived enrollment as waived even when the key is not the literal one', () => {
    render(<PaymentOverrideControl enrollment={WAIVED_OTHER_CENTRE} />);
    expect(
      // Matched loosely on purpose: the copy uses a typographic apostrophe
      // (family’s), and a plain ' in the pattern silently never matches.
      screen.getByText(/covered by this family/i),
    ).toBeInTheDocument();
  });

  it('does NOT label it "no reason recorded" - the reason is known', () => {
    render(<PaymentOverrideControl enrollment={WAIVED_OTHER_CENTRE} />);
    expect(screen.queryByText(/no reason recorded/i)).not.toBeInTheDocument();
  });

  it('offers NO button, so a waiver cannot be mis-recorded as money collected', () => {
    render(<PaymentOverrideControl enrollment={WAIVED_OTHER_CENTRE} />);
    expect(screen.queryByRole('button', { name: /mark paid off-portal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });

  it('still shows the action on a NON-adult-class bare zero at the same centre', () => {
    // The scope must not widen into "any zero is a waiver": the one production
    // family settled before the flag existed needs that button to re-record it.
    render(
      <PaymentOverrideControl
        enrollment={{ ...WAIVED_OTHER_CENTRE, programKey: 'bala-vihar', isAdultClass: false }}
      />,
    );
    expect(screen.getByRole('button', { name: /mark paid off-portal/i })).toBeInTheDocument();
  });
});

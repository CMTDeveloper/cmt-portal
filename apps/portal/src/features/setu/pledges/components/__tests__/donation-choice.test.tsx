import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@cmt/ui', async () => {
  const actual = await vi.importActual<typeof import('@cmt/ui')>('@cmt/ui');
  return { ...actual, toast: toastMock };
});

const checkoutMock = vi.hoisted(() => ({
  startEnrollmentCheckout: vi.fn(),
  startPledgeCheckout: vi.fn(),
  enrollFamily: vi.fn(),
}));
vi.mock('@/features/family/components/enroll-client', () => ({
  enrollFamily: checkoutMock.enrollFamily,
}));
vi.mock('@/features/family/components/start-checkout-client', () => ({
  startEnrollmentCheckout: checkoutMock.startEnrollmentCheckout,
}));
vi.mock('@/features/family/components/start-pledge-client', () => ({
  startPledgeCheckout: checkoutMock.startPledgeCheckout,
}));

import { DonationChoice } from '../donation-choice';

const EID = 'CMT-P672RGSS-bv-brampton-2026-27';

const base = {
  eid: EID,
  oneTimeAmountCAD: 500,
  monthlyAmountCAD: 51,
  canStartPledge: true,
  pledgeState: 'none' as const,
};

beforeEach(() => {
  toastMock.error.mockReset();
  checkoutMock.startEnrollmentCheckout.mockReset();
  checkoutMock.startPledgeCheckout.mockReset();
  checkoutMock.enrollFamily.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '', reload: vi.fn() },
  });
});

describe('DonationChoice - the choice itself', () => {
  it('offers both options as one radio group, with the one-time amount preselected', () => {
    render(<DonationChoice {...base} />);
    const full = screen.getByRole('radio', { name: /full donation/i });
    const monthly = screen.getByRole('radio', { name: /monthly pledge/i });
    // getByRole, not getByText: a radio that is present but not perceivable as
    // checked is the bug this asserts against.
    expect(full).toBeChecked();
    expect(monthly).not.toBeChecked();
    // ONE call to action, not two competing buttons - that ambiguity is the
    // whole reason this component replaced the two stacked CTAs.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sends the family to Stripe checkout when the one-time option is chosen', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_live_1' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_live_1'));
    expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledWith(EID, 500);
    expect(checkoutMock.startPledgeCheckout).not.toHaveBeenCalled();
  });

  it('sends the family to the hosted mandate page when the monthly option is chosen', async () => {
    const user = userEvent.setup();
    checkoutMock.startPledgeCheckout.mockResolvedValueOnce({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_pad' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('radio', { name: /monthly pledge/i }));
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_test_pad'));
    expect(checkoutMock.startPledgeCheckout).toHaveBeenCalledTimes(1);
    // The one-time path must NOT also fire - that would be a double charge.
    expect(checkoutMock.startEnrollmentCheckout).not.toHaveBeenCalled();
  });
});

describe('DonationChoice - TWO instances on one page (mobile tree + desktop tree)', () => {
  // 🔴 Found on deployed preview, not here: the enroll page keeps BOTH layout
  // trees in the DOM (`block md:hidden` / `hidden md:block`). With a shared
  // radio-group `name`, the browser treats them as ONE group and the
  // second-rendered instance steals `checked` from the first - the desktop radio
  // rendered filled while the PHONE's rendered empty, beside a card still tinted
  // as selected. A duplicated `id` made it worse: `<label htmlFor>` binds to the
  // first match in document order, so the desktop label drove the mobile input.
  //
  // Every test above renders ONE instance and passes either way. This is the
  // N=2 case, and it is the only shape that can catch it.
  function renderBothTrees() {
    return render(
      <>
        <DonationChoice {...base} />
        <DonationChoice {...base} />
      </>,
    );
  }

  it('checks the default option in BOTH trees, not just the last one rendered', () => {
    renderBothTrees();
    const full = screen.getAllByRole('radio', { name: /full donation/i });
    expect(full).toHaveLength(2);
    for (const radio of full) expect(radio).toBeChecked();
  });

  it('gives each tree its own radio group, so one cannot deselect the other', async () => {
    const user = userEvent.setup();
    renderBothTrees();
    const monthly = screen.getAllByRole('radio', { name: /monthly pledge/i });

    await user.click(monthly[0]!);

    // The first tree switched; the second is untouched. Under a shared name the
    // click would have driven both.
    expect(monthly[0]!).toBeChecked();
    expect(monthly[1]!).not.toBeChecked();
    expect(screen.getAllByRole('radio', { name: /full donation/i })[1]!).toBeChecked();
  });

  it('gives every input a unique id, so a label cannot target the wrong tree', () => {
    renderBothTrees();
    const ids = screen.getAllByRole('radio').map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('DonationChoice - a family that has NOT enrolled yet', () => {
  // The choice originally rendered only for already-enrolled families, so a
  // family joining for the FIRST time - exactly who is deciding how to pay - was
  // still met by the old pair of buttons ("Enroll →" plus a separate "Give $51
  // monthly"). Both answers need an enrollment: the one-time checkout pins to an
  // eid, and a monthly plan funding Bala Vihar for a family not IN Bala Vihar is
  // nonsense. So this click enrols, then pays.
  const notEnrolled = { ...base, eid: null, enrollOid: 'bv-brampton-2026-27' };

  it('says it will enrol, rather than doing it silently under "Continue"', () => {
    render(<DonationChoice {...notEnrolled} />);
    expect(screen.getByRole('button', { name: /enroll and continue/i })).toBeInTheDocument();
  });

  it('enrols first, then sends the family to the one-time checkout', async () => {
    const user = userEvent.setup();
    checkoutMock.enrollFamily.mockResolvedValueOnce({ ok: true, eid: 'NEW-EID', suggestedAmount: 500, donateUrl: null });
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_1' });

    render(<DonationChoice {...notEnrolled} />);
    await user.click(screen.getByRole('button', { name: /enroll and continue/i }));

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_1'));
    expect(checkoutMock.enrollFamily).toHaveBeenCalledWith('bv-brampton-2026-27');
    // The eid the SERVER just minted, not the null prop.
    expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledWith('NEW-EID', 500);
  });

  it('enrols first, then sends the family to the hosted mandate page', async () => {
    const user = userEvent.setup();
    checkoutMock.enrollFamily.mockResolvedValueOnce({ ok: true, eid: 'NEW-EID', suggestedAmount: 500, donateUrl: null });
    checkoutMock.startPledgeCheckout.mockResolvedValueOnce({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_pad' });

    render(<DonationChoice {...notEnrolled} />);
    await user.click(screen.getByRole('radio', { name: /monthly pledge/i }));
    await user.click(screen.getByRole('button', { name: /enroll and continue/i }));

    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/c/pay/cs_pad'));
    // Enrolment still happens on the monthly path - a pledge funding a programme
    // the family has not joined would be nonsense.
    expect(checkoutMock.enrollFamily).toHaveBeenCalledTimes(1);
    expect(checkoutMock.startEnrollmentCheckout).not.toHaveBeenCalled();
  });

  it('prefers the SERVER-resolved amount over the rendered one', async () => {
    // The page's figure can be stale by the time this runs; the server re-derives
    // the floor, so its answer wins.
    const user = userEvent.setup();
    checkoutMock.enrollFamily.mockResolvedValueOnce({ ok: true, eid: 'NEW-EID', suggestedAmount: 250, donateUrl: null });
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: true, url: 'https://x' });

    render(<DonationChoice {...notEnrolled} oneTimeAmountCAD={500} />);
    await user.click(screen.getByRole('button', { name: /enroll and continue/i }));

    await waitFor(() => expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledWith('NEW-EID', 250));
  });

  it('touches NEITHER payment path when enrolment fails', async () => {
    // Enrolment is free and reversible; the payment after it is neither. A
    // failure must stop before any money moves.
    const user = userEvent.setup();
    checkoutMock.enrollFamily.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'Add a child to your family before enrolling in Bala Vihar.' });

    render(<DonationChoice {...notEnrolled} />);
    const cta = screen.getByRole('button', { name: /enroll and continue/i });
    await user.click(cta);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/Add a child/)),
    );
    expect(checkoutMock.startEnrollmentCheckout).not.toHaveBeenCalled();
    expect(checkoutMock.startPledgeCheckout).not.toHaveBeenCalled();
    expect(cta).not.toBeDisabled();
  });

  it('does not re-enrol a family that already has an eid', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: true, url: 'https://x' });

    render(<DonationChoice {...base} enrollOid="bv-brampton-2026-27" />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));

    await waitFor(() => expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalled());
    expect(checkoutMock.enrollFamily).not.toHaveBeenCalled();
  });
});

describe('DonationChoice - who may commit the family to a debit', () => {
  it('does not let a non-manager select the monthly plan', async () => {
    render(<DonationChoice {...base} canStartPledge={false} />);
    expect(screen.getByRole('radio', { name: /monthly pledge/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /full donation/i })).toBeChecked();
  });

  it('says WHY the monthly plan is unavailable rather than just greying it out', () => {
    render(<DonationChoice {...base} canStartPledge={false} />);
    // A disabled control with no explanation reads as a broken page.
    expect(screen.getByText(/only the family manager/i)).toBeInTheDocument();
  });
});

describe('DonationChoice - a pledge that is still confirming', () => {
  // 🔴 The double-charge hole. A mandate takes days to settle. If the family can
  // still pay $500 while it confirms, they are charged BOTH, and the portal
  // cannot undo it: there is no cancel endpoint and cancelPledgeRecord is
  // bookkeeping only. So a pending pledge gets NO payment control whatsoever.
  it('offers no payment control at all while a pledge is confirming', () => {
    render(<DonationChoice {...base} pledgeState="pending" />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    // PAYMENT controls specifically. The "start over" escape hatch below is not
    // one - it cancels an unfinished attempt and can never move money.
    expect(screen.queryByRole('button', { name: /donation|monthly|pay|continue/i })).not.toBeInTheDocument();
  });

  it('reassures rather than instructs, and says how to change course', () => {
    render(<DonationChoice {...base} pledgeState="pending" />);
    expect(screen.getByText(/setting up your monthly/i)).toBeInTheDocument();
    expect(screen.getByText(/temple office/i)).toBeInTheDocument();
  });

});

describe('DonationChoice - a family already giving monthly', () => {
  it('shows the live plan and never asks for money a second time', () => {
    render(<DonationChoice {...base} pledgeState="giving" />);
    expect(screen.getByText(/\$51 a month/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('still lets an unenrolled family join - they are already paying for it', () => {
    // The stranded state one step further on: the mandate settled, the money is
    // moving, and the family is funding a program they are not in.
    render(<DonationChoice {...base} eid={null} enrollOid="bv-brampton-2026-27" pledgeState="giving" />);
    expect(screen.getByRole('button', { name: /enroll/i })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

describe('DonationChoice - error handling carried over from the two buttons it replaces', () => {
  it('routes an expired session to sign-in instead of showing a toast', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({ ok: false, reason: 'unauthorized' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.href).toBe('/sign-in?from=%2Ffamily'));
  });

  it('reloads on an already-live pledge rather than reporting a failure', async () => {
    const user = userEvent.setup();
    checkoutMock.startPledgeCheckout.mockResolvedValueOnce({ ok: false, reason: 'already-live' });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('radio', { name: /monthly pledge/i }));
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
  });

  it('reloads instead of telling the family to retry when a pledge already covers this', async () => {
    // The server 409s because a pledge was started elsewhere after this page
    // rendered - another tab, or a co-manager's device. Retrying can NEVER
    // clear that, so folding it into "please try again" is wrong advice about
    // money. A reload re-runs the server render, which shows the pledge state.
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockResolvedValueOnce({
      ok: false,
      reason: 'pledge-covers-enrollment',
    });
    render(<DonationChoice {...base} />);
    await user.click(screen.getByRole('button', { name: /continue to donation/i }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/already covers/i));
  });

  it('surfaces a network failure and re-enables the button so the family can retry', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockRejectedValueOnce(new Error('offline'));
    render(<DonationChoice {...base} />);
    const cta = screen.getByRole('button', { name: /continue to donation/i });
    await user.click(cta);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(cta).not.toBeDisabled();
  });

  it('cannot be double-submitted while a redirect is in flight', async () => {
    const user = userEvent.setup();
    checkoutMock.startEnrollmentCheckout.mockImplementation(() => new Promise(() => {}));
    render(<DonationChoice {...base} />);
    const cta = screen.getByRole('button', { name: /continue to donation/i });
    await user.click(cta);
    await waitFor(() => expect(cta).toBeDisabled());
    await user.click(cta);
    expect(checkoutMock.startEnrollmentCheckout).toHaveBeenCalledTimes(1);
  });
});

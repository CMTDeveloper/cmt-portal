import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FamilyPledgeView } from '@/features/setu/pledges/select-family-pledge';

vi.mock('@cmt/ui', () => ({
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="glyph" /> }),
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { PledgeCard } from '../pledge-card';

/**
 * This card talks to a family about a recurring debit from their bank account.
 * Every assertion below exists because the wrong wording or the wrong number
 * would be a lie about someone's money, not a cosmetic bug.
 */

function pledge(over: Partial<FamilyPledgeView> = {}): FamilyPledgeView {
  return {
    pid: 'PLG-1',
    status: 'active',
    monthlyAmountCAD: 51,
    startedAt: new Date('2026-02-01T12:00:00Z'),
    activatedAt: new Date('2026-02-03T12:00:00Z'),
    ...over,
  };
}

/** Anything that would read as "your monthly gift is working". */
const SUCCESS_CLAIMS = [/you're giving/i, /you are giving/i, /thank you/i, /is set up/i, /active/i];

describe('PledgeCard', () => {
  describe('no pledge yet - the ask', () => {
    // Deliberately NOT 51. Every ask assertion below uses an amount the code
    // could not have hardcoded, because a mutation run showed that a literal
    // `$51` in the copy passed a suite whose every fixture also said 51 - the
    // fixture could not distinguish the bug from the prop.
    const ASK = 63;

    it('asks for the CURRENT monthly amount and offers a start button to a manager', () => {
      render(<PledgeCard pledge={null} askAmountCAD={ASK} canStart canAsk />);
      expect(screen.getByText(/\$63 a month/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /give \$63 monthly/i })).toBeTruthy();
    });

    it('shows the ask but NO button to a non-manager', () => {
      // A second parent on the account can see that the temple offers this; only
      // the manager can commit the family's bank account to it.
      render(<PledgeCard pledge={null} askAmountCAD={ASK} canStart={false} canAsk />);
      expect(screen.getByText(/\$63 a month/i)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders NOTHING on a surface that does not solicit', () => {
      // No pledge to report and no ask permitted leaves an empty "Monthly
      // giving" heading, which is worse than no card.
      const { container } = render(<PledgeCard pledge={null} askAmountCAD={ASK} canStart />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  // ── 🔴 A surface must OPT IN to soliciting ─────────────────────────────────
  //
  // Reported by CMT Developer 2026-07-28 with a screenshot of `/family`: a
  // family reading "Bala Vihar · Not enrolled · Enroll now" had, directly
  // beneath it, "Your previous monthly gift isn't active. You can set one up
  // again below." and "Support the mission with $51 a month" - with NOTHING
  // below, because the dashboard hardcodes `canStart={false}`.
  //
  // Three faults in one card: a dangling "below", a general "support the
  // mission" ask that Vaibhav ruled out ("This should not be separate. It's
  // part of Bala Vihar"), and a solicitation beside a Not-enrolled status,
  // which `pledge.spec.ts` already names as a rule.
  //
  // `canStart` could not express this: it means "may commit the family to a
  // debit", and a non-manager legitimately still SEES the ask (above). So
  // whether a surface solicits at all is its own prop - and it defaults to
  // false, because a money ask should have to be asked for.
  describe('a surface that reports but does not solicit', () => {
    it.each([['failed'], ['cancelled']] as const)(
      '%s renders NOTHING - there is no plan to report',
      (status) => {
        // CMT Developer, 2026-07-28, on seeing the neutral version: "I think we
        // can hide this." A card whose entire content is "you do not have one of
        // these" is noise on a dashboard already headed "Not enrolled · Enroll
        // now". The card exists to REPORT a plan; with no plan in play there is
        // nothing to report and, on this surface, nothing to ask.
        //
        // Accepted trade: a family whose mandate FAILED at the bank now gets no
        // dashboard notice. The temple manages cancellations by hand and
        // contacts families directly, so the signal was never this card's alone.
        const { container } = render(
          <PledgeCard pledge={pledge({ status })} askAmountCAD={63} canStart={false} />,
        );
        expect(container).toBeEmptyDOMElement();
      },
    );

    it('still reports a LIVE plan - reporting is the whole point of the card', () => {
      render(<PledgeCard pledge={pledge({ monthlyAmountCAD: 51 })} askAmountCAD={63} canStart={false} />);
      expect(screen.getByText(/\$51 monthly/i)).toBeTruthy();
    });

    it('still reports one that is CONFIRMING', () => {
      render(
        <PledgeCard
          pledge={pledge({ status: 'started', activatedAt: null })}
          askAmountCAD={63}
          canStart={false}
        />,
      );
      expect(screen.getByText(/setting up your monthly gift/i)).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('started - the state that must not lie', () => {
    it('says it is still being set up and makes NO success claim', () => {
      render(<PledgeCard pledge={pledge({ status: 'started', activatedAt: null })} askAmountCAD={51} canStart />);
      expect(screen.getByText(/setting up your monthly gift/i)).toBeTruthy();
      expect(screen.getByText(/few days to confirm/i)).toBeTruthy();
      // The whole point of the `started` state: the mandate may still fail, and
      // a family told "thank you, you're giving" would never look again.
      const body = document.body.textContent ?? '';
      for (const claim of SUCCESS_CLAIMS) {
        expect(claim.test(body), `"${claim}" appears while the pledge is only \`started\``).toBe(false);
      }
    });

    it('offers NO start button while one is in flight', () => {
      // startPledge() would 409 anyway, but a button that always errors is worse
      // than no button - and a second hosted session risks a SECOND mandate.
      render(<PledgeCard pledge={pledge({ status: 'started', activatedAt: null })} askAmountCAD={51} canStart />);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('active', () => {
    it('renders the SNAPSHOTTED amount, not what a new pledge would cost today', () => {
      // The amount is snapshotted at start precisely so a later price change
      // never rewrites what an existing pledge says it is. If this card reads
      // the ask amount, that guarantee is destroyed at the one place it matters.
      // 51 vs 61 - the fixture distinguishes the bug from the fix.
      render(<PledgeCard pledge={pledge({ monthlyAmountCAD: 51 })} askAmountCAD={61} canStart />);
      expect(screen.getByText(/\$51 monthly/i)).toBeTruthy();
      expect((document.body.textContent ?? '').includes('61')).toBe(false);
    });

    it('names the date giving began, in Toronto time', () => {
      render(<PledgeCard pledge={pledge({ activatedAt: new Date('2026-02-03T12:00:00Z') })} askAmountCAD={51} canStart />);
      expect(screen.getByText(/February 3, 2026/)).toBeTruthy();
    });

    it('offers no way to start a second one', () => {
      render(<PledgeCard pledge={pledge()} askAmountCAD={51} canStart />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('survives a missing activation date without printing Invalid Date or null', () => {
      render(<PledgeCard pledge={pledge({ activatedAt: null })} askAmountCAD={51} canStart />);
      const body = document.body.textContent ?? '';
      expect(body).toMatch(/\$51 monthly/i);
      expect(body).not.toMatch(/invalid date|null|NaN/i);
    });
  });

  describe('failed and cancelled - back to the ask', () => {
    it.each([['failed'], ['cancelled']] as const)('%s returns to the ask with a neutral line', (status) => {
      render(<PledgeCard pledge={pledge({ status })} askAmountCAD={63} canStart canAsk />);
      expect(screen.getByText(/\$63 a month/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /give \$63 monthly/i })).toBeTruthy();
      // Neutral: it must not blame the family or imply a bank problem.
      expect(screen.getByText(/didn't get set up|was not set up|isn't active/i)).toBeTruthy();
    });

    it('asks at TODAY\'s amount after a failure, not the amount of the failed attempt', () => {
      // They are signing a NEW mandate; quoting the stale amount would commit
      // them to a number the Price no longer charges.
      render(<PledgeCard pledge={pledge({ status: 'failed', monthlyAmountCAD: 41 })} askAmountCAD={63} canStart canAsk />);
      expect(screen.getByText(/\$63 a month/i)).toBeTruthy();
      expect((document.body.textContent ?? '').includes('41')).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendManagedEmail } = vi.hoisted(() => ({ sendManagedEmail: vi.fn() }));
vi.mock('@/lib/aws/send-managed-email', () => ({ sendManagedEmail }));

import {
  sendBvDonationCompleteEmail,
  sendBvPledgeCompleteEmail,
  sendBvDonationPendingEmail,
  bvEmailRecipient,
  formatAmountForTemplate,
} from '../bv-enrollment-emails';

// A BLOCK body, not `() => expr`. The concise form implicitly RETURNS the mock
// function, and vitest inspects a hook's return value - which was enough to make
// a later mocked failure surface as a spurious test failure while the code under
// test was provably swallowing it. Return nothing from hooks.
beforeEach(() => {
  sendManagedEmail.mockReset();
  sendManagedEmail.mockResolvedValue(undefined);
});

const TO = { to: 'parent@example.com', registrantName: 'Asha Rao' };

// ── The placeholder names are SES's contract, not ours ───────────────────────
// SES does NOT fail a send when a placeholder goes unfilled: it renders the
// message with a blank and still returns a MessageId. So a renamed or misspelled
// key here is invisible to every log and every test that only checks "an email
// was sent" - it surfaces as a family receiving "Dear ,". These assert the exact
// keys CMT's templates declare.
describe('the SES data keys', () => {
  it('donation complete sends registrant_name + donation_amount', async () => {
    await sendBvDonationCompleteEmail(TO, 500);
    const call = sendManagedEmail.mock.calls[0]![0];
    expect(call.name).toBe('bv-enrolled-donation-complete');
    expect(call.to).toBe('parent@example.com');
    expect(Object.keys(call.data).sort()).toEqual(['donation_amount', 'registrant_name']);
    expect(call.data).toEqual({ registrant_name: 'Asha Rao', donation_amount: '500' });
  });

  it('pledge complete sends registrant_name + donation_amount (the MONTHLY figure)', async () => {
    await sendBvPledgeCompleteEmail(TO, 51);
    const call = sendManagedEmail.mock.calls[0]![0];
    expect(call.name).toBe('bv-enrolled-pledge-complete');
    expect(call.data).toEqual({ registrant_name: 'Asha Rao', donation_amount: '51' });
  });

  it('pending sends registrant_name + registration_link, and NO amount', async () => {
    await sendBvDonationPendingEmail(TO, 'https://cmt-setu.vercel.app/family/enroll/bala-vihar');
    const call = sendManagedEmail.mock.calls[0]![0];
    expect(call.name).toBe('bv-enrolled-donation-pending');
    expect(Object.keys(call.data).sort()).toEqual(['registrant_name', 'registration_link']);
    expect(call.data.registration_link).toBe(
      'https://cmt-setu.vercel.app/family/enroll/bala-vihar',
    );
  });
});

// The SES copy reads `CAD ${{donation_amount}}` - the dollar sign is the
// TEMPLATE's. A value carrying its own would render "CAD $$500".
describe('formatAmountForTemplate', () => {
  it('never includes a currency symbol', () => {
    expect(formatAmountForTemplate(500)).toBe('500');
    expect(formatAmountForTemplate(500)).not.toContain('$');
  });

  it('leaves a whole number bare and gives cents two places', () => {
    expect(formatAmountForTemplate(51)).toBe('51');
    expect(formatAmountForTemplate(51.5)).toBe('51.50');
    expect(formatAmountForTemplate(0)).toBe('0');
  });
});

describe('never throws - the money already moved', () => {
  it('swallows a send failure', async () => {
    // ── A SYNCHRONOUS throw, not a rejected promise ─────────────────────────
    // A mock that returns a rejected promise leaves that promise in the spy's
    // `mock.results`, and vitest reports it as a failure at cleanup no matter
    // what the code under test does - even `.catch(() => {})` on our own
    // reference does not stop it. Isolating the call in a try/catch printed
    // "DID NOT THROW" while the harness still failed the test, so the swallow
    // was always working and the red was entirely the mock's shape.
    //
    // Throwing synchronously is equivalent for this code path - `await` on a
    // call that throws before returning still lands in the same catch - and it
    // creates no promise for the harness to track.
    sendManagedEmail.mockImplementation(() => {
      throw new Error('SES exploded');
    });

    // A bare await IS the assertion: a regressed swallow propagates and fails.
    await sendBvDonationCompleteEmail(TO, 500);
    expect(sendManagedEmail).toHaveBeenCalledTimes(1);
  });

  it('sends nothing, and does not throw, without an address', async () => {
    await expect(
      sendBvDonationCompleteEmail({ to: null, registrantName: 'Asha' }, 500),
    ).resolves.toBeUndefined();
    expect(sendManagedEmail).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only address as absent', async () => {
    await sendBvDonationCompleteEmail({ to: '   ', registrantName: 'Asha' }, 500);
    expect(sendManagedEmail).not.toHaveBeenCalled();
  });
});

describe('bvEmailRecipient', () => {
  const members = [
    { mid: 'M1', email: 'manager@example.com', firstName: 'Manager', lastName: 'One' },
    { mid: 'M2', email: 'second@example.com', firstName: 'Second', lastName: 'Two' },
    { mid: 'M3', email: null, firstName: 'NoMail', lastName: 'Three' },
  ];

  it('prefers the signed-in member, so a co-manager is greeted by their OWN name', () => {
    expect(bvEmailRecipient(members, 'M2', ['M1'])).toEqual({
      to: 'second@example.com',
      registrantName: 'Second Two',
    });
  });

  it('falls back to the manager when there is no session (the kiosk)', () => {
    expect(bvEmailRecipient(members, null, ['M1'])).toEqual({
      to: 'manager@example.com',
      registrantName: 'Manager One',
    });
  });

  // The trap: a preferred member with no address must not "win" and silently
  // send nothing, because `to: null` makes the whole send a no-op.
  it('skips a preferred member who has no address rather than sending nowhere', () => {
    expect(bvEmailRecipient(members, 'M3', ['M1'])).toEqual({
      to: 'manager@example.com',
      registrantName: 'Manager One',
    });
  });

  it('falls back to any reachable member when no manager has an address', () => {
    expect(bvEmailRecipient(members, null, ['M3'])).toEqual({
      to: 'manager@example.com',
      registrantName: 'Manager One',
    });
  });

  it('reports no address rather than guessing when nobody has one', () => {
    expect(bvEmailRecipient([{ mid: 'M3', email: null }], 'M3', [])).toEqual({
      to: null,
      registrantName: '',
    });
  });
});

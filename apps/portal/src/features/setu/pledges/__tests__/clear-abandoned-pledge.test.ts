import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSubmission, mockFind, mockCancel, mockNotify } = vi.hoisted(() => ({
  mockSubmission: vi.fn(),
  mockFind: vi.fn(),
  mockCancel: vi.fn(),
  mockNotify: vi.fn(),
}));
vi.mock('../stripe-pad-client', () => ({ getCheckoutSessionSubmission: mockSubmission }));
vi.mock('../find-started-pledge', () => ({ findStartedPledge: mockFind }));
vi.mock('../cancel-pledge', () => ({ cancelPledgeRecord: mockCancel }));
vi.mock('../notify-pledge-abandoned', () => ({ notifyPledgeAbandoned: mockNotify }));

import { clearAbandonedPledge } from '../clear-abandoned-pledge';

beforeEach(() => {
  mockFind.mockReset();
  mockFind.mockResolvedValue({ pid: 'PLG-1', setupSessionId: 'cs_test_1' });
  mockSubmission.mockReset();
  mockSubmission.mockResolvedValue('not-submitted');
  mockCancel.mockReset();
  mockCancel.mockResolvedValue({ ok: true });
  mockNotify.mockReset();
  mockNotify.mockResolvedValue(undefined);
});

/**
 * Vaibhav, 2026-07-29: *"If someone selects the Pledge option, and not complete,
 * then the process is not complete and they need to be taken back to options
 * again... It's for family to start the donation process again and complete on
 * their own since this is complete self serve."*
 *
 * This resolves that state instead of describing it, so no screen needs an
 * "you abandoned this" branch. The whole risk sits in one question - could a
 * mandate exist? - and every test below is about answering it conservatively.
 */
describe('clearAbandonedPledge', () => {
  it('clears an attempt Stripe says was never submitted', async () => {
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('cleared');
    expect(mockSubmission).toHaveBeenCalledWith('cs_test_1');
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ pid: 'PLG-1' }));
  });

  // 🔴 The one that matters. Clearing a record while a real mandate exists lets
  // the family authorise a SECOND bank debit, and the portal can stop neither -
  // there is no cancel endpoint, and the temple stops debits by hand in Stripe.
  it('leaves a SUBMITTED mandate alone', async () => {
    mockSubmission.mockResolvedValue('submitted');
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('in-play');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the provider cannot be asked - unknown is not permission', async () => {
    mockSubmission.mockRejectedValue(new Error('unreachable'));
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('in-play');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the pledge cannot even be read', async () => {
    // A Firestore blip must not decide anything about money.
    mockFind.mockRejectedValue(new Error('UNAVAILABLE'));
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('in-play');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('clears without asking when the pledge never got a session id', async () => {
    // The provider call never landed at start, so nothing can exist at Stripe.
    mockFind.mockResolvedValue({ pid: 'PLG-2', setupSessionId: null });
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('cleared');
    expect(mockSubmission).not.toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ pid: 'PLG-2' }));
  });

  it('does nothing when no attempt is in flight', async () => {
    mockFind.mockResolvedValue(null);
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('none');
    expect(mockSubmission).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('treats a lost race as cleared - the pledge is no longer blocking either way', async () => {
    mockCancel.mockResolvedValue({ ok: false, reason: 'already-cancelled' });
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('cleared');
  });

  // 🔴 Callers include server components rendering a WHOLE PAGE. A transient
  // Firestore blip must cost this repair and nothing else - `loadPledgeSlot`
  // takes the same care so the dashboard never 500s over an optional ask. Codex
  // caught that the write path was the one step left unwrapped, so a DB hiccup
  // would have taken down the enroll page for every family with a live pledge.
  it('NEVER THROWS when the cancel write fails - it degrades to in-play', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCancel.mockRejectedValue(new Error('UNAVAILABLE'));
    await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('in-play');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('records the SYSTEM as the actor, not a human who decided nothing', async () => {
    await clearAbandonedPledge('CMT-A');
    expect(mockCancel).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ uid: 'system:abandoned-pad-session' }) }),
    );
  });

  /**
   * Vaibhav, 2026-07-30: *"i did not get donation pending email for
   * family15@gmail.com when I tried PAD option, and cancelled"*.
   *
   * The letter had no trigger on this path at all - `notifyDonationAbandoned` is
   * keyed on a donations document, and the pledge flow never creates one. These
   * pin the trigger to the one branch that actually cleared an attempt.
   */
  describe('the abandonment letter', () => {
    it('goes out when THIS call cleared the attempt', async () => {
      await clearAbandonedPledge('CMT-A');
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ fid: 'CMT-A' }));
    });

    // 🔴 The family may still be authorising the mandate. Telling them their
    // donation is unfinished would be false, and would burn the 7-day cooldown
    // the genuine abandonment needs later.
    it('is NOT sent when a mandate may exist', async () => {
      mockSubmission.mockResolvedValue('submitted');
      await clearAbandonedPledge('CMT-A');
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('is NOT sent when nothing was in flight', async () => {
      mockFind.mockResolvedValue(null);
      await clearAbandonedPledge('CMT-A');
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('is NOT sent when the clear itself failed', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCancel.mockRejectedValue(new Error('UNAVAILABLE'));
      await clearAbandonedPledge('CMT-A');
      expect(mockNotify).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    // The single suppression, used by /api/pledges/start: the family is
    // restarting payment in the same request.
    it('is suppressed by notify:false', async () => {
      await clearAbandonedPledge('CMT-A', { notify: false });
      expect(mockNotify).not.toHaveBeenCalled();
    });

    // Safe-direction default: the bug being fixed was an omission, so a caller
    // that passes nothing must SEND rather than stay silent.
    it('defaults to sending when a caller passes no options at all', async () => {
      await clearAbandonedPledge('CMT-A', {});
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    // The repair has already succeeded by the time the letter is attempted, and
    // this function's callers are server components rendering a whole page. So
    // the send is wrapped HERE rather than trusting notifyPledgeAbandoned to keep
    // owning its own try/catch forever.
    it('still reports cleared if the letter blows up', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockNotify.mockRejectedValue(new Error('SES down'));
      await expect(clearAbandonedPledge('CMT-A')).resolves.toBe('cleared');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

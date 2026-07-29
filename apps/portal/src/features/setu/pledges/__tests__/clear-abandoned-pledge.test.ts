import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSubmission, mockFind, mockCancel } = vi.hoisted(() => ({
  mockSubmission: vi.fn(),
  mockFind: vi.fn(),
  mockCancel: vi.fn(),
}));
vi.mock('../stripe-pad-client', () => ({ getCheckoutSessionSubmission: mockSubmission }));
vi.mock('../find-started-pledge', () => ({ findStartedPledge: mockFind }));
vi.mock('../cancel-pledge', () => ({ cancelPledgeRecord: mockCancel }));

import { clearAbandonedPledge } from '../clear-abandoned-pledge';

beforeEach(() => {
  mockFind.mockReset();
  mockFind.mockResolvedValue({ pid: 'PLG-1', setupSessionId: 'cs_test_1' });
  mockSubmission.mockReset();
  mockSubmission.mockResolvedValue('not-submitted');
  mockCancel.mockReset();
  mockCancel.mockResolvedValue({ ok: true });
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

  it('records the SYSTEM as the actor, not a human who decided nothing', async () => {
    await clearAbandonedPledge('CMT-A');
    expect(mockCancel).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ uid: 'system:abandoned-pad-session' }) }),
    );
  });
});

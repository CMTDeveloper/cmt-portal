import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../hash-contact-key', () => ({
  hashContactKey: (type: string, value: string) => `hash:${type}:${value.trim().toLowerCase()}`,
}));

const docs = new Map<string, { contactHash: string; expiresAt: Date }>();
const setSpy = vi.fn();
const deleteSpy = vi.fn();

function ref(token: string) {
  return {
    _token: token,
    set: (data: { contactHash: string; expiresAt: Date }) => {
      setSpy(token, data);
      docs.set(token, data);
      return Promise.resolve();
    },
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
  portalFirestore: () => ({
    collection: (c: string) => {
      if (c !== 'registrationGrants') throw new Error(`unexpected collection ${c}`);
      return { doc: (token: string) => ref(token) };
    },
    runTransaction: async (fn: (txn: unknown) => unknown) => {
      const txn = {
        get: async (r: { _token: string }) => {
          const d = docs.get(r._token);
          return d ? { exists: true, data: () => d } : { exists: false };
        },
        delete: (r: { _token: string }) => {
          deleteSpy(r._token);
          docs.delete(r._token);
        },
      };
      return fn(txn);
    },
  }),
}));

import { issueRegistrationGrant, consumeRegistrationGrant } from '../registration-grant';

beforeEach(() => {
  docs.clear();
  setSpy.mockClear();
  deleteSpy.mockClear();
});

describe('registration-grant', () => {
  it('issues a token bound to the email contact hash with a future expiry', async () => {
    const token = await issueRegistrationGrant('Raj@Example.com');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
    const stored = setSpy.mock.calls[0]![1] as { contactHash: string; expiresAt: Date };
    expect(stored.contactHash).toBe('hash:email:raj@example.com');
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('consumes a valid, matching grant exactly once (true, then false)', async () => {
    const token = await issueRegistrationGrant('raj@example.com');
    expect(await consumeRegistrationGrant(token, 'raj@example.com')).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(token);
    // replay → gone
    expect(await consumeRegistrationGrant(token, 'raj@example.com')).toBe(false);
  });

  it('rejects a contact mismatch WITHOUT consuming (not this caller’s token)', async () => {
    const token = await issueRegistrationGrant('raj@example.com');
    expect(await consumeRegistrationGrant(token, 'attacker@example.com')).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
    // the rightful owner can still use it
    expect(await consumeRegistrationGrant(token, 'raj@example.com')).toBe(true);
  });

  it('rejects + deletes an expired grant', async () => {
    const token = 'expired-tok';
    docs.set(token, { contactHash: 'hash:email:raj@example.com', expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeRegistrationGrant(token, 'raj@example.com')).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith(token);
  });

  it('returns false for an unknown token', async () => {
    expect(await consumeRegistrationGrant('nope', 'raj@example.com')).toBe(false);
  });
});

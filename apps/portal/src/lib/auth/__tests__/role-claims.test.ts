import { describe, it, expect } from 'vitest';
import { addCapability, removeCapability, hasCapability } from '../role-claims';

describe('hasCapability', () => {
  it('returns false on null/empty claims', () => {
    expect(hasCapability(null, 'admin')).toBe(false);
    expect(hasCapability({}, 'admin')).toBe(false);
  });
  it('returns true when primary role matches', () => {
    expect(hasCapability({ role: 'admin' }, 'admin')).toBe(true);
    expect(hasCapability({ role: 'welcome-team' }, 'welcome-team')).toBe(true);
  });
  it('returns true when cap is in extraRoles', () => {
    expect(hasCapability({ role: 'family-manager', extraRoles: ['admin'] }, 'admin')).toBe(true);
    expect(hasCapability({ role: 'family-manager', extraRoles: ['welcome-team'] }, 'welcome-team')).toBe(true);
  });
  it('returns false when neither primary nor extras has cap', () => {
    expect(hasCapability({ role: 'family-manager' }, 'admin')).toBe(false);
    expect(hasCapability({ role: 'family-manager', extraRoles: ['welcome-team'] }, 'admin')).toBe(false);
  });
});

describe('addCapability', () => {
  it('promotes cap to primary when no existing role', () => {
    const out = addCapability(null, 'admin', 'a@b.c');
    expect(out.role).toBe('admin');
    expect(out.extraRoles).toBeUndefined();
    expect(out.email).toBe('a@b.c');
  });

  it('preserves family-manager as primary and adds cap to extras', () => {
    const out = addCapability(
      { role: 'family-manager', fid: 'F1', mid: 'F1-01' },
      'admin',
      'a@b.c',
    );
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles).toEqual(['admin']);
    expect(out.fid).toBe('F1');
    expect(out.mid).toBe('F1-01');
  });

  it('preserves family-member as primary and adds cap to extras', () => {
    const out = addCapability({ role: 'family-member' }, 'welcome-team', 'a@b.c');
    expect(out.role).toBe('family-member');
    expect(out.extraRoles).toEqual(['welcome-team']);
  });

  it('idempotent — granting an already-granted cap is a no-op', () => {
    const before = { role: 'family-manager', extraRoles: ['admin'], email: 'a@b.c' };
    const out = addCapability(before, 'admin', 'a@b.c');
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles).toEqual(['admin']);
  });

  it('idempotent when cap is primary', () => {
    const out = addCapability({ role: 'admin' }, 'admin', 'a@b.c');
    expect(out.role).toBe('admin');
    expect(out.extraRoles).toBeUndefined();
  });

  it('promotes admin over welcome-team primary (admin is higher tier)', () => {
    const out = addCapability({ role: 'welcome-team' }, 'admin', 'a@b.c');
    expect(out.role).toBe('admin');
    expect(out.extraRoles).toEqual(['welcome-team']);
  });

  it('admin primary + welcome-team grant → welcome-team goes to extras', () => {
    const out = addCapability({ role: 'admin' }, 'welcome-team', 'a@b.c');
    expect(out.role).toBe('admin');
    expect(out.extraRoles).toEqual(['welcome-team']);
  });

  it('preserves existing extras when adding a new cap', () => {
    const out = addCapability(
      { role: 'family-manager', extraRoles: ['welcome-team'] },
      'admin',
      'a@b.c',
    );
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles?.sort()).toEqual(['admin', 'welcome-team'].sort());
  });

  it('does not include extraRoles field when empty', () => {
    const out = addCapability(null, 'admin', 'a@b.c');
    expect('extraRoles' in out).toBe(false);
  });

  it('preserves family fid/mid through grant', () => {
    const out = addCapability(
      { role: 'family-manager', fid: 'F1', mid: 'F1-01', email: 'm@e.c' },
      'admin',
      'm@e.c',
    );
    expect(out.fid).toBe('F1');
    expect(out.mid).toBe('F1-01');
  });
});

describe('removeCapability', () => {
  it('removes cap from extras while preserving primary', () => {
    const out = removeCapability(
      { role: 'family-manager', extraRoles: ['admin'] },
      'admin',
    );
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles).toBeUndefined();
  });

  it('keeps unrelated extras intact', () => {
    const out = removeCapability(
      { role: 'family-manager', extraRoles: ['admin', 'welcome-team'] },
      'admin',
    );
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles).toEqual(['welcome-team']);
  });

  it('promotes first extra to primary when removing the primary cap', () => {
    const out = removeCapability(
      { role: 'admin', extraRoles: ['welcome-team'] },
      'admin',
    );
    expect(out.role).toBe('welcome-team');
    expect(out.extraRoles).toBeUndefined();
  });

  it('drops role entirely when no fallback exists', () => {
    const out = removeCapability({ role: 'admin', email: 'a@b.c' }, 'admin');
    expect('role' in out).toBe(false);
    expect('extraRoles' in out).toBe(false);
    expect(out.email).toBe('a@b.c');
  });

  it('no-op when cap is not present', () => {
    const out = removeCapability(
      { role: 'family-manager', extraRoles: ['welcome-team'] },
      'admin',
    );
    expect(out.role).toBe('family-manager');
    expect(out.extraRoles).toEqual(['welcome-team']);
  });

  it('safe on null', () => {
    expect(removeCapability(null, 'admin')).toEqual({});
  });
});

describe('grant/revoke round-trip', () => {
  it('grant then revoke returns to family-manager-only state', () => {
    const start = { role: 'family-manager', fid: 'F1', mid: 'F1-01', email: 'a@b.c' };
    const afterGrant = addCapability(start, 'admin', 'a@b.c');
    const afterRevoke = removeCapability(afterGrant, 'admin');
    expect(afterRevoke).toEqual({ role: 'family-manager', fid: 'F1', mid: 'F1-01', email: 'a@b.c' });
  });

  it('grant admin then welcome-team, revoke admin → welcome-team remains as extra', () => {
    let claims = { role: 'family-manager', fid: 'F1' };
    claims = addCapability(claims, 'admin', undefined) as typeof claims;
    claims = addCapability(claims, 'welcome-team', undefined) as typeof claims;
    const after = removeCapability(claims, 'admin');
    expect(after.role).toBe('family-manager');
    expect(after.extraRoles).toEqual(['welcome-team']);
  });
});

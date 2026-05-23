import { describe, it, expect } from 'vitest';
import {
  SetuSessionClaimsSchema,
  type SetuSessionClaims,
} from '../session-claims';

describe('SetuSessionClaimsSchema — family-manager', () => {
  it('parses valid family-manager with fid and mid', () => {
    const input = { uid: 'u1', role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const claims = result.data as Extract<SetuSessionClaims, { role: 'family-manager' }>;
      expect(claims.role).toBe('family-manager');
      expect(claims.fid).toBe('FAM001');
      expect(claims.mid).toBe('FAM001-01');
    }
  });

  it('rejects family-manager missing fid', () => {
    const input = { uid: 'u1', role: 'family-manager', mid: 'FAM001-01' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects family-manager missing mid', () => {
    const input = { uid: 'u1', role: 'family-manager', fid: 'FAM001' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('SetuSessionClaimsSchema — family-member', () => {
  it('parses valid family-member with fid and mid', () => {
    const input = { uid: 'u2', role: 'family-member', fid: 'FAM001', mid: 'FAM001-02' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('family-member');
    }
  });

  it('rejects family-member missing fid', () => {
    const input = { uid: 'u2', role: 'family-member', mid: 'FAM001-02' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('SetuSessionClaimsSchema — welcome-team', () => {
  it('parses valid welcome-team without fid or mid', () => {
    const input = { uid: 'u3', role: 'welcome-team' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('welcome-team');
    }
  });

  it('parses welcome-team even when fid is provided (optional)', () => {
    const input = { uid: 'u3', role: 'welcome-team', fid: 'FAM001' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('SetuSessionClaimsSchema — legacy roles', () => {
  it('parses legacy family role with familyId', () => {
    const input = { uid: 'u4', role: 'family', familyId: '42' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('parses legacy teacher role', () => {
    const input = { uid: 'u5', role: 'teacher' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('parses legacy admin role', () => {
    const input = { uid: 'u6', role: 'admin' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects unknown role', () => {
    const input = { uid: 'u7', role: 'superuser' };
    const result = SetuSessionClaimsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  SetuSessionClaimsSchema,
  type SetuSessionClaims,
} from '../session-claims';
import { ROLES, type Role } from '../../auth/role';

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

// ── The union must cover EVERY role, or a session silently fails to parse ────
//
// 🔴 Found on deployed UAT 2026-08-06, as a "Page not found" screenshot.
//
// `SetuSessionClaimsSchema` is a discriminated union over `role`, and it listed
// six of the eight members of ROLES. `coordinator` was added to ROLES and to
// `isWelcomeTeam()` but never got a variant here - so a STANDALONE coordinator's
// session failed `safeParse`, `getFamilyForWelcome` returned null before its
// `isWelcomeTeam` check was even reached, and `/welcome/family/[fid]` answered
// notFound() for every one of them.
//
// Why nothing caught it: the coordinator E2E asserts API routes, which are gated
// by middleware and never touch this schema; the unit tests here only ever
// parsed roles that were already in the union. The failure is invisible from
// both directions - a missing variant looks exactly like a malformed cookie.
//
// This test is the guard, not the fix. A role added to ROLES without a variant
// here now fails loudly at build time rather than as a 404 in production.
describe('SetuSessionClaimsSchema covers every role in ROLES', () => {
  /** The minimum a session of each role actually carries. */
  const MINIMAL: Record<Role, Record<string, unknown>> = {
    admin: { uid: 'u1', role: 'admin' },
    teacher: { uid: 'u1', role: 'teacher' },
    family: { uid: 'u1', role: 'family' },
    'family-manager': { uid: 'u1', role: 'family-manager', fid: 'F1', mid: 'M1' },
    'family-member': { uid: 'u1', role: 'family-member', fid: 'F1', mid: 'M1' },
    'welcome-team': { uid: 'u1', role: 'welcome-team' },
    kiosk: { uid: 'u1', role: 'kiosk' },
    coordinator: { uid: 'u1', role: 'coordinator' },
  };

  it.each(ROLES)('parses a minimal %s session', (role) => {
    const result = SetuSessionClaimsSchema.safeParse(MINIMAL[role]);
    expect(
      result.success,
      `role '${role}' is in ROLES but has no variant in SetuSessionClaimsSchema - ` +
        'every screen that parses claims will treat this session as invalid',
    ).toBe(true);
  });

  it('lets a coordinator who is ALSO a parent keep both, and parse', async () => {
    // The mid-keyed shape: primary role is the family one, the grant rides in
    // extraRoles. This variant always parsed; the standalone one did not, which
    // is why the bug reached production looking like it only affected "some"
    // coordinators.
    const result = SetuSessionClaimsSchema.safeParse({
      uid: 'u1',
      role: 'family-manager',
      fid: 'F1',
      mid: 'M1',
      extraRoles: ['coordinator'],
    });
    expect(result.success).toBe(true);
  });

  it('a standalone sevak session needs no family, for every staff role', () => {
    // fid/mid must stay OPTIONAL on the staff variants. A standalone
    // coordinator or welcome-team volunteer has no family record at all, and
    // requiring one here would reproduce the same 404 by a different route.
    for (const role of ['welcome-team', 'coordinator', 'kiosk'] as const) {
      expect(SetuSessionClaimsSchema.safeParse({ uid: 'u1', role }).success, role).toBe(true);
    }
  });
});

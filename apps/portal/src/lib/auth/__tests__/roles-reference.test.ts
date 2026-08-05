import { describe, it, expect } from 'vitest';
import { ROLES, canAccessRoute, type SessionClaims, type Role } from '@cmt/shared-domain';
import { ROLE_REFERENCE, ROLE_REFERENCE_ORDER } from '../roles-reference';

describe('ROLE_REFERENCE', () => {
  it('covers every role in ROLES', () => {
    for (const role of ROLES) {
      expect(ROLE_REFERENCE[role]).toBeDefined();
    }
    // No stray keys beyond ROLES.
    expect(Object.keys(ROLE_REFERENCE).sort()).toEqual([...ROLES].sort());
  });

  it('every entry has a non-empty label, summary, and at least one grant', () => {
    for (const role of ROLES) {
      const ref = ROLE_REFERENCE[role];
      expect(ref.label.length).toBeGreaterThan(0);
      expect(ref.summary.length).toBeGreaterThan(0);
      expect(ref.grants.length).toBeGreaterThan(0);
      for (const g of ref.grants) {
        expect(g.length).toBeGreaterThan(0);
      }
    }
  });

  it('ROLE_REFERENCE_ORDER lists each role exactly once', () => {
    expect([...ROLE_REFERENCE_ORDER].sort()).toEqual([...ROLES].sort());
    expect(new Set(ROLE_REFERENCE_ORDER).size).toBe(ROLE_REFERENCE_ORDER.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOES THE PANEL TELL THE TRUTH?
//
// The three tests above are structural - they check the shape of this object,
// never its claims. That is how the panel came to tell admins, on 2026-08-05,
// that a welcome-team volunteer could assign teachers, publish the class
// calendar and manage seva (all admin-only since 2026-08-03) and that the role
// "cannot modify family records" (false since the staff PATCH route shipped).
// All four were verified false against canAccessRoute before this was written.
//
// It mattered: the product owner read this screen and asked for permission
// changes on the strength of it.
//
// WHAT THIS PINS, precisely - so nobody trusts it further than it goes. It
// pins that each bullet AGREES WITH A ROUTE, not that its English is
// well-chosen. A bullet reading "Can do absolutely anything" would pass with a
// probe that happens to hold. The `prose` bullets are not verified at all -
// they are only forced to be declared, so nobody can quietly add an
// unverifiable claim without writing the word `prose` next to it.
//
// The exhaustiveness assertion is the load-bearing half. Without it a new
// bullet just goes unprobed and this file keeps passing, which is exactly the
// hole the old version had.
// ─────────────────────────────────────────────────────────────────────────────

type Probe = [claims: SessionClaims, path: string, method: string, expected: boolean];
type BulletCheck = { probes: Probe[] } | { prose: string };

const claimsFor = (role: Role): SessionClaims => ({ uid: `u-${role}`, role });

const ADMIN = claimsFor('admin');
const WELCOME = claimsFor('welcome-team');
const COORD = claimsFor('coordinator');
const TEACHER = claimsFor('teacher');
const MANAGER = claimsFor('family-manager');
const MEMBER = claimsFor('family-member');
const LEGACY = claimsFor('family');
const KIOSK = claimsFor('kiosk');

/**
 * Keyed by the EXACT bullet string. The exhaustiveness test below fails if this
 * map and the reference's bullets ever disagree, so editing a bullet forces you
 * back here to say what it now means.
 */
const BULLET_CHECKS: Record<string, BulletCheck> = {
  // ── admin ────────────────────────────────────────────────────────────────
  'All /admin/* pages and /api/admin/* APIs (users & roles, levels, programs, calendar, school-year, seva, donation periods, volunteering skills)':
    { probes: [[ADMIN, '/admin/users', 'GET', true], [ADMIN, '/api/admin/users', 'GET', true]] },
  'Grant and revoke admin, welcome-team & coordinator roles for any sevak':
    { probes: [[ADMIN, '/api/admin/users', 'POST', true], [WELCOME, '/api/admin/users', 'POST', false], [COORD, '/api/admin/users', 'POST', false]] },
  'Assign teachers to class levels':
    { probes: [[ADMIN, '/api/admin/teacher-assignments', 'POST', true]] },
  'Change what a family owes (the enrollment payment override) - admin only':
    { probes: [[ADMIN, '/api/welcome/enrollments/e1/override', 'POST', true], [WELCOME, '/api/welcome/enrollments/e1/override', 'POST', false], [COORD, '/api/welcome/enrollments/e1/override', 'POST', false]] },
  'Everything a welcome-team volunteer can do (family search, roster)':
    { probes: [[ADMIN, '/api/setu/family/search', 'GET', true], [ADMIN, '/welcome/roster', 'GET', true]] },
  'Everything a teacher can do (attendance for any level)':
    { probes: [[ADMIN, '/teacher', 'GET', true], [ADMIN, '/api/setu/teacher/roster', 'GET', true]] },

  // ── welcome-team ─────────────────────────────────────────────────────────
  'Browse and filter the family roster at /welcome/roster':
    { probes: [[WELCOME, '/welcome/roster', 'GET', true], [WELCOME, '/api/welcome/roster/report', 'GET', true]] },
  'Search any family and open its family and member detail at /welcome':
    { probes: [[WELCOME, '/api/setu/family/search', 'GET', true], [WELCOME, '/welcome/family/CMT-AB12CD34', 'GET', true], [MANAGER, '/api/setu/family/search', 'GET', false]] },
  'Correct a family or member record on their behalf, including grade':
    { probes: [[WELCOME, '/api/welcome/families/CMT-AB12CD34', 'PATCH', true], [WELCOME, '/api/welcome/families/CMT-AB12CD34/members/CMT-AB12CD34-02', 'PATCH', true]] },
  'Run the Sunday visitors board at /welcome/visitors':
    { probes: [[WELCOME, '/welcome/visitors', 'GET', true], [MANAGER, '/welcome/visitors', 'GET', false]] },
  'Read the staff guides at /docs':
    { probes: [[WELCOME, '/docs', 'GET', true], [MANAGER, '/docs', 'GET', false]] },
  // DELETE is deliberately absent from the probes: middleware ALLOWS
  // welcome-team through to that path and the route handler refuses with
  // isAdmin. canAccessRoute cannot express it, so probing it here would assert
  // the opposite of the truth. The handler's own test carries that one.
  'Cannot delete a member, change what a family owes, or grant roles':
    { probes: [[WELCOME, '/api/welcome/enrollments/e1/override', 'POST', false], [WELCOME, '/api/admin/users', 'GET', false]] },
  'Cannot reach levels, seva, prasad, reports, or the class calendar':
    { probes: [[WELCOME, '/welcome/levels', 'GET', false], [WELCOME, '/welcome/seva', 'GET', false], [WELCOME, '/welcome/prasad', 'GET', false], [WELCOME, '/welcome/reports', 'GET', false], [WELCOME, '/api/admin/calendar', 'POST', false]] },

  // ── coordinator ──────────────────────────────────────────────────────────
  'Everything a welcome-team volunteer can do (roster, family search, family and member edits, visitors)':
    { probes: [[COORD, '/welcome/roster', 'GET', true], [COORD, '/api/setu/family/search', 'GET', true], [COORD, '/api/welcome/families/CMT-AB12CD34/members/CMT-AB12CD34-02', 'PATCH', true], [COORD, '/welcome/visitors', 'GET', true]] },
  'Create and edit programs at /admin/programs':
    { probes: [[COORD, '/admin/programs', 'GET', true], [COORD, '/api/admin/programs', 'POST', true]] },
  'Create and edit class levels at /admin/levels':
    { probes: [[COORD, '/admin/levels', 'GET', true], [COORD, '/api/admin/levels', 'POST', true]] },
  'Set program pricing through offerings':
    { probes: [[COORD, '/api/admin/offerings', 'POST', true]] },
  'Assign teachers to class levels (shared with admin)':
    { probes: [[COORD, '/api/admin/teacher-assignments', 'POST', true], [WELCOME, '/api/admin/teacher-assignments', 'POST', false]] },
  'Cannot grant roles, read reports, or change what a family owes':
    { probes: [[COORD, '/api/admin/users', 'GET', false], [COORD, '/welcome/reports', 'GET', false], [COORD, '/api/welcome/enrollments/e1/override', 'POST', false]] },

  // ── teacher ──────────────────────────────────────────────────────────────
  'Access the /teacher portal and /api/setu/teacher/* APIs':
    { probes: [[TEACHER, '/teacher', 'GET', true], [TEACHER, '/api/setu/teacher/roster', 'GET', true], [MANAGER, '/teacher', 'GET', false]] },
  'Mark attendance only for their assigned levels':
    { prose: 'Per-level scoping is enforced in the handler against the teacher assignment, not by path.' },
  'Managed via /admin/levels (teacher assignment), not granted here':
    { prose: 'Describes where the grant is administered, not a route this role may reach.' },

  // ── family-manager ───────────────────────────────────────────────────────
  'View and edit their own family at /family':
    { probes: [[MANAGER, '/family', 'GET', true], [MANAGER, '/api/setu/family', 'PATCH', true], [MEMBER, '/api/setu/family', 'PATCH', false]] },
  'Add, edit, and remove members; manage enrollments and donations':
    { probes: [[MANAGER, '/api/setu/members', 'POST', true], [MANAGER, '/api/setu/enrollments', 'POST', true], [MANAGER, '/api/setu/donations', 'POST', true], [MEMBER, '/api/setu/members', 'POST', false]] },
  'Send family invites; manage their own contacts and seva sign-ups':
    { probes: [[MANAGER, '/api/setu/invite/send', 'POST', true], [MANAGER, '/api/setu/contacts', 'POST', true], [MEMBER, '/api/setu/invite/send', 'POST', false]] },
  'Derived from family membership — not granted through this screen':
    { prose: 'Explains how the role is acquired; no route corresponds to it.' },

  // ── family-member ────────────────────────────────────────────────────────
  'View their own family at /family':
    { probes: [[MEMBER, '/family', 'GET', true], [MEMBER, '/api/setu/family', 'GET', true]] },
  'Edit their own member profile and contacts':
    { probes: [[MEMBER, '/api/setu/contacts', 'POST', true]] },
  'View enrollments, donations, and the class calendar':
    { probes: [[MEMBER, '/api/setu/enrollments', 'GET', true], [MEMBER, '/api/setu/donations', 'GET', true], [MEMBER, '/api/setu/calendar', 'GET', true]] },
  'Cannot add/remove members or initiate payments (manager-only)':
    { probes: [[MEMBER, '/api/setu/members', 'POST', false], [MEMBER, '/api/setu/members/CMT-X-02', 'DELETE', false], [MEMBER, '/api/setu/donations', 'POST', false]] },

  // ── family (legacy) ──────────────────────────────────────────────────────
  'Access the legacy /check-in/family kiosk dashboard':
    { probes: [[LEGACY, '/check-in/family', 'GET', true], [MANAGER, '/check-in/family', 'GET', false]] },
  'Not used by the Setu family portal (/family) — superseded by family-manager/family-member':
    { probes: [[LEGACY, '/family', 'GET', false]] },

  // ── kiosk ────────────────────────────────────────────────────────────────
  'Check families in at the door via the kiosk check-in API':
    { probes: [[KIOSK, '/api/check-in/setu/check-in', 'POST', true], [KIOSK, '/check-in', 'GET', true]] },
  'Seeded on a single shared tablet account - not granted through this screen':
    { prose: 'Describes provisioning, not authorization.' },
  'Cannot read or edit family records, roster, reports, or admin tools':
    { probes: [[KIOSK, '/welcome/roster', 'GET', false], [KIOSK, '/api/setu/family/search', 'GET', false], [KIOSK, '/welcome/reports', 'GET', false], [KIOSK, '/admin', 'GET', false]] },
};

describe('ROLE_REFERENCE tells the truth about canAccessRoute', () => {
  const allBullets = ROLE_REFERENCE_ORDER.flatMap((r) => ROLE_REFERENCE[r].grants);

  it('every bullet in the panel is classified as a probe or as prose', () => {
    const unclassified = allBullets.filter((b) => !(b in BULLET_CHECKS));
    expect(
      unclassified,
      'These bullets are shown to admins but nothing checks them. Add a probe, ' +
        'or mark them { prose } with the reason they cannot be probed.',
    ).toEqual([]);
  });

  it('no check is left behind pointing at a bullet that no longer exists', () => {
    const shown = new Set(allBullets);
    const orphans = Object.keys(BULLET_CHECKS).filter((k) => !shown.has(k));
    expect(
      orphans,
      'These checks name bullets the panel no longer shows - the copy changed ' +
        'and the check was not moved with it, so it is now verifying nothing.',
    ).toEqual([]);
  });

  // One `it` per bullet so a failure names the sentence an admin actually reads.
  for (const [bullet, check] of Object.entries(BULLET_CHECKS)) {
    if ('prose' in check) continue;
    it(`"${bullet}"`, () => {
      for (const [claims, path, method, expected] of check.probes) {
        expect(
          canAccessRoute(claims, path, method),
          `${claims.role} ${method} ${path} should be ${expected ? 'ALLOWED' : 'DENIED'}`,
        ).toBe(expected);
      }
    });
  }
});

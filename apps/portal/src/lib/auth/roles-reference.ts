import { ROLES, type Role } from '@cmt/shared-domain';

/**
 * Human-readable reference of what each role grants, authored from the
 * authorization logic in `canAccessRoute` (packages/shared-domain). Pure data
 * — shared by the Users & Roles screen's "What can they access?" per-row
 * expander and the standalone roles-reference panel. No server imports so a
 * 'use client' component can read it directly.
 *
 * KEEPING IT HONEST. "Keep this in sync with canAccessRoute" used to be the
 * whole mechanism, and a comment is not a mechanism: by 2026-08-05 this file
 * told admins that welcome-team could assign teachers, publish the class
 * calendar and manage seva - all three admin-only since 2026-08-03 - and that
 * the role "cannot modify family records", which the staff PATCH route had
 * already made false. The product owner read this panel and asked for
 * permission changes based on it, so the drift cost real conversations.
 *
 * Every bullet below is now pinned in __tests__/roles-reference.test.ts, either
 * to a real canAccessRoute assertion or to an explicit `prose` marker for the
 * ones that describe no single route. Adding a bullet without classifying it
 * fails the suite; changing a rule without updating the bullet fails it too.
 */
export interface RoleReference {
  /** Display label for the role chip / panel heading. */
  label: string;
  /** Short one-line summary of the role's purpose. */
  summary: string;
  /** Bulleted list of concrete capabilities the role grants. */
  grants: string[];
}

export const ROLE_REFERENCE: Record<Role, RoleReference> = {
  coordinator: {
    label: 'Coordinator',
    summary:
      'Everything the welcome team can do, plus Bala Vihar programs, class levels and pricing. No access to users & roles, reports, seva, prasad, or the payment override.',
    grants: [
      'Everything a welcome-team volunteer can do (roster, family search, family and member edits, visitors)',
      'Create and edit programs at /admin/programs',
      'Create and edit class levels at /admin/levels',
      'Set program pricing through offerings',
      'Assign teachers to class levels (shared with admin)',
      'Cannot grant roles, read reports, or change what a family owes',
    ],
  },
  admin: {
    label: 'Admin',
    summary: 'Full access to every admin tool. Inherits welcome-team and teacher capabilities.',
    grants: [
      'All /admin/* pages and /api/admin/* APIs (users & roles, levels, programs, calendar, school-year, seva, donation periods, volunteering skills)',
      'Grant and revoke admin, welcome-team & coordinator roles for any sevak',
      'Assign teachers to class levels',
      'Change what a family owes (the enrollment payment override) - admin only',
      'Everything a welcome-team volunteer can do (family search, roster)',
      'Everything a teacher can do (attendance for any level)',
    ],
  },
  'welcome-team': {
    label: 'Welcome team',
    summary: 'Front desk. The family roster and the Sunday visitors board, and nothing else.',
    grants: [
      'Browse and filter the family roster at /welcome/roster',
      'Search any family and open its family and member detail at /welcome',
      'Correct a family or member record on their behalf, including grade',
      'Run the Sunday visitors board at /welcome/visitors',
      'Read the staff guides at /docs',
      'Cannot delete a member, change what a family owes, or grant roles',
      'Cannot reach levels, seva, prasad, reports, or the class calendar',
    ],
  },
  teacher: {
    label: 'Teacher',
    summary: 'Takes attendance for the class levels they are assigned to.',
    grants: [
      'Access the /teacher portal and /api/setu/teacher/* APIs',
      'Mark attendance only for their assigned levels',
      'Managed via /admin/levels (teacher assignment), not granted here',
    ],
  },
  'family-manager': {
    label: 'Family manager',
    summary: 'Primary parent for a family. Manages their own family and members.',
    grants: [
      'View and edit their own family at /family',
      'Add, edit, and remove members; manage enrollments and donations',
      'Send family invites; manage their own contacts and seva sign-ups',
      'Derived from family membership — not granted through this screen',
    ],
  },
  'family-member': {
    label: 'Family member',
    summary: 'A non-manager member of a family. Read access plus self-edit.',
    grants: [
      'View their own family at /family',
      'Edit their own member profile and contacts',
      'View enrollments, donations, and the class calendar',
      'Cannot add/remove members or initiate payments (manager-only)',
    ],
  },
  family: {
    label: 'Family (legacy)',
    summary: 'Legacy check-in family role from the standalone kiosk app.',
    grants: [
      'Access the legacy /check-in/family kiosk dashboard',
      'Not used by the Setu family portal (/family) — superseded by family-manager/family-member',
    ],
  },
  kiosk: {
    label: 'Kiosk',
    summary: 'Dedicated least-privilege account for the shared door tablet. Checks families in only.',
    grants: [
      'Check families in at the door via the kiosk check-in API',
      'Seeded on a single shared tablet account - not granted through this screen',
      'Cannot read or edit family records, roster, reports, or admin tools',
    ],
  },
};

/** The roles, in a sensible display order, that this reference covers. */
export const ROLE_REFERENCE_ORDER: Role[] = [
  'admin',
  'welcome-team',
  'coordinator',
  'teacher',
  'family-manager',
  'family-member',
  'family',
  'kiosk',
];

// Compile-time guarantee that ROLE_REFERENCE covers every Role. If a new role
// is added to ROLES without a reference entry, this errors.
const _exhaustive: Record<Role, RoleReference> = ROLE_REFERENCE;
void _exhaustive;
void ROLES;

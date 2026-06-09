import { ROLES, type Role } from '@cmt/shared-domain';

/**
 * Human-readable reference of what each role grants, authored from the
 * authorization logic in `canAccessRoute` (packages/shared-domain). Pure data
 * — shared by the Users & Roles screen's "What can they access?" per-row
 * expander and the standalone roles-reference panel. No server imports so a
 * 'use client' component can read it directly.
 *
 * Keep this in sync with canAccessRoute when route gating changes.
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
  admin: {
    label: 'Admin',
    summary: 'Full access to every admin tool. Inherits welcome-team and teacher capabilities.',
    grants: [
      'All /admin/* pages and /api/admin/* APIs (users & roles, levels, programs, calendar, school-year, seva, donation periods, volunteering skills)',
      'Grant and revoke admin & welcome-team roles for any staff person',
      'Assign teachers to class levels',
      'Everything a welcome-team volunteer can do (family search, roster)',
      'Everything a teacher can do (attendance for any level)',
    ],
  },
  'welcome-team': {
    label: 'Welcome team',
    summary: 'Front-desk volunteer. Read-only family search plus teacher/seva/calendar helpers.',
    grants: [
      'Search any family and view read-only family/member detail at /welcome',
      'Assign teachers to levels (shared with admin)',
      'Publish the class calendar (shared with admin)',
      'Manage seva opportunities and welcome-team enrollments',
      'Cannot modify family records or grant roles',
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
};

/** The roles, in a sensible display order, that this reference covers. */
export const ROLE_REFERENCE_ORDER: Role[] = [
  'admin',
  'welcome-team',
  'teacher',
  'family-manager',
  'family-member',
  'family',
];

// Compile-time guarantee that ROLE_REFERENCE covers every Role. If a new role
// is added to ROLES without a reference entry, this errors.
const _exhaustive: Record<Role, RoleReference> = ROLE_REFERENCE;
void _exhaustive;
void ROLES;

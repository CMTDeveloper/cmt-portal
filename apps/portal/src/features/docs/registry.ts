import {
  isAdmin,
  isTeacher,
  isWelcomeTeam,
  type SessionClaims,
} from '@cmt/shared-domain';

// The staff documentation hub (/docs) renders the repo's admin-facing module
// guides (docs/runbooks/*.md) as HTML. This registry is the single source of
// truth for which guides exist, where they live, and WHO may see each one.
//
// Deliberately NOT listed: production-cutover-checklist.md (dev/ops runbook,
// not a team guide). Add new guides here in the same commit that creates the
// markdown file — the registry unit test asserts every listed file exists.

export type DocAudience = 'admin' | 'welcome-team' | 'teacher';

export interface DocGuide {
  /** URL slug → /docs/{slug} */
  slug: string;
  /** Filename inside docs/runbooks/ */
  file: string;
  title: string;
  description: string;
  category: string;
  /** Roles that should see this guide. Admin always sees everything. */
  audience: DocAudience[];
}

// Category order drives the /docs index layout.
export const DOC_CATEGORIES = [
  'Running the portal',
  'Bala Vihar',
  'Programs & donations',
  'Community',
] as const;

export const DOC_GUIDES: DocGuide[] = [
  {
    slug: 'admin',
    file: 'admin-module-guide.md',
    title: 'Admin module — the control room',
    description:
      'The /admin dashboard map, Users & roles, class calendar, level management, volunteering skills, and the legacy tools.',
    category: 'Running the portal',
    audience: ['admin'],
  },
  {
    slug: 'test-accounts',
    file: 'test-accounts.md',
    title: 'Role-persona test accounts',
    description:
      'The seeded UAT accounts for every role (parents, teachers, sevak, admin) and how the team uses them for manual testing.',
    category: 'Running the portal',
    audience: ['admin'],
  },
  {
    slug: 'rollover',
    file: 'school-year-rollover-guide.md',
    title: 'School-year rollover',
    description:
      'The yearly promotion: advance grades, graduate Grade 12s, preview → fix → commit, and the after-commit checklist.',
    category: 'Bala Vihar',
    audience: ['admin'],
  },
  {
    slug: 'teacher',
    file: 'teacher-module-guide.md',
    title: 'Teacher module',
    description:
      'Onboarding a teacher, the Sunday attendance routine, visitors and walk-ins, and how marks reach families.',
    category: 'Bala Vihar',
    audience: ['admin', 'welcome-team', 'teacher'],
  },
  {
    slug: 'prasad',
    file: 'prasad-module-guide.md',
    title: 'Prasad module',
    description:
      'Propose → family confirms → assign stragglers: the one-prasad-Sunday-per-family rotation, reminders, and the day-of list.',
    category: 'Bala Vihar',
    audience: ['admin', 'welcome-team'],
  },
  {
    slug: 'programs',
    file: 'programs-module-guide.md',
    title: 'Programs module',
    description:
      'Programs → offerings → enrollments: setup, eligibility, the suggested-donation money model, and what families see.',
    category: 'Programs & donations',
    audience: ['admin', 'welcome-team'],
  },
  {
    slug: 'donations',
    file: 'donations-module-guide.md',
    title: 'Donations module',
    description:
      'The family donation checkout, what the statuses really mean, payment chips, the admin report, and amount overrides.',
    category: 'Programs & donations',
    audience: ['admin', 'welcome-team'],
  },
  {
    slug: 'seva',
    file: 'seva-module-guide.md',
    title: 'Seva module',
    description:
      'Post opportunities, families sign up, confirm hours after the event, and track the yearly goal with the compliance report.',
    category: 'Community',
    audience: ['admin', 'welcome-team'],
  },
];

export function findGuide(slug: string): DocGuide | undefined {
  return DOC_GUIDES.find((g) => g.slug === slug);
}

// Never check roles with strict equality — the helpers understand extraRoles
// and admin inheritance (admin sees every guide regardless of audience tags).
export function canViewGuide(claims: SessionClaims, guide: DocGuide): boolean {
  if (isAdmin(claims)) return true;
  if (isWelcomeTeam(claims) && guide.audience.includes('welcome-team')) return true;
  if (isTeacher(claims) && guide.audience.includes('teacher')) return true;
  return false;
}

export function visibleGuides(claims: SessionClaims): DocGuide[] {
  return DOC_GUIDES.filter((g) => canViewGuide(claims, g));
}

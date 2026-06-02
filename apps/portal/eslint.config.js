import config from '@cmt/config/eslint';

export default [
  ...config,
  {
    // Tripwire for the multi-program "first active enrollment" bug class. The
    // BV-bespoke dashboard + member surfaces must select the enrollment via
    // selectBalaViharEnrollment()/buildFamilyDashboardModel (pinned to
    // programKey), NEVER a raw `status === 'active'` find — a newer non-BV
    // enrollment sorts first (enrolledAt DESC) and hijacks the section, scoping
    // attendance to a window with no check-ins. See the memory note
    // feedback_bespoke_section_pin_to_programkey. Enrollment selection logic
    // lives in _helpers/ (excluded), so these page files should never compare
    // an enrollment status inline.
    // Globs are cwd-relative (lint runs `eslint src` from apps/portal), so match
    // with a leading ** rather than an apps/portal/ prefix.
    files: ['**/app/family/page.tsx', '**/app/family/members/**/page.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "BinaryExpression[operator='==='][left.property.name='status'][right.value='active']",
          message:
            "Don't select an enrollment by status alone in a BV-bespoke surface — a newer non-BV enrollment hijacks it. Use selectBalaViharEnrollment()/buildFamilyDashboardModel from _helpers/.",
        },
      ],
    },
  },
  {
    files: ['apps/portal/src/features/check-in/**/*.{ts,tsx}'],
    settings: {
      'boundaries/elements': [
        {
          type: 'check-in-auth',
          pattern: 'apps/portal/src/features/check-in/auth',
          mode: 'folder',
        },
        {
          type: 'check-in-kiosk',
          pattern: 'apps/portal/src/features/check-in/kiosk',
          mode: 'folder',
        },
        {
          type: 'check-in-family',
          pattern: 'apps/portal/src/features/check-in/family',
          mode: 'folder',
        },
        {
          type: 'check-in-teacher',
          pattern: 'apps/portal/src/features/check-in/teacher',
          mode: 'folder',
        },
        {
          type: 'check-in-admin',
          pattern: 'apps/portal/src/features/check-in/admin',
          mode: 'folder',
        },
        {
          type: 'check-in-notifications',
          pattern: 'apps/portal/src/features/check-in/notifications',
          mode: 'folder',
        },
        {
          type: 'check-in-shared',
          pattern: 'apps/portal/src/features/check-in/shared',
          mode: 'folder',
        },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: [
                'check-in-auth',
                'check-in-kiosk',
                'check-in-family',
                'check-in-teacher',
                'check-in-admin',
                'check-in-notifications',
              ],
              disallow: [
                'check-in-auth',
                'check-in-kiosk',
                'check-in-family',
                'check-in-teacher',
                'check-in-admin',
                'check-in-notifications',
              ],
              message:
                'Cross-sub-feature imports under features/check-in/** forbidden — go through features/check-in/shared/',
            },
          ],
        },
      ],
    },
  },
];

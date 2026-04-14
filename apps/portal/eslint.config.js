import config from '@cmt/config/eslint';

export default [
  ...config,
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

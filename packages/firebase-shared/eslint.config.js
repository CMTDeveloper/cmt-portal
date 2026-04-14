import config from '@cmt/config/eslint';

export default [
  ...config,
  {
    files: ['packages/firebase-shared/src/**/*.ts'],
    ignores: ['packages/firebase-shared/src/admin/rtdb.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase-admin/database',
              message:
                'Import from @cmt/firebase-shared/admin/rtdb instead. RTDB is read-only and access is gated.',
            },
          ],
        },
      ],
    },
  },
];

// IMPORTANT: All NEXT_PUBLIC_* references below MUST be literal
// `process.env.NEXT_PUBLIC_FOO` access — Next.js only inlines these into the
// client bundle when accessed by literal property name. Dynamic indexing like
// `process.env[name]` does NOT get inlined and evaluates to `undefined` in the
// browser, silently breaking client-side feature flags. The previous
// `readFlag(name)` helper hit exactly this bug for slice 2 client components.

const master = process.env.NEXT_PUBLIC_FEATURE_CHECK_IN === 'true';

export const flags = {
  checkIn: master,
  checkInKiosk: master && process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK === 'true',
  checkInFamily: master && process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY === 'true',
  checkInTeacher: master && process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER === 'true',
  checkInAdmin: master && process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN === 'true',
  checkInNotify: master && process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY === 'true',
  setuAuth: process.env.NEXT_PUBLIC_FEATURE_SETU_AUTH === 'true',
  setuDonations: process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS === 'true',
} as const;

export type FeatureFlags = typeof flags;

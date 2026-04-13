export const flags = {
  events: process.env.NEXT_PUBLIC_FEATURE_EVENTS === 'true',
  checkIn: process.env.NEXT_PUBLIC_FEATURE_CHECK_IN === 'true',
} as const;

export type FeatureFlags = typeof flags;

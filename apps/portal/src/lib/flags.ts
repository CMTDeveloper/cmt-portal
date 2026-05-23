function readFlag(name: string): boolean {
  return process.env[name] === 'true';
}

const master = readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN');

export const flags = {
  checkIn: master,
  checkInKiosk: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK'),
  checkInFamily: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY'),
  checkInTeacher: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER'),
  checkInAdmin: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN'),
  checkInNotify: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY'),
  setuAuth: readFlag('NEXT_PUBLIC_FEATURE_SETU_AUTH'),
} as const;

export type FeatureFlags = typeof flags;

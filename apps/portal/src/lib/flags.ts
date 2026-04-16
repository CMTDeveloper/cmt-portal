function readFlag(name: string): boolean {
  return process.env[name] === 'true';
}

const master = readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN');

export const flags = {
  events: readFlag('NEXT_PUBLIC_FEATURE_EVENTS'),
  eventsRegister: readFlag('NEXT_PUBLIC_FEATURE_EVENTS_REGISTER'),
  checkIn: master,
  checkInKiosk: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK'),
  checkInFamily: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_FAMILY'),
  checkInTeacher: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_TEACHER'),
  checkInAdmin: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN'),
  checkInNotify: master && readFlag('NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY'),
} as const;

export type FeatureFlags = typeof flags;

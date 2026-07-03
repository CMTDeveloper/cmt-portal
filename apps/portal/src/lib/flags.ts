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
  // Portal-native teacher attendance (Slice 4c). OFF by default — the standalone
  // check-in app owns attendance; the portal only READS family-check-ins. Kept
  // behind a flag so we can re-enable the portal teacher flow later.
  setuTeacher: process.env.NEXT_PUBLIC_FEATURE_SETU_TEACHER === 'true',
  // Slice 1 (2026-07-06): Seva + Prasad are hidden from FAMILIES entirely
  // (dashboard card, left-nav item, and the /family/seva|prasad routes) until the
  // owner decides to re-surface them. OFF by default. Admin/welcome Seva+Prasad
  // config is untouched — this only gates the family-facing surfaces.
  setuSeva: process.env.NEXT_PUBLIC_FEATURE_SETU_SEVA === 'true',
  setuPrasad: process.env.NEXT_PUBLIC_FEATURE_SETU_PRASAD === 'true',
  // Slice 2 (2026-07-03): family disclaimers accept-all gate. OFF by default —
  // ships dark; flip on at launch. Gates the /family DisclaimerGate, the
  // /disclaimers route, and the dashboard disclaimersPending field. The
  // /admin/disclaimers editor is admin-only and available regardless of this flag.
  setuDisclaimers: process.env.NEXT_PUBLIC_FEATURE_SETU_DISCLAIMERS === 'true',
} as const;

export type FeatureFlags = typeof flags;

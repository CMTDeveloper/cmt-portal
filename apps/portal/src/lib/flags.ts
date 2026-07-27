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
  // Adult Study Class selection (P4, 2026-07-26). OFF by default - ships dark.
  // Gates BOTH the /adult-class screen and the /family AdultClassGate that
  // redirects to it. It must gate the SCREEN too, not just the gate: a route
  // reachable in prod before the feature is announced lets a family enroll into
  // an offering nobody has told them about.
  setuAdultClass: process.env.NEXT_PUBLIC_FEATURE_SETU_ADULT_CLASS === 'true',
  // SMS sign-in (2026-07-25). OFF by default, and that is the honest state:
  // SNS is still in the sandbox with no Origination Number for Canada, so every
  // SMS the portal "sends" is accepted by AWS and delivered to nobody. Rather
  // than leave families staring at a code screen forever, every surface that
  // offers phone sign-in now refuses with a typed error while the flag is off.
  // Flipping it on restores SMS sign-in everywhere at once - which is why it is
  // ONE public flag read on both the client and the server, not a pair that can
  // drift.
  smsOtp: process.env.NEXT_PUBLIC_FEATURE_SMS_OTP === 'true',
  // Monthly pledge / pre-authorized debit (P5, 2026-07-27). OFF by default and
  // it MUST stay off at launch: the payment service's `/pad/*` endpoints are
  // TEST-mode only, so a family flipping through the flow in production would
  // authorise a mandate against a test Price. Gates the card, the /api/pledges/*
  // routes and the reconciler cron together - the flag is the whole feature's
  // on-switch, not just the UI's.
  //
  // Flipping this on is NOT a no-op: the first family through afterwards signs
  // the first REAL pre-authorized debit. See the plan's "Before the flag is ever
  // flipped ON" checklist - in particular, open the Stripe dashboard and confirm
  // the LIVE Price really is $51, because the amount lives at Stripe and nothing
  // in this codebase can detect a wrong one.
  setuPledge: process.env.NEXT_PUBLIC_FEATURE_SETU_PLEDGE === 'true',
} as const;

export type FeatureFlags = typeof flags;

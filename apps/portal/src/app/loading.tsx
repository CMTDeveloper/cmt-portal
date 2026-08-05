import { LoadingOm } from '@/components/chrome/loading-om';

/**
 * The app's LAST-RESORT loading state.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * There was no root `loading.tsx` until 2026-08-04, and 40 route segments had
 * no `loading.tsx` anywhere up their tree - including `/complete-profile`,
 * `/acknowledgements`, `/invite/[token]`, and `/donate/success`, which is where
 * a family lands coming back from Stripe.
 *
 * With `cacheComponents` on, a dynamic route's content is deferred to the
 * request-time render. With no loading boundary, Next has nothing to paint in
 * `<main>` for that whole wait - and the root layout's Header and Footer were
 * `<Suspense fallback={null}>`, so they painted nothing either. The sum of
 * three nothings is a completely blank page: no content, no chrome, and no
 * error fallback, because nothing has gone wrong. On a fast connection that
 * window is invisible. On a phone on poor wifi, against a cold serverless
 * function, it is seconds of white.
 *
 * Reported 2026-08-04 by families: *"it just goes blank and it's very slow"*,
 * *"I hit this error often and have to refresh"*.
 *
 * This does NOT make anything faster. It makes slow look like slow instead of
 * like broken, which is the difference between a family waiting two seconds and
 * a family concluding the portal is down and calling the office.
 *
 * A route with its own richer skeleton (`/family`, `/welcome/roster`, …) still
 * wins - Next uses the nearest boundary. This only catches what would otherwise
 * have had nothing at all.
 */
export default function RootLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <LoadingOm />
    </div>
  );
}

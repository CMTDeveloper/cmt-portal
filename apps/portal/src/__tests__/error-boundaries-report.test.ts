import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * EVERY error boundary must report to Sentry.
 *
 * ── Why this is a repo invariant and not a code review note ─────────────────
 * 🔴 On 2026-08-03 a family sent a screenshot of "Something went wrong" and
 * said *"I hit this error often and have to refresh"*. We had no record of it,
 * and not because of sampling: of the 45 error boundaries under `src/app`,
 * **44 reported nothing**. Only `global-error.tsx` called
 * `Sentry.captureException`, and that boundary fires only when the ROOT LAYOUT
 * throws. Every ordinary crash landed somewhere silent.
 *
 * A React error boundary SWALLOWS the error, so it never reaches
 * `window.onerror` and Sentry's global handlers cannot see it. Explicit capture
 * in the boundary is the only thing that works - which means every new
 * boundary has to remember, which means one eventually will not. Hence a test
 * that reads the files.
 *
 * The cost of the gap was not the missing rows. It was issue #62, open since
 * 2026-07-10 with no diagnosis, on a bug whose own code comment names catching
 * the client error as the next step.
 *
 * A new `error.tsx` may satisfy this EITHER by rendering `ReportingErrorFallback`
 * (the normal way) OR by calling `useReportBoundaryError` directly, which is
 * what a boundary with bespoke markup does.
 */
const APP_DIR = join(process.cwd(), 'src', 'app');

function findErrorBoundaries(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      findErrorBoundaries(full, out);
    } else if (entry === 'error.tsx') {
      out.push(full);
    }
  }
  return out;
}

const BOUNDARIES = findErrorBoundaries(APP_DIR);

describe('every route-segment error boundary reports to Sentry', () => {
  it('finds the boundaries at all (a broken glob would vacuously pass)', () => {
    // The real number was 45 when this was written. A floor, not an equality,
    // so adding a segment does not fail the suite - but a discovery bug that
    // returns [] cannot silently satisfy every assertion below.
    expect(BOUNDARIES.length).toBeGreaterThan(30);
  });

  it.each(BOUNDARIES.map((f) => [relative(APP_DIR, f), f] as const))(
    '%s reports',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      const reports =
        src.includes('ReportingErrorFallback') || src.includes('useReportBoundaryError');
      expect(
        reports,
        `${relative(APP_DIR, file)} renders an error screen but tells nobody. Use ` +
          `<ReportingErrorFallback> from @/components/chrome/reporting-error-fallback, ` +
          `or call useReportBoundaryError(error, '<feature>') if the boundary has its ` +
          `own markup. A boundary swallows the error, so without this Sentry never sees it.`,
      ).toBe(true);
    },
  );

  it('no boundary renders the bare ErrorFallback from @cmt/ui', () => {
    const offenders = BOUNDARIES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from\s+'@cmt\/ui'/.test(src) && src.includes('ErrorFallback');
    }).map((f) => relative(APP_DIR, f));

    expect(
      offenders,
      'these import ErrorFallback directly, which renders but does not report',
    ).toEqual([]);
  });
});

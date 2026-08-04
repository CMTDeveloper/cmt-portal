import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A slow page must never be indistinguishable from a broken one.
 *
 * 2026-08-04, from families on phones: *"it just goes blank and it's very
 * slow"*, *"I hit this error often and have to refresh"*. No error fallback,
 * because nothing had gone wrong - the page simply had nothing to paint.
 *
 * With `cacheComponents`, a dynamic route's content is deferred to the
 * request-time render. Three separate nothings added up:
 *   - 40 route segments had no `loading.tsx` anywhere up their tree, so `<main>`
 *     rendered empty for the whole wait;
 *   - the root layout's Header was `<Suspense fallback={null}>`;
 *   - so was the Footer.
 *
 * These tests read the FILES rather than rendering, deliberately: the failure is
 * structural (a boundary that does not exist cannot be rendered), and the same
 * approach is what `error-boundaries-report.test.ts` uses to keep 45 boundaries
 * honest.
 */
const APP = join(process.cwd(), 'src', 'app');

describe('the app always has something to paint', () => {
  it('has a ROOT loading.tsx - the last-resort boundary for every route', () => {
    // Without this, any dynamic segment lacking its own loading.tsx paints
    // nothing at all. That was 40 of them, including /complete-profile,
    // /acknowledgements, /invite/[token] and /donate/success (where a family
    // lands back from Stripe).
    expect(existsSync(join(APP, 'loading.tsx'))).toBe(true);
  });

  it('the root layout never suspends the chrome to NOTHING', () => {
    const src = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    // `fallback={null}` on the Header/Footer boundaries is what let the chrome
    // vanish during the dynamic phase - and, combined with a contentless
    // <main>, produced a completely blank document.
    expect(src).not.toMatch(/fallback=\{null\}/);
    // Both boundaries are still there; this is not "delete the Suspense".
    expect(src.match(/<Suspense/g) ?? []).toHaveLength(2);
  });
});

/**
 * Every route that a FAMILY can reach unauthenticated or mid-flow is the worst
 * place for a blank screen: they have no context to interpret it and no staff
 * beside them. Pinned by name because these are the ones that were reported.
 */
describe('the routes families land on have a loading boundary', () => {
  const nearestLoading = (segment: string): boolean => {
    let dir = join(APP, segment);
    for (;;) {
      if (existsSync(join(dir, 'loading.tsx'))) return true;
      if (dir === APP) return false;
      dir = join(dir, '..');
    }
  };

  for (const segment of ['complete-profile', 'acknowledgements', 'donate/success', 'sign-in', 'register', 'family']) {
    it(`/${segment} resolves to a loading boundary`, () => {
      expect(nearestLoading(segment)).toBe(true);
    });
  }
});

/**
 * The count is a canary, not a rule: it is fine for a segment to rely on the
 * root boundary. What is NOT fine is nobody noticing that the root boundary is
 * the only thing standing between a slow phone and a white screen.
 */
describe('route coverage is measured, not assumed', () => {
  it('reports how many page segments rely on the root loading boundary', () => {
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === 'page.tsx') pages.push(dir);
      }
    };
    walk(APP);

    const ownBoundary = pages.filter((dir) => {
      let d = dir;
      while (d !== APP) {
        if (existsSync(join(d, 'loading.tsx'))) return true;
        d = join(d, '..');
      }
      return false;
    });

    // Every page has SOMETHING, because the root boundary exists.
    expect(existsSync(join(APP, 'loading.tsx'))).toBe(true);
    // And a healthy number carry their own richer skeleton. If this floor ever
    // fails, someone deleted route-level loading states wholesale.
    expect(ownBoundary.length).toBeGreaterThanOrEqual(5);
  });
});

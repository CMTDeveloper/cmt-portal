import { ORG_NAME } from '@/lib/branding';

// Year is computed at build time so this component stays prerender-safe under
// Next.js 16 cacheComponents:true (which forbids new Date() in a Server
// Component before any dynamic API). Update the constant once a year.
const COPYRIGHT_YEAR = 2026;

/**
 * The footer's own box, split out so the root layout's Suspense FALLBACK can
 * reuse the exact same classes instead of guessing at them.
 *
 * It guessed wrong on 2026-08-04: the fallback was a bare `h-16` (64px, no
 * border, no background) against a real footer of ~85px with a top border and
 * `bg-muted`. That fixed the reflow at the top of the page and left one at the
 * bottom, plus a border and a background colour popping in at the swap. Sharing
 * the constants means the two cannot drift apart again - a test asserts the
 * fallback is built from these very strings.
 */
export const FOOTER_SHELL_CLASS = 'border-t border-border bg-muted';
export const FOOTER_INNER_CLASS = 'container mx-auto px-4 py-8 text-center text-sm';

export function Footer() {
  return (
    <footer className={FOOTER_SHELL_CLASS}>
      <div className={`${FOOTER_INNER_CLASS} text-muted-foreground`}>
        © {COPYRIGHT_YEAR} {ORG_NAME}. Built with care.
      </div>
    </footer>
  );
}

/**
 * A footer-shaped hole, for the moment before the real one resolves.
 *
 * Reserves the height by rendering the SAME box with blank text rather than a
 * hardcoded pixel value - so it stays correct if the footer's padding or type
 * scale ever changes, which a magic number would not.
 */
export function FooterFallback() {
  return (
    <div className={FOOTER_SHELL_CLASS} aria-hidden>
      <div className={FOOTER_INNER_CLASS}>&nbsp;</div>
    </div>
  );
}

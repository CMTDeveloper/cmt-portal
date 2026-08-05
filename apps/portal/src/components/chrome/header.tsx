import Link from 'next/link';
import { Nav } from './nav';
import { ORG_NAME } from '@/lib/branding';

/**
 * The header's own box, shared with the root layout's Suspense fallback so the
 * placeholder cannot drift from the real thing. See the note in footer.tsx -
 * the footer's placeholder DID drift, which is why both are constants now.
 */
export const HEADER_SHELL_CLASS = 'border-b border-border bg-background';
export const HEADER_BAR_CLASS = 'h-16';

export function Header() {
  return (
    <header className={HEADER_SHELL_CLASS}>
      <div className={`container mx-auto flex ${HEADER_BAR_CLASS} items-center justify-between px-4`}>
        <Link href="/" className="flex items-center gap-3" aria-label={`${ORG_NAME} home`}>
          {/* The brand mark ships as a white silhouette PNG (built for a dark
              background), so it's invisible on the light header, and its 29:67
              aspect overflows the 64px bar when forced square. Render it as a
              CSS mask filled with the heading teal: recolors it to match the
              wordmark, stays crisp, and is sized to its real aspect. */}
          <span
            aria-hidden
            className="h-11 w-5 shrink-0 bg-heading"
            style={{
              WebkitMaskImage: 'url(/cmt-logo.png)',
              maskImage: 'url(/cmt-logo.png)',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
          <span className="hidden font-sans text-lg text-heading sm:inline">
            {ORG_NAME}
          </span>
        </Link>
        <Nav />
      </div>
    </header>
  );
}

/**
 * A header-shaped hole, for the moment before the real one resolves.
 *
 * `usePathname()` makes the real header request-time dynamic, so under
 * cacheComponents it is deferred to the dynamic phase. Until 2026-08-04 the
 * fallback was `null`, which - together with a route that had no loading.tsx -
 * left the browser nothing at all to paint. Families reported that as "it just
 * goes blank".
 */
export function HeaderFallback() {
  return (
    <div className={HEADER_SHELL_CLASS} aria-hidden>
      <div className={HEADER_BAR_CLASS} />
    </div>
  );
}

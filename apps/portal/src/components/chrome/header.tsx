import Link from 'next/link';
import { Nav } from './nav';
import { ORG_NAME } from '@/lib/branding';

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
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

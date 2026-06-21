import Image from 'next/image';
import Link from 'next/link';
import { Nav } from './nav';
import { ORG_NAME } from '@/lib/branding';

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3" aria-label={`${ORG_NAME} home`}>
          <Image
            src="/cmt-logo.png"
            alt={ORG_NAME}
            width={48}
            height={48}
            priority
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

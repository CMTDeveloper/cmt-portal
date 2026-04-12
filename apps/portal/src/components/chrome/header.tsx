import Image from 'next/image';
import Link from 'next/link';
import { Nav } from './nav';

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3" aria-label="Chinmaya Mission Toronto home">
          <Image
            src="/cmt-logo.png"
            alt="Chinmaya Mission Toronto"
            width={48}
            height={48}
            priority
          />
          <span className="hidden font-serif text-lg text-heading sm:inline">
            Chinmaya Mission Toronto
          </span>
        </Link>
        <Nav />
      </div>
    </header>
  );
}

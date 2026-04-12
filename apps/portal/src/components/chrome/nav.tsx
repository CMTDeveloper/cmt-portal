import Link from 'next/link';

interface NavItem {
  label: string;
  href: string;
  external?: boolean;
}

const items: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'About', href: 'https://chinmayatoronto.org/', external: true },
];

export function Nav() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-6">
      {items.map((item) =>
        item.external ? (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-foreground transition-colors hover:text-primary"
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-foreground transition-colors hover:text-primary"
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}

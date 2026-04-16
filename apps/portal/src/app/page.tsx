import Image from 'next/image';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@cmt/ui';

interface FeatureCard {
  href: string;
  title: string;
  description: string;
  cta: string;
}

const cards: FeatureCard[] = [
  {
    href: '/events',
    title: 'Events',
    description: 'Register for upcoming events at the Ashram and across the community.',
    cta: 'Open Events →',
  },
  {
    href: '/login/family',
    title: 'Family Check-in',
    description: 'Sign your family in when you arrive at the Ashram.',
    cta: 'Open Check-in →',
  },
  {
    href: '/login/teacher',
    title: 'Teacher Portal',
    description: 'Access attendance records and class management for teachers.',
    cta: 'Open Teacher Portal →',
  },
  {
    href: '/login/admin',
    title: 'Admin Dashboard',
    description: 'Manage families, registrations, and site-wide settings.',
    cta: 'Open Admin Dashboard →',
  },
];

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <section className="mb-16 flex flex-col items-center text-center">
        <Image
          src="/cmt-logo.png"
          alt=""
          width={120}
          height={120}
          priority
          className="mb-6"
        />
        <h1 className="mb-4 font-serif text-4xl text-heading sm:text-5xl">
          Chinmaya Mission Toronto
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Bridging knowledge, community, and spiritual practice.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block transition-transform hover:-translate-y-1"
            aria-label={`${card.title}: ${card.description}`}
          >
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="font-serif text-2xl text-heading">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-medium text-primary">{card.cta}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}

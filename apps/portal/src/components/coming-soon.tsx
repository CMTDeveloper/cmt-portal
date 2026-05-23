import { Card, CardContent } from '@cmt/ui';
import Link from 'next/link';

interface ComingSoonProps {
  feature: string;
}

export function ComingSoon({ feature }: ComingSoonProps) {
  return (
    <div className="container mx-auto max-w-2xl py-16">
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="font-sans text-3xl text-heading">{feature}</h1>
          <p className="text-muted-foreground">
            This feature is coming soon. We&apos;re moving the existing {feature.toLowerCase()} app
            into the Chinmaya Mission Toronto portal.
          </p>
          <Link href="/" className="text-primary underline">
            ← Back to portal home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

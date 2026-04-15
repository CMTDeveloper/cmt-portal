'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Family } from '@cmt/shared-domain/check-in';
import { FamilyIdLookupForm } from './family-id-lookup-form';
import { KioskCheckInPanel } from './kiosk-check-in-panel';

export function KioskHome() {
  const [family, setFamily] = useState<Family | null>(null);

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section className="flex flex-col items-center justify-center gap-6 bg-[hsl(var(--primary))] p-8 text-white">
        <h1 className="text-4xl font-bold">Family check-in</h1>
        <div className="w-full max-w-sm rounded-lg bg-white p-6 text-[hsl(var(--foreground))]">
          <FamilyIdLookupForm onFamily={setFamily} />
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href="/check-in/guest" className="underline">
            New visitor? Guest check-in
          </Link>
          <Link href="/check-in/lookup" className="underline">
            Forgot your family ID?
          </Link>
        </nav>
      </section>
      <section className="flex flex-col items-center justify-center bg-white p-8">
        {family ? (
          <KioskCheckInPanel family={family} onDone={() => setFamily(null)} />
        ) : (
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-semibold text-[hsl(var(--heading))]">
              Welcome to Chinmaya Mission Toronto
            </h2>
            <p className="mt-4 text-[hsl(var(--foreground))]">
              Enter your family ID on the left to check in.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

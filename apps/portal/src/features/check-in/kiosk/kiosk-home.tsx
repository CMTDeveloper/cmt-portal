'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Family } from '@cmt/shared-domain/check-in';
import { FamilyIdLookupForm } from './family-id-lookup-form';
import { KioskCheckInPanel } from './kiosk-check-in-panel';

interface Selection {
  family: Family;
  source: 'setu' | 'legacy';
  checkInId: string;
}

export function KioskHome() {
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section className="flex flex-col items-center justify-center bg-[hsl(var(--primary))] p-8 text-white">
        <div className="w-full max-w-sm">
          <h1 className="mb-6 text-center text-4xl font-bold">Family check-in</h1>
          <div className="rounded-lg bg-white p-6 text-[hsl(var(--foreground))] shadow-lg">
            <FamilyIdLookupForm
              onFamily={(family, source, checkInId) => setSelection({ family, source, checkInId })}
            />
          </div>

          {/* "Need help?" card - mirrors the legacy door app's helper links so
              guests and families who forgot their ID have the same options. */}
          <div className="mt-6 rounded-lg bg-white p-6 text-[hsl(var(--foreground))] shadow-lg">
            <h2 className="mb-3 text-lg font-semibold text-[hsl(var(--heading))]">Need help?</h2>
            <ul className="flex flex-col gap-1">
              <li>
                <Link
                  href="/check-in/guest"
                  className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  <span aria-hidden className="text-xl">👋</span>
                  <span>
                    <span className="block font-medium">New visitor?</span>
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">
                      Check in as a guest
                    </span>
                  </span>
                </Link>
              </li>
              <li>
                <Link
                  href="/check-in/lookup"
                  className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-[hsl(var(--accent))]"
                >
                  <span aria-hidden className="text-xl">🔍</span>
                  <span>
                    <span className="block font-medium">Forgot your Family ID?</span>
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">Look it up here</span>
                  </span>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
      <section className="flex flex-col items-center justify-center bg-white p-8">
        {selection ? (
          <KioskCheckInPanel
            family={selection.family}
            source={selection.source}
            checkInId={selection.checkInId}
            onDone={() => setSelection(null)}
          />
        ) : (
          <div className="max-w-md text-center">
            <h2 className="text-3xl font-bold text-[hsl(var(--primary))]">Hari Om!</h2>
            <h3 className="mt-2 text-2xl font-semibold text-[hsl(var(--heading))]">
              Welcome to Chinmaya Mission Toronto
            </h3>
            <p className="mt-4 text-[hsl(var(--foreground))]">
              Before stepping into this sacred space, let us take a moment together:
            </p>
            <p className="mt-4 text-lg font-medium text-[hsl(var(--primary))]">
              All families and guests must check in.
            </p>
            <p className="mt-4 text-[hsl(var(--foreground))]">
              Please enter your Family ID on the left to check in your family.
            </p>
            <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
              If you need assistance, please ask a sevak for help.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

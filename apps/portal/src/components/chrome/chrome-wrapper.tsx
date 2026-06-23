'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// Routes that own their own chrome (themed sidebar/header) — the public
// Chinmaya Mission Toronto / Home / About bar should NOT render on top.
const SUPPRESS_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/sign-in($|\/)/,
  /^\/register($|\/)/,
  /^\/family($|\/)/,
  /^\/invite($|\/)/,
  /^\/join-request($|\/)/,
  /^\/welcome($|\/)/,
  /^\/admin($|\/)/,
  /^\/teacher($|\/)/,
  /^\/docs($|\/)/,
];

export function ChromeWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const suppress = SUPPRESS_PATTERNS.some((p) => p.test(pathname));
  return suppress ? null : <>{children}</>;
}

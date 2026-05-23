'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const SUPPRESS_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/sign-in($|\/)/,
  /^\/register($|\/)/,
  /^\/family($|\/)/,
  /^\/invite($|\/)/,
];

export function ChromeWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const suppress = SUPPRESS_PATTERNS.some((p) => p.test(pathname));
  return suppress ? null : <>{children}</>;
}

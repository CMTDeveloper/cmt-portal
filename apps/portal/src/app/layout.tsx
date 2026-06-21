import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Header } from '@/components/chrome/header';
import { Footer } from '@/components/chrome/footer';
import { ChromeWrapper } from '@/components/chrome/chrome-wrapper';
import { ToasterMount } from '@/components/chrome/toaster-mount';
import { SITE_TITLE_DEFAULT, SITE_TITLE_TEMPLATE, SITE_DESCRIPTION } from '@/lib/branding';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Home/default tab title: "Chinmaya Setu | Chinmaya Mission Toronto".
  // Child pages set a bare title (e.g. 'My family') → template makes it
  // "My family | Chinmaya Setu". All brand wording lives in lib/branding.ts.
  title: { default: SITE_TITLE_DEFAULT, template: SITE_TITLE_TEMPLATE },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        {/* ChromeWrapper uses usePathname() which is request-time dynamic data.
            Suspense lets cacheComponents prerender the static shell first. */}
        <Suspense fallback={null}>
          <ChromeWrapper>
            <Header />
          </ChromeWrapper>
        </Suspense>
        <main className="flex-1">{children}</main>
        <Suspense fallback={null}>
          <ChromeWrapper>
            <Footer />
          </ChromeWrapper>
        </Suspense>
        <ToasterMount />
      </body>
    </html>
  );
}

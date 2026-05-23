import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Header } from '@/components/chrome/header';
import { Footer } from '@/components/chrome/footer';
import { ChromeWrapper } from '@/components/chrome/chrome-wrapper';
import { ToasterMount } from '@/components/chrome/toaster-mount';
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
  title: 'Chinmaya Mission Toronto',
  description:
    'Bridging knowledge, community, and spiritual practice — Chinmaya Mission Toronto portal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <ChromeWrapper>
          <Header />
        </ChromeWrapper>
        <main className="flex-1">{children}</main>
        <ChromeWrapper>
          <Footer />
        </ChromeWrapper>
        <ToasterMount />
      </body>
    </html>
  );
}

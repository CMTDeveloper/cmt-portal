import type { Metadata } from 'next';
import { Inter, Merriweather } from 'next/font/google';
import { Header } from '@/components/chrome/header';
import { Footer } from '@/components/chrome/footer';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-serif',
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
    <html lang="en" className={`${inter.variable} ${merriweather.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

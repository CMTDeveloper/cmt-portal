import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container mx-auto flex min-h-[40vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-sans text-3xl text-heading">Page not found</h1>
      <p className="text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link href="/" className="text-primary underline">
        ← Back to portal home
      </Link>
    </div>
  );
}

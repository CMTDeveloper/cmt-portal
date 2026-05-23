// Year is computed at build time so this component stays prerender-safe under
// Next.js 16 cacheComponents:true (which forbids new Date() in a Server
// Component before any dynamic API). Update the constant once a year.
const COPYRIGHT_YEAR = 2026;

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted">
      <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
        © {COPYRIGHT_YEAR} Chinmaya Mission Toronto. Built with care.
      </div>
    </footer>
  );
}

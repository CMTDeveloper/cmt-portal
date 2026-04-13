export function Footer() {
  return (
    <footer className="border-t border-border bg-muted">
      <div className="container mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Chinmaya Mission Toronto. Built with care.
      </div>
    </footer>
  );
}

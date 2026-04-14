export default function AdminLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}

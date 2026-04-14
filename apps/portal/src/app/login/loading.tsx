export default function LoginLoading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center p-6">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}

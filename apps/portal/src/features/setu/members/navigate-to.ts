// A deliberately HARD navigation (full document load), wrapped so it stays
// trivially mockable from client-component tests.
//
// Why hard, not router.push: the profile-completion screen sits behind the
// /family layout's redirect gate. A SOFT router.push('/family') runs that gate
// client-side; if the gate reads the family through its `use cache` tag during
// the brief stale window after a write (revalidateTag invalidates only in the
// background), it can still see the pre-save (incomplete) family and
// redirect('/complete-profile'). Because that lands back on the SAME route,
// React preserves the current component instance and its state (saving=true) —
// a permanent "Saving…". A full document load destroys the component and
// re-runs the gate server-side on fresh data, so a stale-read bounce can never
// strand the user.
export function navigateTo(path: string): void {
  window.location.assign(path);
}

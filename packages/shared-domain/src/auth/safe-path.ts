/**
 * True when `from` is a safe INTERNAL redirect target - a same-origin absolute
 * path. Rejects null/undefined, protocol-relative (`//host`), and any absolute
 * URL (`scheme://...`) so a `?from=` param can never drive an open redirect.
 *
 * Shared by the middleware, the password/kiosk sign-in endpoints, and the
 * sign-in forms so the guard cannot drift between layers. A type guard so call
 * sites narrow `from` to `string` on the safe branch.
 */
export function isSafeInternalPath(from: string | null | undefined): from is string {
  return (
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.includes('://')
  );
}

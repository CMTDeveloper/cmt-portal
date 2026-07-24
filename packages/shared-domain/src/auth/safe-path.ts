/**
 * True when `from` is a safe INTERNAL redirect target - a same-origin absolute
 * path. Rejects null/undefined, protocol-relative (`//host`), any absolute URL
 * (`scheme://...`), and - critically - any string containing a backslash or
 * control character, so a `?from=` param can never drive an open redirect.
 *
 * The backslash guard matters because browsers and the WHATWG URL parser treat
 * `\` as `/` in the authority: `/\evil.example` would otherwise pass the
 * startsWith('/')/!startsWith('//') checks yet resolve to `https://evil.example/`.
 * Control characters are rejected so a host can't be smuggled past the checks.
 *
 * Shared by the middleware, the password/kiosk/OTP/magic-link sign-in endpoints,
 * and the sign-in forms so the guard cannot drift between layers. A type guard so
 * call sites narrow `from` to `string` on the safe branch.
 */

// True if `s` contains a backslash (0x5C), any C0 control char (< 0x20), or DEL
// (0x7F). Char-code checks avoid embedding control chars in a regex literal.
function hasUnsafePathChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c || c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function isSafeInternalPath(from: string | null | undefined): from is string {
  return (
    typeof from === 'string' &&
    !hasUnsafePathChar(from) &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.includes('://')
  );
}

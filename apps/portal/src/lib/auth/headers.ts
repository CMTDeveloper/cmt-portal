import { ROLES, type Role } from '@cmt/shared-domain';

export interface PortalSessionHeaders {
  uid: string | null;
  role: Role;
  extraRoles: Role[];
  fid: string | null;
  mid: string | null;
  /** Verified contact from the session claims (set at sign-in). */
  email: string | null;
  phone: string | null;
}

/** Anything with a header getter: a `Request.headers`, a `Headers`, or the
 *  `ReadonlyHeaders` returned by next/headers' `headers()`. */
export interface HeaderBag {
  get(name: string): string | null;
}

/**
 * Reconstructs the verified session from the x-portal-* headers middleware
 * already set (from its single checkRevoked cookie verify). Returns null only
 * when x-portal-role is missing or not a known Role — uid absence is allowed
 * because family-role routes authenticate via fid, not uid.
 *
 * This is the ONE verification point's output: middleware verifies once per
 * request and forwards the claims here, so downstream code MUST read these
 * headers instead of re-verifying the cookie (each re-verify with
 * checkRevoked=true is a Firebase Auth network round-trip).
 */
export function readSessionFromHeaderBag(h: HeaderBag): PortalSessionHeaders | null {
  const role = h.get('x-portal-role');
  if (!role || !(ROLES as readonly string[]).includes(role)) return null;

  const extrasHeader = h.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => (ROLES as readonly string[]).includes(s));

  return {
    uid: h.get('x-portal-uid'),
    role: role as Role,
    extraRoles,
    fid: h.get('x-portal-fid'),
    mid: h.get('x-portal-mid'),
    email: h.get('x-portal-email'),
    phone: h.get('x-portal-phone'),
  };
}

/** Same, from a Request (API route handlers). */
export function readSessionFromHeaders(req: Request): PortalSessionHeaders | null {
  return readSessionFromHeaderBag(req.headers);
}

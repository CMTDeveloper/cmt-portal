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

/**
 * Reads portal session headers set by middleware. Returns null only when
 * x-portal-role is missing or not a known Role — uid absence is allowed
 * because family-role routes authenticate via fid, not uid.
 */
export function readSessionFromHeaders(req: Request): PortalSessionHeaders | null {
  const role = req.headers.get('x-portal-role');
  if (!role || !(ROLES as readonly string[]).includes(role)) return null;

  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => (ROLES as readonly string[]).includes(s));

  return {
    uid: req.headers.get('x-portal-uid'),
    role: role as Role,
    extraRoles,
    fid: req.headers.get('x-portal-fid'),
    mid: req.headers.get('x-portal-mid'),
    email: req.headers.get('x-portal-email'),
    phone: req.headers.get('x-portal-phone'),
  };
}

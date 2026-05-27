import { ROLES, type Role } from '@cmt/shared-domain';

export interface PortalSessionHeaders {
  uid: string;
  role: Role;
  extraRoles: Role[];
  fid: string | null;
  mid: string | null;
}

export function readSessionFromHeaders(req: Request): PortalSessionHeaders | null {
  const uid = req.headers.get('x-portal-uid');
  const role = req.headers.get('x-portal-role');
  if (!uid || !role || !(ROLES as readonly string[]).includes(role)) return null;

  const extrasHeader = req.headers.get('x-portal-extra-roles') ?? '';
  const extraRoles = extrasHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Role => (ROLES as readonly string[]).includes(s));

  return {
    uid,
    role: role as Role,
    extraRoles,
    fid: req.headers.get('x-portal-fid'),
    mid: req.headers.get('x-portal-mid'),
  };
}

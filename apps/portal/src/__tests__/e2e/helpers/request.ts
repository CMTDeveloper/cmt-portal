export interface PortalRequestHeaders {
  role?: 'family-manager' | 'family-member' | 'welcome-team';
  fid?: string;
  mid?: string;
  uid?: string;
  sessionCookie?: string;
}

/**
 * Builds a Request with the x-portal-* headers that middleware would inject
 * after verifying the session cookie.
 */
export function makePortalRequest(
  method: string,
  url: string,
  body: unknown,
  headers: PortalRequestHeaders,
): Request {
  const reqHeaders: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (headers.role) reqHeaders['x-portal-role'] = headers.role;
  if (headers.fid) reqHeaders['x-portal-fid'] = headers.fid;
  if (headers.mid) reqHeaders['x-portal-mid'] = headers.mid;
  if (headers.uid) reqHeaders['x-portal-uid'] = headers.uid;
  if (headers.sessionCookie) reqHeaders['cookie'] = `__session=${headers.sessionCookie}`;

  return new Request(`http://localhost${url}`, {
    method,
    headers: reqHeaders,
    ...(body !== null && body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

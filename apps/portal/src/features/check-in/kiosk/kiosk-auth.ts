'use client';

/**
 * When a kiosk API call returns 401 (the shared __session cookie lapsed - the
 * Firebase session cookie has a hard 14-day cap), hard-navigate to the staff
 * login with a clear "session expired" prompt so the sevak re-signs in, instead
 * of showing a silent generic error on the next tap. Returns true when it handled
 * the response (caller should stop its own error handling), false otherwise.
 */
export function handleKioskAuthExpiry(res: Response): boolean {
  if (res.status === 401) {
    window.location.assign('/check-in/staff-sign-in?error=session-expired');
    return true;
  }
  return false;
}

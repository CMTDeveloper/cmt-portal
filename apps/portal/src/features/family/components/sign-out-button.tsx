'use client';

import { SetuIcon, toast } from '@cmt/ui';

export async function signOut(): Promise<void> {
  const res = await fetch('/api/setu/auth/signout', { method: 'POST' });
  if (res.ok) {
    window.location.href = '/sign-in';
    return;
  }
  toast.error('Sign out failed. Please try again.');
}

interface SignOutButtonProps {
  style?: React.CSSProperties;
  showIcon?: boolean;
}

export function SignOutButton({ style, showIcon = true }: SignOutButtonProps) {
  return (
    <button
      onClick={() => { void signOut(); }}
      style={style}
    >
      {showIcon && <SetuIcon.user/>}
      Sign out
    </button>
  );
}

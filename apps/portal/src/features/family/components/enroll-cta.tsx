'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@cmt/ui';

interface EnrollCtaProps {
  pid: string;
  donationsEnabled: boolean;
}

function safeFrom(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) return path;
  return '/family/enroll';
}

export function EnrollCta({ pid, donationsEnabled }: EnrollCtaProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  async function handleEnroll() {
    setPending(true);
    try {
      const res = await fetch('/api/setu/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      });

      if (res.status === 401) {
        router.push(`/sign-in?from=${encodeURIComponent(safeFrom('/family/enroll'))}`);
        return;
      }

      const json = await res.json() as { eid?: string; donateUrl?: string; error?: string };

      if (!res.ok) {
        const err = json.error;
        if (err === 'period-disabled' || err === 'period-expired') {
          toast.error('This period is no longer enrolling — please contact the welcome team.');
        } else if (err === 'period-not-yet-open') {
          toast.error('This enrollment period has not opened yet — please check back soon.');
        } else if (err === 'family-not-found' || err === 'missing-fid') {
          console.error('[EnrollCta] unexpected error:', err);
          toast.error('Something went wrong — please sign out and sign in again.');
        } else {
          toast.error('Enrollment failed — please try again.');
        }
        setPending(false);
        return;
      }

      if (donationsEnabled) {
        toast.success('Enrolled! Continuing to donation.');
        // Do NOT clear pending on success — navigation unmounts the component.
        router.push(json.donateUrl ?? '/family/donate');
      } else {
        toast.success('Your family is enrolled!');
        setEnrolled(true);
        setPending(false);
      }
    } catch {
      toast.error('Network error — please try again.');
      setPending(false);
    }
  }

  if (enrolled) {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
        Your family is enrolled — donation coming soon.
      </div>
    );
  }

  return (
    <button
      className="btn btn--p btn--block"
      disabled={pending}
      onClick={handleEnroll}
      style={{ opacity: pending ? 0.6 : 1 }}
    >
      {pending ? 'Enrolling…' : 'Enroll →'}
    </button>
  );
}

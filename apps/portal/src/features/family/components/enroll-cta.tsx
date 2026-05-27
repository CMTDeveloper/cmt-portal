'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@cmt/ui';

interface EnrollCtaProps {
  pid: string;
}

export function EnrollCta({ pid }: EnrollCtaProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleEnroll() {
    setPending(true);
    try {
      const res = await fetch('/api/setu/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      });
      const json = await res.json() as { eid?: string; donateUrl?: string; error?: string };
      if (!res.ok) {
        toast.error(json.error === 'period-expired'
          ? 'This period is no longer active.'
          : json.error === 'period-disabled'
            ? 'This period is currently disabled.'
            : 'Enrollment failed — please try again.');
        return;
      }
      toast.success('Enrolled! Continuing to donation.');
      router.push(json.donateUrl ?? '/family/donate');
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className="btn btn--p btn--block"
      disabled={pending}
      onClick={handleEnroll}
      style={{ opacity: pending ? 0.6 : 1 }}
    >
      {pending ? 'Enrolling…' : 'Enroll & continue to donation →'}
    </button>
  );
}

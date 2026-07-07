'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { PaymentSource } from '@cmt/shared-domain';
import { startEnrollmentCheckout, type EnrollmentCheckoutResult } from './start-checkout-client';

interface EnrollCtaProps {
  /** The offering id (oid) to enroll the family in. */
  oid: string;
  /** usesDonation && feature-flag — when true, success redirects to donate. */
  donationsEnabled: boolean;
  /**
   * The program's `capabilities.usesDonation`. Controls the post-enroll message:
   * a no-donation program says "enrolled", a donation program whose collection
   * isn't live yet says "donation coming soon". The `enrolled` view is only
   * reached when `donationsEnabled` is false, so this disambiguates the two
   * reasons it can be false. Defaults to false (safe "enrolled" wording).
   */
  usesDonation?: boolean;
  paymentSource?: PaymentSource;
}

function safeFrom(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) return path;
  return '/family/enroll';
}

function enrolledStateText(usesDonation: boolean, paymentSource: PaymentSource) {
  if (usesDonation && paymentSource === 'teacher-managed') {
    return 'Your family is enrolled — payment is managed by the teacher.';
  }
  return usesDonation ? 'Your family is enrolled — donation coming soon.' : 'Your family is enrolled.';
}

export function EnrollCta({ oid, donationsEnabled, usesDonation = false, paymentSource = 'portal' }: EnrollCtaProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  async function handleEnroll() {
    setPending(true);
    try {
      const res = await fetch('/api/setu/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid }),
      });

      if (res.status === 401) {
        router.push(`/sign-in?from=${encodeURIComponent(safeFrom('/family/enroll'))}`);
        return;
      }

      const json = await res.json() as { eid?: string; suggestedAmount?: number; donateUrl?: string; error?: string };

      if (!res.ok) {
        const err = json.error;
        if (err === 'offering-disabled') {
          toast.error('This term is no longer enrolling — please contact the welcome team.');
        } else if (err === 'offering-expired') {
          toast.error('This term has ended — please contact the welcome team.');
        } else if (err === 'offering-not-found') {
          toast.error('This term is no longer available — please refresh and try again.');
        } else if (err === 'program-not-available') {
          toast.error('This program is not available right now — please check back soon.');
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
        // Go STRAIGHT to Stripe at the enrollment-resolved amount — skip the
        // /family/donate amount-picker page (owner decision 2026-07-04; this was
        // the last donate surface still landing on that page). Do NOT clear
        // pending on success — navigation unmounts the component.
        const eid = json.eid;
        const amount = json.suggestedAmount ?? 0;
        if (eid && amount >= 1) {
          toast.success('Enrolled! Taking you to payment…');
          let checkout: EnrollmentCheckoutResult;
          try {
            checkout = await startEnrollmentCheckout(eid, amount);
          } catch {
            checkout = { ok: false, reason: 'error' };
          }
          if (checkout.ok) {
            window.location.href = checkout.url;
            return;
          }
          if (checkout.reason === 'unauthorized') {
            router.push(`/sign-in?from=${encodeURIComponent(safeFrom('/family'))}`);
            return;
          }
          // Any other checkout issue → fall back to the donate page so the family
          // can still pay (its picker handles below-suggested / not-configured).
          router.push(json.donateUrl ?? `/family/donate?eid=${eid}`);
          return;
        }
        // Free / $0-suggested (or missing eid) → the donate page owns that flow.
        toast.success('Enrolled!');
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
        {enrolledStateText(usesDonation, paymentSource)}
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

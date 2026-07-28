'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { PaymentSource } from '@cmt/shared-domain';
import { startEnrollmentCheckout, type EnrollmentCheckoutResult } from './start-checkout-client';
import { enrollFamily } from './enroll-client';

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
      // The POST and its error wording live in `enroll-client` so the enroll
      // page's donation choice can enrol a family too, without a second copy of
      // the ladder that would drift from this one.
      const result = await enrollFamily(oid);

      if (!result.ok) {
        if (result.reason === 'unauthorized') {
          router.push(`/sign-in?from=${encodeURIComponent(safeFrom('/family/enroll'))}`);
          return;
        }
        toast.error(result.message);
        setPending(false);
        return;
      }

      const json = { eid: result.eid ?? undefined, suggestedAmount: result.suggestedAmount, donateUrl: result.donateUrl ?? undefined };

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

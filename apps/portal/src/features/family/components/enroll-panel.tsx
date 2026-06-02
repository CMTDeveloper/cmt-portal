'use client';

import { useState } from 'react';
import type { OfferingDoc } from '@cmt/shared-domain';
import { OfferingPicker } from './offering-picker';
import { EnrollCta } from './enroll-cta';

interface EnrollPanelProps {
  /** Open offerings the family may enroll in. Always length >= 1. */
  offerings: OfferingDoc[];
  /** The oid pre-selected on first render (defaults to the first offering). */
  defaultOid: string;
  donationsEnabled: boolean;
  /** program.capabilities.usesDonation — drives the post-enroll message wording. */
  usesDonation?: boolean;
  /** Optional heading rendered above the picker (e.g. "Select term"). */
  pickerLabel?: React.ReactNode;
}

/**
 * Client wrapper that owns the selected-offering state for the enroll flow.
 *
 * It renders the OfferingPicker and the EnrollCta together so that selecting a
 * different offering changes the oid the CTA POSTs to /api/setu/enrollments.
 *
 * With ONE offering the picker auto-displays the single term (no radios) and
 * the CTA submits that oid — identical to the prior BV behaviour. With MULTIPLE
 * offerings the radios drive the submitted oid.
 */
export function EnrollPanel({ offerings, defaultOid, donationsEnabled, usesDonation = false, pickerLabel }: EnrollPanelProps) {
  const [selectedOid, setSelectedOid] = useState(defaultOid);

  return (
    <>
      {offerings.length > 1 && pickerLabel}
      <OfferingPicker
        offerings={offerings}
        selectedOid={selectedOid}
        onSelect={setSelectedOid}
      />
      <EnrollCta oid={selectedOid} donationsEnabled={donationsEnabled} usesDonation={usesDonation} />
    </>
  );
}

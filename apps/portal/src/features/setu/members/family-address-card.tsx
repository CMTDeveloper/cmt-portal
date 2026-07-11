'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { CANADIAN_POSTAL_RE, type FamilyAddress } from '@cmt/shared-domain';
import { SectionLabel } from '@/features/family/components/atoms';
import { ProvinceSelect } from './province-select';

interface Props {
  address: FamilyAddress | null;
  isManager: boolean;
}

const cardStyle: React.CSSProperties = {
  padding: 14,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

/**
 * The required family-level home address. Managers edit it inline
 * (PATCH /api/setu/family); everyone else sees a read-only view.
 *
 * On save we optimistically set local state to the value we just wrote and toast
 * - we do NOT re-read or refresh. A re-read of the just-invalidated `use cache`
 * value can be stale (project rule: trust the write you just made). There is no
 * "Remove" - the address is required, so there is no clear action.
 */
export function FamilyAddressCard({ address, isManager }: Props) {
  const [saved, setSaved] = useState<FamilyAddress | null>(address);
  const [street, setStreet] = useState(address?.street ?? '');
  const [unit, setUnit] = useState(address?.unit ?? '');
  const [city, setCity] = useState(address?.city ?? '');
  // Families are Ontario-based, so default the province to ON when unset.
  const [province, setProvince] = useState(address?.province ?? 'ON');
  const [postalCode, setPostalCode] = useState(address?.postalCode ?? '');
  const [saving, setSaving] = useState(false);

  // Read-only view for non-managers.
  if (!isManager) {
    return (
      <div>
        <SectionLabel>Home address</SectionLabel>
        <div style={cardStyle}>
          {saved ? (
            <div style={{ fontSize: 13, color: 'var(--body-text)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>{saved.street}</div>
              {saved.unit ? <div>{saved.unit}</div> : null}
              <div>{saved.city} {saved.province} {saved.postalCode}</div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No home address on file.</p>
          )}
        </div>
      </div>
    );
  }

  const canSave =
    street.trim().length > 0 &&
    city.trim().length > 0 &&
    province.trim().length > 0 &&
    CANADIAN_POSTAL_RE.test(postalCode.trim());

  async function save(next: FamilyAddress) {
    setSaving(true);
    try {
      const res = await fetch('/api/setu/family', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ familyAddress: next }),
      });
      if (res.ok) {
        setSaved(next);
        toast.success('Home address saved');
      } else {
        toast.error('Could not save address - please try again');
      }
    } catch {
      toast.error('Network error - please try again');
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!canSave) return;
    void save({
      street: street.trim(),
      unit: unit.trim(),
      city: city.trim(),
      province: province.trim(),
      postalCode: postalCode.trim().toUpperCase(),
    });
  }

  return (
    <div>
      <SectionLabel>Home address</SectionLabel>
      <div style={cardStyle}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Street <span className="req">·</span></label>
          <input
            className="input"
            type="text"
            aria-label="Street address"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Unit <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="input"
            type="text"
            aria-label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>City <span className="req">·</span></label>
          <input
            className="input"
            type="text"
            aria-label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Province <span className="req">·</span></label>
          <ProvinceSelect value={province} onChange={setProvince} />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Postal code <span className="req">·</span></label>
          <input
            className="input"
            type="text"
            aria-label="Postal code"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn--p" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import type { FamilyEmergencyContact } from '@cmt/shared-domain';
import { SectionLabel } from '@/features/family/components/atoms';
import { RelationSelect } from './relation-select';

interface Props {
  contact: FamilyEmergencyContact | null;
  isManager: boolean;
}

const cardStyle: React.CSSProperties = {
  padding: 14,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

/**
 * The single, optional family-level emergency contact. Managers edit it inline
 * (PATCH /api/setu/family); everyone else sees a read-only view.
 *
 * On save we optimistically set local state to the value we just wrote and toast
 * - we do NOT re-read or refresh. A re-read of the just-invalidated `use cache`
 * value can be stale (project rule: trust the write you just made).
 */
export function FamilyEmergencyContactCard({ contact, isManager }: Props) {
  const [saved, setSaved] = useState<FamilyEmergencyContact | null>(contact);
  const [relation, setRelation] = useState(contact?.relation ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [saving, setSaving] = useState(false);

  // Read-only view for non-managers (and the always-visible summary style).
  if (!isManager) {
    return (
      <div>
        <SectionLabel>Emergency contact</SectionLabel>
        <div style={cardStyle}>
          {saved ? (
            <div style={{ fontSize: 13, color: 'var(--body-text)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div><span style={{ color: 'var(--muted)' }}>Relation:</span> {saved.relation}</div>
              <div style={{ fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--muted)', fontFamily: 'var(--body)' }}>Phone:</span> {saved.phone}</div>
              {saved.email ? (
                <div style={{ fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--muted)', fontFamily: 'var(--body)' }}>Email:</span> {saved.email}</div>
              ) : null}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No emergency contact on file.</p>
          )}
        </div>
      </div>
    );
  }

  const canSave = relation.trim().length > 0 && phone.trim().length > 0;

  async function save(next: FamilyEmergencyContact | null) {
    setSaving(true);
    try {
      const res = await fetch('/api/setu/family', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ familyEmergencyContact: next }),
      });
      if (res.ok) {
        setSaved(next);
        // Only blank the inputs once the removal actually succeeded, so a failed
        // request leaves the form reflecting the still-present server record.
        if (next === null) {
          setRelation('');
          setPhone('');
          setEmail('');
        }
        toast.success(next ? 'Emergency contact saved' : 'Emergency contact removed');
      } else {
        toast.error('Could not save emergency contact - please try again');
      }
    } catch {
      toast.error('Network error - please try again');
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!canSave) return;
    void save({ relation: relation.trim(), phone: phone.trim(), email: email.trim() });
  }

  function handleRemove() {
    void save(null);
  }

  return (
    <div>
      <SectionLabel>Emergency contact</SectionLabel>
      <div style={cardStyle}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Relation <span className="req">·</span></label>
          <RelationSelect value={relation} onChange={setRelation} />
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Phone <span className="req">·</span></label>
          <input
            className="input"
            type="tel"
            aria-label="Emergency contact phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Email <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="input"
            type="email"
            aria-label="Emergency contact email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn--p" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={saving}
              className="focus-ring"
              style={{ background: 'transparent', border: 0, color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 4px' }}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

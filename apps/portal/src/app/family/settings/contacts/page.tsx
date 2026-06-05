'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { getCurrentFamilyClient } from '@/features/setu/members/get-current-family-client';
import { sendContactCode, verifyContactCode } from '@/features/setu/contacts/contacts-client';

type Stage = 'idle' | 'entering' | 'awaiting-code';

export default function ContactsSettingsPage() {
  const [emails, setEmails] = useState<string[]>([]);
  const [phones, setPhones] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [stage, setStage] = useState<Stage>('idle');
  const [addType, setAddType] = useState<'email' | 'phone'>('email');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await getCurrentFamilyClient();
    if (!data) {
      setLoaded(true);
      return;
    }
    const me = data.members.find((m) => m.mid === data.currentMid);
    if (me) {
      setEmails([me.email, ...(me.altEmails ?? [])].filter((v): v is string => !!v));
      setPhones([me.phone, ...(me.altPhones ?? [])].filter((v): v is string => !!v));
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  function beginAdd(type: 'email' | 'phone') {
    setAddType(type);
    setValue('');
    setCode('');
    setStage('entering');
  }

  async function handleSend() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const r = await sendContactCode(addType, value.trim());
      if (r.ok) {
        setStage('awaiting-code');
        toast.success('Code sent. Check your new contact for the code.');
      } else if (r.error === 'rate-limited') {
        toast.error('Too many codes requested. Try again later.');
      } else {
        toast.error('Could not send a code. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const r = await verifyContactCode(addType, value.trim(), code);
      if (r.ok) {
        toast.success('Contact added.');
        setStage('idle');
        await load();
      } else if (r.error === 'contact-in-use') {
        toast.error('That contact is already in use by another member — contact admin.');
      } else {
        toast.error('That code was invalid or expired. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const formSection = (
    <div>
      <SectionLabel>My contacts</SectionLabel>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Add the other emails and phone numbers you use so we always recognize you and don&apos;t create a duplicate family.
      </p>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Emails</div>
        {emails.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>None on file.</div>
        ) : (
          emails.map((e) => (
            <div key={e} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 6, fontSize: 13 }}>{e}</div>
          ))
        )}
        <button type="button" className="btn btn--g" style={{ marginTop: 6, fontSize: 13 }} onClick={() => beginAdd('email')}>
          Add an email
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Phones</div>
        {phones.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>None on file.</div>
        ) : (
          phones.map((p) => (
            <div key={p} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 6, fontSize: 13 }}>{p}</div>
          ))
        )}
        <button type="button" className="btn btn--g" style={{ marginTop: 6, fontSize: 13 }} onClick={() => beginAdd('phone')}>
          Add a phone
        </button>
      </div>

      {stage === 'entering' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>{addType === 'email' ? 'New email' : 'New phone'} <span className="req">·</span></label>
            <input
              className="input"
              type={addType === 'email' ? 'email' : 'tel'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={addType === 'email' ? 'New email' : 'New phone'}
              placeholder={addType === 'email' ? 'another@example.com' : '(416) 555-0000'}
            />
          </div>
          <button type="button" className="btn btn--p" disabled={busy} onClick={handleSend}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      )}

      {stage === 'awaiting-code' && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Verification code <span className="req">·</span></label>
            <input
              className="input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Verification code"
              placeholder="6-digit code"
            />
          </div>
          <button type="button" className="btn btn--p" disabled={busy} onClick={handleVerify}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      )}

      {!loaded && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
    </div>
  );

  return (
    <CspRoot>
      {/* Mobile header */}
      <div className="block md:hidden">
        <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
          <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
            <SetuIcon.back/>
          </Link>
          <span style={{ fontSize: 14, fontWeight: 600 }}>My contacts</span>
          <span style={{ width: 32 }}/>
        </div>
      </div>

      {/* Desktop header — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Settings</p>
          <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>My contacts</h1>
        </header>
      </div>

      {/* Single form surface — rendered once so it stays unambiguous for both
          layouts (and avoids duplicate DOM nodes jsdom can't hide via CSS). */}
      <div style={{ maxWidth: 520, padding: '20px 18px 100px' }} className="md:p-0">
        {formSection}
      </div>
    </CspRoot>
  );
}

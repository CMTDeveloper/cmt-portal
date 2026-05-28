'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@cmt/ui';
import { processingFeeCAD } from '@cmt/shared-domain';

export interface DonateFormProps {
  mode: 'bala-vihar' | 'general';
  eid: string | null;
  /** bala-vihar floor (give >=); null for general giving. */
  suggestedAmount: number | null;
  periodLabel: string | null;
  /** bala-vihar quick-pick chips; empty for general. */
  tiers: number[];
}

function safeFrom(path: string): string {
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('://')) return path;
  return '/family/donate';
}

export function DonateForm({ mode, eid, suggestedAmount, periodLabel, tiers }: DonateFormProps) {
  const router = useRouter();
  const floor = mode === 'bala-vihar' ? (suggestedAmount ?? 1) : 1;
  const [amount, setAmount] = useState<number>(mode === 'bala-vihar' ? floor : 0);
  const [coverFee, setCoverFee] = useState(false);
  const [pending, setPending] = useState(false);

  const belowFloor = mode === 'bala-vihar' && amount < floor;
  const invalid = amount < 1 || belowFloor;
  const fee = coverFee && amount >= 1 ? processingFeeCAD(amount) : 0;
  const total = amount + fee;

  async function handleGive() {
    if (invalid) return;
    setPending(true);
    try {
      const body =
        mode === 'bala-vihar'
          ? { type: 'bala-vihar', eid, amountCAD: amount, coverFee }
          : { type: 'general', amountCAD: amount, coverFee };

      const res = await fetch('/api/setu/donations/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        router.push(`/sign-in?from=${encodeURIComponent(safeFrom('/family/donate'))}`);
        return;
      }

      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string; suggested?: number };

      if (!res.ok) {
        if (json.error === 'amount-below-suggested') {
          toast.error(`The suggested amount is $${json.suggested}. Please contact the welcome team to give less.`);
        } else if (json.error === 'checkout-not-configured') {
          toast.error('Donations are temporarily unavailable — please try again later.');
        } else if (json.error === 'manager-required') {
          toast.error('Only the family manager can make a donation through the portal.');
        } else {
          toast.error('Could not start checkout — please try again.');
        }
        setPending(false);
        return;
      }

      if (!json.url) {
        toast.error('Could not start checkout — please try again.');
        setPending(false);
        return;
      }

      // Redirect to the Stripe-hosted checkout page. Do NOT clear pending —
      // the navigation unmounts this component.
      window.location.href = json.url;
    } catch {
      toast.error('Network error — please try again.');
      setPending(false);
    }
  }

  return (
    <div>
      {/* Amount */}
      <div style={{ padding: '22px 18px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'baseline', justifyContent: 'center', gap: 0 }}>
          <span style={{ fontFamily: 'var(--display)', fontSize: 24, color: 'var(--muted)' }}>$</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={amount === 0 ? '' : amount}
            onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
            placeholder="0"
            aria-label="Donation amount in CAD"
            style={{
              background: 'transparent', border: 0, outline: 'none', textAlign: 'center',
              fontFamily: 'var(--display)', fontSize: 54, fontWeight: 400, width: 180, color: 'var(--ink)',
            }}
          />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}> CAD</span>
        </div>

        {tiers.length > 0 && (
          <div className="row" style={{ gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {tiers.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                style={{
                  padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: v === amount ? 'var(--accent)' : 'var(--bg)',
                  color: v === amount ? '#fff' : 'var(--body-text)',
                  border: '1px solid', borderColor: v === amount ? 'var(--accent)' : 'var(--line2)',
                }}
              >
                {v === floor ? `$${v} · suggested` : `$${v}`}
              </button>
            ))}
          </div>
        )}

        {mode === 'bala-vihar' && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)', fontSize: 11, color: belowFloor ? 'var(--err)' : 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
            {belowFloor
              ? `Suggested amount is $${floor}. To give less, please contact the welcome team.`
              : <>Suggested amount: <strong style={{ color: 'var(--body-text)' }}>${floor}</strong>. You may give more.</>}
          </div>
        )}
      </div>

      {/* Cover processing fee */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)', marginBottom: 14, cursor: 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={coverFee} onChange={(e) => setCoverFee(e.target.checked)} />
        <span style={{ flex: 1 }}>
          Add {amount >= 1 ? `$${processingFeeCAD(amount).toFixed(2)}` : 'the'} processing fee so 100% of my gift reaches the Mission
        </span>
      </label>

      {/* Summary */}
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>Donation</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>${amount.toFixed(2)}</span>
        </div>
        <div className="row" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>Processing fee</span>
          <span style={{ fontSize: 14 }}>${fee.toFixed(2)}</span>
        </div>
        <div className="row" style={{ padding: '10px 0 0', borderTop: '1px solid var(--line)', marginTop: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Total today</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>${total.toFixed(2)}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
          Your official CRA tax receipt is mailed by accounting each February for the prior year — not issued here.
        </p>
      </div>

      <button
        type="button"
        className="btn btn--p btn--block"
        disabled={pending || invalid}
        onClick={handleGive}
        style={{ padding: '14px', opacity: pending || invalid ? 0.6 : 1, cursor: pending || invalid ? 'not-allowed' : 'pointer' }}
      >
        {pending ? 'Starting checkout…' : `Give $${total.toFixed(2)} →`}
      </button>
      <p style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Secured by Stripe{periodLabel ? ` · ${periodLabel}` : ''} · You can pay by credit or debit card
      </p>
    </div>
  );
}

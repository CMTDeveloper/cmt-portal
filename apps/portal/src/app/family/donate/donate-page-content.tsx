'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, SectionLabel, PayMethod } from '@/features/family/components/atoms';

type PayMethodId = 'card' | 'etransfer' | 'cheque';

export function DonatePageContent() {
  const [payMethod, setPayMethod] = useState<PayMethodId>('card');

  const amountBlock = (
    <div style={{ padding: '22px 18px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
      <div className="row" style={{ alignItems: 'baseline', justifyContent: 'center', gap: 0 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 24, color: 'var(--muted)' }}>$</span>
        <input style={{
          background: 'transparent', border: 0, outline: 'none', textAlign: 'center',
          fontFamily: 'var(--display)', fontSize: 54, fontWeight: 400, width: 160, color: 'var(--ink)',
        }} defaultValue="500"/>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}> .00 CAD</span>
      </div>
      <div className="row" style={{ gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        {[500, 750, 1000, 1500].map((v, i) => (
          <button key={i} style={{
            padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600,
            background: v === 500 ? 'var(--accent)' : 'var(--bg)',
            color: v === 500 ? '#fff' : 'var(--body-text)',
            border: '1px solid', borderColor: v === 500 ? 'var(--accent)' : 'var(--line2)',
          }}>{v === 500 ? `$${v} · suggested` : `$${v}`}</button>
        ))}
      </div>
      <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)', fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Suggested amount: <strong style={{ color: 'var(--body-text)' }}>$500</strong>. You may give more. Lowering is possible only by contacting the welcome team.
      </div>
    </div>
  );

  const whyBlock = (
    <div style={{ padding: 16, background: 'var(--accentSoft)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <Rosette size={20} color="var(--accentDeep)" stroke={1.4}/>
        <strong style={{ fontSize: 13, color: 'var(--accentDeep)' }}>Why we ask, plainly</strong>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55 }}>
        Chinmaya Mission Toronto is a registered Canadian charity. Your donation pays for the hall, materials, snacks and insurance. <strong>It is not a fee.</strong> <em className="sa">Sevaks</em> teach without pay. Giving more keeps the program healthy for next year&apos;s families.
      </p>
    </div>
  );

  const paymentMethods = (
    <>
      <SectionLabel>Payment method</SectionLabel>
      <div className="col" style={{ gap: 8 }}>
        <PayMethod
          active={payMethod === 'card'}
          label="Credit / debit card"
          sub="Visa, Mastercard, Amex · via Stripe"
          icon={<SetuIcon.card/>}
          onClick={() => setPayMethod('card')}
        />
        <PayMethod
          active={payMethod === 'etransfer'}
          label="Interac e-Transfer"
          sub="Instructions emailed after submission"
          icon={<SetuIcon.mail/>}
          onClick={() => setPayMethod('etransfer')}
        />
        <PayMethod
          active={payMethod === 'cheque'}
          label="Cheque in person"
          sub="Drop at the lobby this Sunday"
          icon={<SetuIcon.receipt/>}
          onClick={() => setPayMethod('cheque')}
        />
      </div>
    </>
  );

  const orderSummary = (
    <div style={{ marginTop: 18, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>Amount</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>$500.00</span>
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>Processing fee</span>
        <span style={{ fontSize: 14 }}>$0.00</span>
      </div>
      <div className="row" style={{ padding: '10px 0 0', borderTop: '1px solid var(--line)', marginTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Total</span>
        <span style={{ fontFamily: 'var(--display)', fontSize: 20 }}>$500.00</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <SetuIcon.receipt/> Tax receipt will be emailed to your registered email address
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family/enroll" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Donation</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 110px' }}>
              <div style={{ padding: '14px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
                Coming soon — online donate isn&apos;t live yet. In the meantime, bring a cheque on Sunday or pay via e-Transfer (donations@chinmayatoronto.org).
              </div>
              <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 6 }}>Your <em className="sa">dakshina</em></h1>
              <p style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 18, lineHeight: 1.5 }}>
                For <strong>Bala Vihar · Brampton Fall &apos;26</strong>. This is a charitable donation — you&apos;ll receive a tax receipt.
              </p>
              {amountBlock}
              {whyBlock}
              {paymentMethods}
              {orderSummary}
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.6 }}>Give $500 →</button>
              <p style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                Secured by Stripe · You&apos;ll receive a tax receipt automatically
              </p>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href="/family/enroll" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back/> Back to enrollment
          </Link>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Bala Vihar · Brampton Fall &#39;26</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Your <em className="sa">dakshina</em></h1>
          </div>
        </header>

        <div style={{ padding: '14px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
          Coming soon — online donate isn&apos;t live yet. In the meantime, bring a cheque on Sunday or pay via e-Transfer (donations@chinmayatoronto.org).
        </div>

        {/* Two-column content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
          {/* Left — amount + why */}
          <div>
            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 14 }}>Donation amount</h2>
            {amountBlock}
            {whyBlock}
          </div>

          {/* Right — payment + summary + CTA */}
          <aside>
            <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
              {paymentMethods}
              {orderSummary}
              <button className="btn btn--p btn--block" style={{ marginTop: 18, padding: '14px', cursor: 'not-allowed', opacity: 0.6 }} disabled>Give $500 →</button>
              <p style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
                Secured by Stripe · Tax receipt emailed automatically
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

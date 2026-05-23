import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel, YearTile, DesktopSidebar } from '@/features/family/components/atoms';
import { mockDonations } from '@/features/family/data/mock';

const YEAR_TOTALS = [
  { year: '2026', total: 500, count: 1 },
  { year: '2025', total: 900, count: 2 },
  { year: '2024', total: 800, count: 2 },
];

const ALL_ROWS: [string, string, string, number][] = [
  ["14 Jun 2026", "Bala Vihar · Brampton Fall '26", "Card · ••4242", 500],
  ["02 Sep 2025", "Bala Vihar · Brampton Fall '25", "e-Transfer",    450],
  ["12 Jan 2025", "Bala Vihar · Brampton Spring '25", "Card · ••4242", 450],
  ["09 Sep 2024", "Bala Vihar · Brampton Fall '24", "Cheque",         400],
  ["14 Feb 2024", "Bala Vihar · Brampton Spring '24", "e-Transfer",   400],
];

export default function DonationsPage() {
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Donation history</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 30px' }}>
              <div style={{ padding: '14px 16px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 18 }}>
                <div style={{ fontSize: 11, opacity: .85, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>2026 total</div>
                <div className="between">
                  <span style={{ fontFamily: 'var(--display)', fontSize: 36, color: '#fff' }}>$500.00</span>
                  <button className="btn" style={{ background: '#fff', color: 'var(--accentDeep)', padding: '8px 12px', fontSize: 12 }}>
                    <SetuIcon.dl/> All receipts
                  </button>
                </div>
              </div>

              {mockDonations.map((g, i) => (
                <div key={i} style={{ marginBottom: 18 }}>
                  <SectionLabel>{g.year}</SectionLabel>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    {g.items.map((it, j) => (
                      <div key={j} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderTop: j > 0 ? '1px solid var(--line)' : undefined }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{it.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{it.date} · {it.method}</div>
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--display)', fontSize: 16 }}>${it.amount}</div>
                          <button className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 11, fontWeight: 600, padding: 0, marginTop: 2 }}>
                            <SetuIcon.dl/> Receipt
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex" style={{ minHeight: '100dvh' }}>
        <CspRoot style={{ display: 'flex', width: '100%', minHeight: '100dvh' }}>
          <DesktopSidebar active="receipts"/>
          <main style={{ flex: 1, padding: '32px 48px', overflow: 'auto' }}>
            <header className="between" style={{ marginBottom: 24 }}>
              <div>
                <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Donation history</p>
                <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>Your receipts</h1>
              </div>
              <button className="btn btn--p"><SetuIcon.dl/> Download all (2026)</button>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
              {YEAR_TOTALS.map((yt, i) => (
                <YearTile key={i} year={yt.year} total={yt.total} count={yt.count} active={i === 0}/>
              ))}
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg)', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    <th style={{ textAlign: 'left', padding: '12px 18px' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '12px 18px' }}>Description</th>
                    <th style={{ textAlign: 'left', padding: '12px 18px' }}>Method</th>
                    <th style={{ textAlign: 'right', padding: '12px 18px' }}>Amount</th>
                    <th style={{ textAlign: 'right', padding: '12px 18px', width: 120 }}>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_ROWS.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '14px 18px', fontFamily: 'var(--mono)', color: 'var(--body-text)' }}>{r[0]}</td>
                      <td style={{ padding: '14px 18px', fontWeight: 500 }}>{r[1]}</td>
                      <td style={{ padding: '14px 18px', color: 'var(--body-text)' }}>{r[2]}</td>
                      <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--display)', fontSize: 16 }}>${r[3]}.00</td>
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <button className="btn btn--s" style={{ padding: '6px 10px', fontSize: 12 }}><SetuIcon.dl/> PDF</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </main>
        </CspRoot>
      </div>
    </>
  );
}

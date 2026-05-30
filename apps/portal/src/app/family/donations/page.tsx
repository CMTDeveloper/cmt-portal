import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getDonations } from '@/features/setu/donations/get-donations';
import type { DonationDoc, DonationStatus } from '@cmt/shared-domain';

export const metadata = { title: 'My donations — CMT Portal' };

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' });
}

function yearOf(d: Date): string {
  return d.toLocaleDateString('en-CA', { year: 'numeric', timeZone: 'America/Toronto' });
}

const STATUS_META: Record<DonationStatus, { label: string; bg: string; fg: string } | null> = {
  completed: { label: 'Given', bg: 'var(--ok-soft, #d6efe0)', fg: 'var(--ok, #3d7a5a)' },
  redirected: { label: 'Started', bg: 'var(--warn-soft, #f7ecd2)', fg: 'var(--warn, #a06410)' },
  abandoned: { label: 'Not completed', bg: 'var(--surface-2, #e3edf1)', fg: 'var(--muted)' },
};

function StatusBadge({ status }: { status: DonationStatus }) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  );
}

const ACCOUNTING_CALLOUT = (
  <div style={{ padding: '14px 16px', background: 'var(--info-soft, #d6e8eb)', color: 'var(--info-deep, #1f4a52)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 13, lineHeight: 1.55 }}>
    <strong>Tax receipts:</strong> your official CRA receipt is mailed by <strong>accounting@chinmayatoronto.org</strong> each February for the prior calendar year. This list is your own record of donations started through the portal — not a tax document.
  </div>
);

function groupByYear(donations: DonationDoc[]): Array<{ year: string; items: DonationDoc[]; total: number }> {
  const map = new Map<string, DonationDoc[]>();
  for (const d of donations) {
    const y = yearOf(d.createdAt);
    const arr = map.get(y) ?? [];
    arr.push(d);
    map.set(y, arr);
  }
  return [...map.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, items]) => ({
      year,
      items,
      total: items.filter((d) => d.status === 'completed').reduce((s, d) => s + d.amountCAD, 0),
    }));
}

export default async function DonationsPage() {
  await connection();

  const familyData = await getCurrentFamily();
  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const donations = await getDonations(familyData.family.fid);
  const groups = groupByYear(donations);

  const emptyState = (
    <div style={{ padding: '28px 18px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <p style={{ fontSize: 14, color: 'var(--body-text)', marginBottom: 14 }}>You haven&apos;t made a donation through the portal yet.</p>
      <Link href="/family/donate" className="btn btn--p" style={{ padding: '10px 18px', textDecoration: 'none' }}>Make a donation</Link>
    </div>
  );

  const list = groups.map((g) => (
    <div key={g.year} style={{ marginBottom: 18 }}>
      <SectionLabel>{g.year}{g.total > 0 ? ` · $${g.total} given` : ''}</SectionLabel>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {g.items.map((d, j) => (
          <div key={d.did} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderTop: j > 0 ? '1px solid var(--line)' : undefined }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(d.createdAt)}</div>
            </div>
            <StatusBadge status={d.status} />
            <div style={{ textAlign: 'right', minWidth: 64 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 16 }}>${d.amountCAD}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ));

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>My donations</span>
              <span style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 84px' }}>
              {ACCOUNTING_CALLOUT}
              {groups.length === 0 ? emptyState : list}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Giving</p>
          <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>My donations</h1>
        </header>
        {ACCOUNTING_CALLOUT}
        <div style={{ maxWidth: 640 }}>
          {groups.length === 0 ? emptyState : list}
        </div>
      </div>
    </>
  );
}

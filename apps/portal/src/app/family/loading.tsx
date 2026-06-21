// Route-level skeleton for /family. Rendered by Next during navigation/PPR so
// the dashboard shell paints instantly while the server reads resolve. This
// renders OUTSIDE CspRoot, so the wrapper carries `className="csp"` — otherwise
// the Setu brand tokens (var(--surface2) etc.) resolve to nothing.

function Shimmer({ w = '100%', h = 12, mt = 0 }: { w?: number | string; h?: number; mt?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        marginTop: mt,
        borderRadius: 6,
        background: 'var(--surface2)',
      }}
      aria-hidden
    />
  );
}

function SkeletonCard({ minHeight = 120 }: { minHeight?: number }) {
  return (
    <div className="card" style={{ padding: 24, minHeight, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: '40%', height: 14, borderRadius: 6, background: 'var(--surface2)' }} />
      <div style={{ width: '70%', height: 10, borderRadius: 6, background: 'var(--surface2)', opacity: 0.6 }} />
      <div style={{ width: '55%', height: 10, borderRadius: 6, background: 'var(--surface2)', opacity: 0.4 }} />
    </div>
  );
}

export default function FamilyDashboardLoading() {
  return (
    <div className="csp" role="status" aria-label="Loading your family dashboard">
      {/* Mobile */}
      <div className="block md:hidden" style={{ minHeight: '100dvh' }}>
        <div style={{ padding: '14px 18px 90px' }}>
          <Shimmer w={140} h={12} />
          <Shimmer w="60%" h={28} mt={10} />
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <div style={{ marginBottom: 28 }}>
          <Shimmer w={160} h={12} />
          <Shimmer w={280} h={32} mt={10} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
          <SkeletonCard minHeight={92} />
          <SkeletonCard minHeight={92} />
          <SkeletonCard minHeight={92} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <SkeletonCard minHeight={200} />
          <SkeletonCard minHeight={200} />
        </div>
      </div>
    </div>
  );
}

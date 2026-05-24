interface LoadingOmProps {
  size?: number;
  padding?: number;
}

// Animated OM mark for Suspense fallbacks + inline loading states.
// Uses a plain <img> (not next/image) so it works in vitest jsdom tests
// without a base URL. The asset is small (~7KB) — no optimization needed.
// Animation is a scoped CSS keyframe.
export function LoadingOm({ size = 64, padding = 32 }: LoadingOmProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding,
        minHeight: padding * 2 + size,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/chinmaya-om.png"
        alt="Loading"
        width={size}
        height={size}
        style={{
          animation: 'om-breathe 1.6s ease-in-out infinite',
          display: 'block',
        }}
      />
      <style>{`
        @keyframes om-breathe {
          0%, 100% { opacity: 0.55; transform: scale(0.96); }
          50%      { opacity: 1;    transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}

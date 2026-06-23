import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

/**
 * Read-only pill showing the LIVE (operational) school year, for the admin /
 * family / teacher chrome. Mounted by Task 3.
 *
 * It carries `className="csp"` on its root so the Setu brand tokens
 * (`--muted`, `--surface`, `--line`, `--radiusSm`) resolve even when the badge
 * renders outside a CspRoot — those tokens are aliased only inside the `.csp`
 * scope (see packages/ui/src/styles/setu.css). The subtle-chip idiom matches
 * the sidebars' section-header / chip styling (inline `var(--...)` tokens).
 */
export async function SchoolYearBadge({ className }: { className?: string }) {
  const year = await getLiveSchoolYearCached();
  return (
    <span
      className={`csp ${className ?? ''}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: 'var(--muted)',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
      }}
    >
      School year {year}
    </span>
  );
}

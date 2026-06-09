'use client';

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { toast } from '@cmt/ui';
import type { StaffRow, GrantableRole } from '@cmt/shared-domain';
import { ROLE_REFERENCE } from '@/lib/auth/roles-reference';
import { grantRoleClient, revokeRoleClient, listStaffClient } from './users-client';
import { RoleChip, TeacherBadge } from './role-badges';
import { RolesReferencePanel } from './roles-reference-panel';

// Maps API error codes (thrown by the client wrappers) to operator-friendly
// toast copy. Falls back to the raw code for anything unmapped.
function toastError(code: string, fallback: string) {
  const map: Record<string, string> = {
    'last-admin': 'Cannot revoke the last admin — grant another admin first.',
    'self-lockout': 'You cannot revoke your own admin role.',
    forbidden: 'You do not have permission to do that.',
    'no-session': 'Your session expired. Sign in again.',
  };
  toast.error(map[code] ?? fallback);
}

const GRANT_NOTE = 'Applies at their next sign-in.';

// In-flight key: "grant:admin" | "revoke:welcome-team" etc. Tracks which
// specific action on this row is pending so sibling buttons stay enabled.
type InFlightKey = `grant:${GrantableRole}` | `revoke:${GrantableRole}`;

interface StaffManagerProps {
  initialStaff: StaffRow[];
}

export function StaffManager({ initialStaff }: StaffManagerProps) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [roleFilter, setRoleFilter] = useState<GrantableRole | 'teacher' | null>(null);
  const [query, setQuery] = useState('');
  const [, startRefresh] = useTransition();

  function refresh() {
    startRefresh(async () => {
      try {
        const next = await listStaffClient();
        setStaff(next);
      } catch {
        // A failed refresh is non-fatal — the optimistic state already updated.
      }
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (roleFilter === 'teacher' && !s.isTeacher) return false;
      if (roleFilter && roleFilter !== 'teacher' && !s.roles.includes(roleFilter)) return false;
      if (q) {
        const hay = `${s.name} ${s.contact}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [staff, roleFilter, query]);

  return (
    <>
      {/* ── Desktop ──────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-7 items-start">
          <div className="col" style={{ gap: 22 }}>
            <section className="card" style={{ padding: 22 }}>
              <h2 style={sectionHeading}>Add staff role</h2>
              <AddStaffForm onGranted={refresh} />
            </section>
            <section className="card" style={{ padding: 22 }}>
              <h2 style={sectionHeading}>Roles reference</h2>
              <RolesReferencePanel />
            </section>
          </div>

          <section>
            <FilterBar
              roleFilter={roleFilter}
              onRoleFilter={setRoleFilter}
              query={query}
              onQuery={setQuery}
              count={filtered.length}
            />
            {filtered.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="col" style={{ gap: 10, marginTop: 14 }}>
                {filtered.map((s) => (
                  <StaffCard key={s.key} row={s} onChanged={refresh} mobile={false} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ── Mobile ───────────────────────────────────────────────── */}
      <div className="block md:hidden">
        <MobileStaff
          rows={filtered}
          roleFilter={roleFilter}
          onRoleFilter={setRoleFilter}
          query={query}
          onQuery={setQuery}
          onChanged={refresh}
        />
      </div>
    </>
  );
}

// ─── Filter bar (desktop) ──────────────────────────────────────────────────

const FILTER_CHIPS: { key: GrantableRole | 'teacher' | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'admin', label: 'Admins' },
  { key: 'welcome-team', label: 'Welcome team' },
  { key: 'teacher', label: 'Teachers' },
];

function FilterBar({
  roleFilter,
  onRoleFilter,
  query,
  onQuery,
  count,
}: {
  roleFilter: GrantableRole | 'teacher' | null;
  onRoleFilter: (r: GrantableRole | 'teacher' | null) => void;
  query: string;
  onQuery: (q: string) => void;
  count: number;
}) {
  return (
    <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
        {FILTER_CHIPS.map((c) => {
          const active = roleFilter === c.key;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onRoleFilter(c.key)}
              style={{
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--body-text)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                padding: '6px 14px',
                minHeight: 36,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--body)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <input
        className="input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search name or contact…"
        style={{ flex: '1 1 200px', minWidth: 160 }}
        aria-label="Search staff"
      />
      <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{count} shown</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        marginTop: 14,
        padding: 22,
        background: 'var(--surface)',
        border: '1px dashed var(--line2)',
        borderRadius: 'var(--radius)',
        textAlign: 'center',
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      No staff match. Adjust the filter or grant a role with the form.
    </div>
  );
}

// ─── One staff row ─────────────────────────────────────────────────────────

function StaffCard({
  row,
  onChanged,
  mobile,
}: {
  row: StaffRow;
  onChanged: () => void;
  mobile: boolean;
}) {
  // FIX #2: per-action in-flight key so only the acting button is disabled.
  const [inFlight, setInFlight] = useState<InFlightKey | null>(null);
  // FIX #5: stable id for the disclosure panel (aria-controls).
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  async function handleRevoke(role: GrantableRole) {
    if (!row.contact) {
      toast.error('No contact on record — cannot revoke.');
      return;
    }
    if (!confirm(`Revoke ${ROLE_REFERENCE[role].label} from ${row.name}?`)) return;
    const key: InFlightKey = `revoke:${role}`;
    setInFlight(key);
    try {
      await revokeRoleClient({ contact: row.contact, role });
      toast.success(`Revoked ${ROLE_REFERENCE[role].label} from ${row.name}.`);
      onChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'unknown', 'Revoke failed');
    } finally {
      setInFlight(null);
    }
  }

  async function handleGrant(role: GrantableRole) {
    if (!row.contact) {
      toast.error('No contact on record — cannot grant.');
      return;
    }
    const key: InFlightKey = `grant:${role}`;
    setInFlight(key);
    try {
      await grantRoleClient({ contact: row.contact, role });
      toast.success(`Granted ${ROLE_REFERENCE[role].label} to ${row.name}. ${GRANT_NOTE}`);
      onChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'unknown', 'Grant failed');
    } finally {
      setInFlight(null);
    }
  }

  const grantable: GrantableRole[] = ['admin', 'welcome-team'];
  // Roles present on this person, for the access expander.
  const accessRoles = [...row.roles, ...(row.isTeacher ? (['teacher'] as const) : [])];

  // FIX #3: mobile tap targets ≥ 44px; secondary actions demoted to text/ghost.
  const btnMinHeight = mobile ? 44 : 36;

  return (
    <div
      style={{
        padding: mobile ? '14px 14px' : '14px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{row.name || '(no name)'}</div>
          {/* FIX #6: use body-text (not muted) for the contact caption — improves contrast. */}
          <div
            style={{
              fontSize: 12,
              color: 'var(--body-text)',
              fontFamily: 'var(--mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.contact || '(no contact)'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {row.roles.map((r) => (
              <RoleChip key={r} role={r} />
            ))}
            {row.isTeacher && <TeacherBadge levels={row.teacherLevels} />}
            {row.roles.length === 0 && !row.isTeacher && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>No roles</span>
            )}
          </div>
        </div>
      </div>

      {/* FIX #2 + #3: primary grant/revoke pair first; secondary actions
          ("Manage as teacher", disclosure) are ghost/text-style with lower visual
          weight. Each button tracks its own inFlight key so siblings stay enabled. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {grantable.map((role) => {
          const hasRole = row.roles.includes(role);
          if (hasRole) {
            const key: InFlightKey = `revoke:${role}`;
            const busy = inFlight === key;
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleRevoke(role)}
                disabled={busy}
                style={{ ...revokeBtn, minHeight: btnMinHeight }}
              >
                {busy ? 'Revoking…' : `Revoke ${ROLE_REFERENCE[role].label.toLowerCase()}`}
              </button>
            );
          } else {
            const key: InFlightKey = `grant:${role}`;
            const busy = inFlight === key;
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleGrant(role)}
                disabled={busy}
                style={{ ...grantBtn, minHeight: btnMinHeight }}
              >
                {busy ? 'Granting…' : `Grant ${ROLE_REFERENCE[role].label.toLowerCase()}`}
              </button>
            );
          }
        })}
      </div>

      {/* FIX #3: secondary actions on their own row, visually lighter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {row.isTeacher && (
          <Link href="/admin/levels" style={{ ...textLinkBtn, minHeight: btnMinHeight }}>
            Manage as teacher →
          </Link>
        )}
        {/* FIX #5: aria-expanded + aria-controls on the disclosure toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          style={{ ...textLinkBtn, minHeight: btnMinHeight }}
        >
          {expanded ? 'Hide access ↑' : 'What can they access? ↓'}
        </button>
      </div>

      {/* FIX #5: matching id on the disclosure panel */}
      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--line)',
            }}
          >
            {accessRoles.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                No special access — derived family-role access only.
              </p>
            ) : (
              accessRoles.map((r) => (
                <div key={r} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{ROLE_REFERENCE[r].label}</div>
                  <ul
                    style={{
                      margin: '4px 0 0',
                      paddingLeft: 18,
                      fontSize: 12,
                      color: 'var(--body-text)',
                      lineHeight: 1.5,
                    }}
                  >
                    {ROLE_REFERENCE[r].grants.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add-staff form ────────────────────────────────────────────────────────

function AddStaffForm({ onGranted }: { onGranted: () => void }) {
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<GrantableRole>('welcome-team');
  const [pending, startTransition] = useTransition();
  // FIX #5: stable ids for label→input association.
  const contactId = useId();
  const roleId = useId();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = contact.trim();
    if (!trimmed) {
      toast.error('Enter an email or phone');
      return;
    }
    startTransition(async () => {
      try {
        await grantRoleClient({ contact: trimmed, role });
        toast.success(`Granted ${ROLE_REFERENCE[role].label} to ${trimmed}. ${GRANT_NOTE}`);
        setContact('');
        onGranted();
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'unknown', 'Grant failed');
      }
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field" style={{ marginBottom: 12 }}>
        {/* FIX #5: htmlFor tied to input id */}
        <label htmlFor={contactId}>Email or phone</label>
        <input
          id={contactId}
          className="input"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="person@example.com or +1…"
          disabled={pending}
          required
        />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor={roleId}>Role</label>
        <select
          id={roleId}
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as GrantableRole)}
          disabled={pending}
        >
          <option value="welcome-team">Welcome team</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button type="submit" className="btn btn--p btn--block" disabled={pending}>
        {pending ? 'Granting…' : 'Grant role →'}
      </button>
      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
        Family members are granted via their member record; CMT staff via an auth claim. Either way
        it applies at their next sign-in.
      </p>
    </form>
  );
}

// ─── Mobile layout ─────────────────────────────────────────────────────────

function MobileStaff({
  rows,
  roleFilter,
  onRoleFilter,
  query,
  onQuery,
  onChanged,
}: {
  rows: StaffRow[];
  roleFilter: GrantableRole | 'teacher' | null;
  onRoleFilter: (r: GrantableRole | 'teacher' | null) => void;
  query: string;
  onQuery: (q: string) => void;
  onChanged: () => void;
}) {
  const [sheet, setSheet] = useState<null | 'add' | 'reference'>(null);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn--p"
          style={{ flex: 1, minHeight: 44 }}
          onClick={() => setSheet('add')}
        >
          + Add staff role
        </button>
        <button
          type="button"
          className="btn btn--g"
          style={{ minHeight: 44, padding: '0 16px' }}
          onClick={() => setSheet('reference')}
        >
          Roles
        </button>
      </div>

      <input
        className="input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search name or contact…"
        aria-label="Search staff"
        style={{ minHeight: 44 }}
      />

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {FILTER_CHIPS.map((c) => {
          const active = roleFilter === c.key;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onRoleFilter(c.key)}
              style={{
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--body-text)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                padding: '0 16px',
                minHeight: 44,
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flex: '0 0 auto',
                fontFamily: 'var(--body)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {rows.map((s) => (
            <StaffCard key={s.key} row={s} onChanged={onChanged} mobile />
          ))}
        </div>
      )}

      {sheet !== null && (
        <MobileSheet
          title={sheet === 'add' ? 'Add staff role' : 'Roles reference'}
          onClose={() => setSheet(null)}
        >
          {sheet === 'add' ? (
            <AddStaffForm
              onGranted={() => {
                onChanged();
                setSheet(null);
              }}
            />
          ) : (
            <RolesReferencePanel />
          )}
        </MobileSheet>
      )}
    </div>
  );
}

function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="csp"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: '85dvh',
          overflowY: 'auto',
          // FIX #1: was var(--bg, #fff) which resolves to page-grey inside .csp.
          // var(--surface) is the correct card/sheet white in the Setu palette.
          background: 'var(--surface)',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: '18px 18px 28px',
        }}
      >
        <div className="between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              lineHeight: 1,
              color: 'var(--muted)',
              cursor: 'pointer',
              minHeight: 44,
              minWidth: 44,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────

const sectionHeading: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 14,
  textTransform: 'uppercase',
  letterSpacing: '.12em',
};

const grantBtn: React.CSSProperties = {
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: '#fff',
  padding: '8px 14px',
  minHeight: 36, // overridden per-card via btnMinHeight
  borderRadius: 'var(--radiusSm)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--body)',
};

const revokeBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--err)',
  color: 'var(--err)',
  padding: '8px 14px',
  minHeight: 36, // overridden per-card via btnMinHeight
  borderRadius: 'var(--radiusSm)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--body)',
};

// FIX #3: secondary actions use a text-link style — no border, muted colour,
// lower visual weight than the primary grant/revoke pair.
const textLinkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--muted)',
  padding: '6px 4px',
  minHeight: 36,
  borderRadius: 'var(--radiusSm)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--body)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

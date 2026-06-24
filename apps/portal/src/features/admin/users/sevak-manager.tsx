'use client';

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { SetuIcon, toast } from '@cmt/ui';
import type { SevakRow, GrantableRole } from '@cmt/shared-domain';
import { GRANTABLE_ROLES } from '@cmt/shared-domain';
import { ROLE_REFERENCE } from '@/lib/auth/roles-reference';
import { grantRoleClient, revokeRoleClient, listSevaksClient } from './users-client';
import { RoleChip, TeacherBadge } from './role-badges';
import { RolesReferencePanel } from './roles-reference-panel';

// Who's viewing — used to flag their own row with a "You" badge (and the backend
// self-lockout guard still protects against revoking your own admin).
export interface SelfIdentity {
  mid: string | null;
  uid: string | null;
  contact: string;
}

// Maps API error codes (thrown by the client wrappers) to operator-friendly
// toast copy. Falls back to the raw code for anything unmapped.
function toastError(code: string, fallback: string) {
  const map: Record<string, string> = {
    'last-admin': 'Cannot revoke the last admin — grant another admin first.',
    'self-lockout': 'You cannot revoke your own admin role.',
    forbidden: 'You do not have permission to do that.',
    'no-session': 'Your session expired. Sign in again.',
    'registered-user-required':
      'This email is not registered in the portal. Ask the sevak to register first.',
  };
  toast.error(map[code] ?? fallback);
}

const GRANT_NOTE = 'Applies at their next sign-in.';

function snapshotRoles(row: SevakRow): Record<GrantableRole, boolean> {
  return { admin: row.roles.includes('admin'), 'welcome-team': row.roles.includes('welcome-team') };
}

/** ISO → "Jun 22" (Toronto), with the year when it isn't the current one; "Never" for null. */
function lastSignInLabel(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'America/Toronto',
  });
}

const SOURCE_LABEL: Record<SevakRow['source'], string> = { family: 'Family', staff: 'Sevak' };

type SortCol = 'name' | 'source' | 'lastSignIn';
type SortDir = 'asc' | 'desc';

const FILTER_CHIPS: { key: GrantableRole | 'teacher' | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'admin', label: 'Admins' },
  { key: 'welcome-team', label: 'Welcome team' },
  { key: 'teacher', label: 'Teachers' },
];

interface SevakManagerProps {
  initialSevaks: SevakRow[];
  self: SelfIdentity;
}

export function SevakManager({ initialSevaks, self }: SevakManagerProps) {
  const [sevaks, setSevaks] = useState<SevakRow[]>(initialSevaks);
  const [roleFilter, setRoleFilter] = useState<GrantableRole | 'teacher' | null>(null);
  const [query, setQuery] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [addOpen, setAddOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  // Drawer: the open row's key + mode. Edit state (draft) lives here so a stray
  // click can never mutate a role — only an explicit Save calls grant/revoke.
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<Record<GrantableRole, boolean>>({ admin: false, 'welcome-team': false });
  const [saving, setSaving] = useState(false);
  const [, startRefresh] = useTransition();

  const refPanelId = useId();

  function isSelf(row: SevakRow): boolean {
    if (row.mid && self.mid && row.mid === self.mid) return true;
    if (row.uid && self.uid && row.uid === self.uid) return true;
    if (row.contact && self.contact && row.contact.toLowerCase() === self.contact.toLowerCase()) return true;
    return false;
  }

  function refresh() {
    startRefresh(async () => {
      try {
        setSevaks(await listSevaksClient());
      } catch {
        // A failed refresh is non-fatal — the optimistic state already updated.
      }
    });
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = sevaks.filter((s) => {
      if (roleFilter === 'teacher' && !s.isTeacher) return false;
      if (roleFilter && roleFilter !== 'teacher' && !s.roles.includes(roleFilter)) return false;
      if (q && !`${s.name} ${s.contact}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortCol === 'lastSignIn') {
        // Nulls (never signed in) always sort to the bottom regardless of dir.
        if (!a.lastSignIn && !b.lastSignIn) return a.name.localeCompare(b.name);
        if (!a.lastSignIn) return 1;
        if (!b.lastSignIn) return -1;
        return dir * a.lastSignIn.localeCompare(b.lastSignIn);
      }
      const av = sortCol === 'source' ? SOURCE_LABEL[a.source] : a.name;
      const bv = sortCol === 'source' ? SOURCE_LABEL[b.source] : b.name;
      return dir * (av.localeCompare(bv) || a.name.localeCompare(b.name));
    });
    return rows;
  }, [sevaks, roleFilter, query, sortCol, sortDir]);

  const openRow = drawerKey ? sevaks.find((s) => s.key === drawerKey) ?? null : null;

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  }
  const arrow = (col: SortCol) => (sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  function openDrawer(row: SevakRow, mode: 'view' | 'edit') {
    if (mode === 'edit' && !row.contact) {
      toast.error('No contact on record — cannot edit roles.');
      return;
    }
    setDrawerKey(row.key);
    setDrawerMode(mode);
    setDraft(snapshotRoles(row));
  }
  function closeDrawer() {
    setDrawerKey(null);
    setDrawerMode('view');
  }

  async function saveDraft() {
    if (!openRow) return;
    if (!openRow.contact) {
      toast.error('No contact on record — cannot save roles.');
      return;
    }
    const toGrant = GRANTABLE_ROLES.filter((r) => draft[r] && !openRow.roles.includes(r));
    const toRevoke = GRANTABLE_ROLES.filter((r) => !draft[r] && openRow.roles.includes(r));
    if (toGrant.length === 0 && toRevoke.length === 0) {
      setDrawerMode('view');
      return;
    }
    setSaving(true);
    try {
      // Grants then revokes, sequential — a mid-flight failure leaves a clear
      // partial state and surfaces the specific guard code (last-admin / self-lockout).
      for (const role of toGrant) await grantRoleClient({ contact: openRow.contact, role });
      for (const role of toRevoke) await revokeRoleClient({ contact: openRow.contact, role });
      toast.success(`Updated roles for ${openRow.name}. ${GRANT_NOTE}`);
      setDrawerMode('view');
      refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'unknown', 'Saving roles failed');
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="csp">
      <style>{`
        @keyframes ur-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ur-sheet { from { transform: translateY(100%) } to { transform: none } }
        @keyframes ur-slide { from { transform: translateX(100%) } to { transform: none } }
        .ur-backdrop { position: fixed; inset: 0; background: rgba(15,26,34,.4); z-index: 55; animation: ur-fade .15s ease; }
        .ur-drawer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 56; max-height: 88dvh; overflow-y: auto;
          background: var(--surface); border-top-left-radius: 18px; border-top-right-radius: 18px; animation: ur-sheet .22s ease; }
        @media (min-width: 768px) {
          .ur-drawer { top: 0; bottom: 0; right: 0; left: auto; width: min(460px, 100%); max-height: none;
            border-radius: 0; border-left: 1px solid var(--line); animation: ur-slide .22s ease; }
        }
        .ur-row { cursor: pointer; transition: background .12s ease; }
        .ur-row:hover { background: var(--surface2); }
        .ur-sorth { display: inline-flex; align-items: center; gap: 3px; background: none; border: none; padding: 0;
          cursor: pointer; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
          color: var(--muted); font-family: var(--body); }
      `}</style>

      {/* ── Desktop: toolbar + table ─────────────────────────────────────── */}
      <div className="hidden md:block">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 300 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {FILTER_CHIPS.map((c) => (
                <Chip key={c.label} active={roleFilter === c.key} label={c.label} onClick={() => setRoleFilter(c.key)} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or contact…"
                aria-label="Search sevaks"
                style={{ flex: 1, minWidth: 240, maxWidth: 520 }}
              />
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{visibleRows.length} shown</span>
            </div>
          </div>
          <button type="button" className="btn btn--p" onClick={() => setAddOpen(true)} style={{ minHeight: 42, padding: '11px 18px' }}>
            <SetuIcon.plus aria-hidden="true" /> Add sevak role
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: 'var(--surface)',
            boxShadow: 'var(--setu-elev-1, 0 1px 0 rgba(15,26,34,0.04))',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <Th><button type="button" className="ur-sorth" onClick={() => toggleSort('name')}>Name{arrow('name')}</button></Th>
                  <Th>Contact</Th>
                  <Th center width={84}>Admin</Th>
                  <Th center width={110}>Welcome team</Th>
                  <Th>Teacher</Th>
                  <Th width={96}><button type="button" className="ur-sorth" onClick={() => toggleSort('source')}>Source{arrow('source')}</button></Th>
                  <Th width={130}><button type="button" className="ur-sorth" onClick={() => toggleSort('lastSignIn')}>Last sign-in{arrow('lastSignIn')}</button></Th>
                  <Th width={108} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const mine = isSelf(row);
                  return (
                    <tr
                      key={row.key}
                      className="ur-row"
                      data-testid="sevak-row"
                      onClick={() => openDrawer(row, 'view')}
                      style={{ borderTop: '1px solid var(--line)' }}
                    >
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{row.name || '(no name)'}</span>
                          {mine && <YouTag />}
                        </div>
                      </Td>
                      <Td>
                        <span style={{ fontSize: 13, color: 'var(--body-text)', fontFamily: 'var(--mono)' }}>{row.contact || '(no contact)'}</span>
                      </Td>
                      <Td center><CheckCell on={row.roles.includes('admin')} bg="var(--accentSoft)" fg="var(--accentDeep)" /></Td>
                      <Td center><CheckCell on={row.roles.includes('welcome-team')} bg="var(--info-soft)" fg="var(--info-deep)" /></Td>
                      <Td>{row.isTeacher ? <TeacherBadge levels={row.teacherLevels} /> : <Dash />}</Td>
                      <Td><SourcePill source={row.source} /></Td>
                      <Td>
                        <span style={{ fontSize: 13, color: row.lastSignIn ? 'var(--body-text)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {lastSignInLabel(row.lastSignIn)}
                        </span>
                      </Td>
                      <Td right>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDrawer(row, 'edit');
                          }}
                          style={editRolesBtn}
                        >
                          Edit roles
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visibleRows.length === 0 && (
            <div style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No sevaks match. Adjust the filter or search.
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile: toolbar + cards ──────────────────────────────────────── */}
      <div className="block md:hidden">
        <div className="col" style={{ gap: 12 }}>
          <button type="button" className="btn btn--p" onClick={() => setAddOpen(true)} style={{ width: '100%', minHeight: 46 }}>
            <SetuIcon.plus aria-hidden="true" /> Add sevak role
          </button>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or contact…"
            aria-label="Search sevaks"
            style={{ minHeight: 46 }}
          />
          <div className="no-scrollbar" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
            {FILTER_CHIPS.map((c) => (
              <Chip key={c.label} active={roleFilter === c.key} label={c.label} onClick={() => setRoleFilter(c.key)} mobile />
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{visibleRows.length} shown</span>
        </div>

        <div className="col" style={{ gap: 10, marginTop: 14 }}>
          {visibleRows.length === 0 ? (
            <div style={{ padding: '36px 22px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--surface)', border: '1px dashed var(--line2)', borderRadius: 'var(--radius)' }}>
              No sevaks match. Adjust the filter or search.
            </div>
          ) : (
            visibleRows.map((row) => {
              const mine = isSelf(row);
              return (
                <div
                  key={row.key}
                  data-testid="sevak-card"
                  onClick={() => openDrawer(row, 'view')}
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 14, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{row.name || '(no name)'}</span>
                    {mine && <YouTag />}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--body-text)', fontFamily: 'var(--mono)', marginTop: 3, wordBreak: 'break-all' }}>
                    {row.contact || '(no contact)'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {row.roles.map((r) => <RoleChip key={r} role={r} />)}
                    {row.isTeacher && <TeacherBadge levels={row.teacherLevels} />}
                    {row.roles.length === 0 && !row.isTeacher && <span style={{ fontSize: 11, color: 'var(--muted)' }}>No roles</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {SOURCE_LABEL[row.source]} · {lastSignInLabel(row.lastSignIn)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(row, 'edit');
                      }}
                      style={{ ...editRolesBtn, minHeight: 40 }}
                    >
                      Edit roles
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Roles reference (collapsible) ────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={() => setRefOpen((v) => !v)}
          aria-expanded={refOpen}
          aria-controls={refPanelId}
          style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)', cursor: 'pointer', fontFamily: 'var(--body)' }}
        >
          {refOpen ? 'Roles reference ↑' : 'Roles reference ↓'}
        </button>
        <div id={refPanelId} hidden={!refOpen}>
          {refOpen && (
            <div className="card" style={{ padding: 22, marginTop: 12 }}>
              <RolesReferencePanel />
            </div>
          )}
        </div>
      </div>

      {/* ── Detail / edit drawer ─────────────────────────────────────────── */}
      {openRow && (
        <>
          <div className="ur-backdrop" onClick={closeDrawer} />
          <div className="ur-drawer" role="dialog" aria-modal="true" data-testid="sevak-drawer">
            <div style={{ padding: '18px 24px 30px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                    {SOURCE_LABEL[openRow.source]} · {lastSignInLabel(openRow.lastSignIn) === 'Never' ? 'never signed in' : `last seen ${lastSignInLabel(openRow.lastSignIn)}`}
                  </div>
                  <h2 style={{ fontSize: 21, fontWeight: 600, margin: 0, lineHeight: 1.2, letterSpacing: '-0.01em', wordBreak: 'break-word' }}>
                    {openRow.name || '(no name)'}
                    {isSelf(openRow) && <span style={{ marginLeft: 8 }}><YouTag /></span>}
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--body-text)', fontFamily: 'var(--mono)', marginTop: 4, wordBreak: 'break-all' }}>
                    {openRow.contact || '(no contact)'}
                  </div>
                </div>
                <button type="button" onClick={closeDrawer} aria-label="Close" style={iconBtn}>
                  <SetuIcon.x aria-hidden="true" />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {openRow.roles.map((r) => <RoleChip key={r} role={r} />)}
                {openRow.isTeacher && <TeacherBadge levels={openRow.teacherLevels} />}
                {openRow.roles.length === 0 && !openRow.isTeacher && <span style={{ fontSize: 11, color: 'var(--muted)' }}>No granted roles</span>}
              </div>

              {drawerMode === 'view' ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                    <button
                      type="button"
                      onClick={() => openDrawer(openRow, 'edit')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accentSoft)', border: '1px solid var(--accent)', color: 'var(--accentDeep)', padding: '9px 15px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--body)' }}
                    >
                      Edit roles
                    </button>
                    {openRow.isTeacher && (
                      <Link href="/admin/levels" style={{ display: 'inline-flex', alignItems: 'center', background: 'transparent', border: '1px solid var(--line)', color: 'var(--body-text)', padding: '9px 14px', borderRadius: 'var(--radiusSm)', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
                        Manage as teacher →
                      </Link>
                    )}
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 24 }}>
                    What can they access?
                  </div>
                  <AccessSections row={openRow} />
                </>
              ) : (
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>
                    Edit grantable roles
                  </div>
                  <div className="col" style={{ gap: 10 }}>
                    {GRANTABLE_ROLES.map((role) => (
                      <label
                        key={role}
                        style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: 12, border: '1px solid var(--line)', borderRadius: 11, cursor: saving ? 'default' : 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={draft[role]}
                          disabled={saving}
                          onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.checked }))}
                          style={{ width: 18, height: 18, marginTop: 1, accentColor: 'var(--accent)', flex: '0 0 auto' }}
                        />
                        <span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{ROLE_REFERENCE[role].label}</span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{ROLE_REFERENCE[role].summary}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="button" className="btn btn--p" onClick={saveDraft} disabled={saving} style={{ minHeight: 42 }}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => setDrawerMode('view')} disabled={saving} style={{ ...secondaryBtn, minHeight: 42 }}>
                      Cancel
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
                    Changes apply at the person&apos;s next sign-in.
                    {openRow.isTeacher && (
                      <> Teacher status is managed at <code>/admin/levels</code> and isn&apos;t editable here.</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Add dialog ───────────────────────────────────────────────────── */}
      {addOpen && (
        <AddDialog
          onClose={() => setAddOpen(false)}
          onGranted={() => {
            refresh();
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Access sections (drawer view mode) ──────────────────────────────────────
function AccessSections({ row }: { row: SevakRow }) {
  const accessRoles = [...row.roles, ...(row.isTeacher ? (['teacher'] as const) : [])];
  if (accessRoles.length === 0) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
        No special access — derived family-role access only.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {accessRoles.map((r) => (
        <div key={r}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{ROLE_REFERENCE[r].label}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{ROLE_REFERENCE[r].summary}</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--body-text)', lineHeight: 1.6 }}>
            {ROLE_REFERENCE[r].grants.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Add dialog ──────────────────────────────────────────────────────────────
function AddDialog({ onClose, onGranted }: { onClose: () => void; onGranted: () => void }) {
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<GrantableRole>('welcome-team');
  const [pending, startTransition] = useTransition();
  const contactId = useId();
  const roleId = useId();
  const titleId = useId();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = contact.trim();
    if (!trimmed || !trimmed.includes('@')) {
      toast.error('Enter a valid registered portal email');
      return;
    }
    const email = trimmed.toLowerCase();
    startTransition(async () => {
      try {
        await grantRoleClient({ contact: email, role });
        toast.success(`Granted ${ROLE_REFERENCE[role].label} to ${email}. ${GRANT_NOTE}`);
        setContact('');
        onGranted();
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'unknown', 'Grant failed');
      }
    });
  }

  return (
    <div className="csp" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,26,34,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(100%, 512px)', maxHeight: 'calc(100dvh - 40px)', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 24, boxShadow: '0 24px 80px rgba(15,26,34,.22)' }}
      >
        <div className="between" style={{ marginBottom: 18 }}>
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 600 }}>Add sevak role</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={iconBtn}>
            <SetuIcon.x aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor={contactId}>Registered portal email</label>
            <input id={contactId} type="email" className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="person@example.com" autoComplete="email" disabled={pending} required />
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label id={roleId}>Role</label>
            <div role="radiogroup" aria-labelledby={roleId} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {([['welcome-team', 'Welcome team'], ['admin', 'Admin']] as const).map(([value, label]) => {
                const active = role === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRole(value)}
                    disabled={pending}
                    className="focus-ring"
                    style={{ flex: 1, minHeight: 46, borderRadius: 'var(--radiusSm)', border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`, background: active ? 'var(--accentSoft)' : 'var(--surface)', color: active ? 'var(--accentDeep)' : 'var(--body-text)', fontWeight: 600, fontSize: 14, fontFamily: 'var(--body)', cursor: pending ? 'default' : 'pointer' }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="submit" className="btn btn--p btn--block" disabled={pending} style={{ minHeight: 48 }}>
            {pending ? 'Granting…' : 'Grant role →'}
          </button>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
            Use the email they already registered with in the portal. New sevaks must register before a role can be granted.
          </p>
        </form>
      </div>
    </div>
  );
}

// ── Small presentational leaves ─────────────────────────────────────────────
function Chip({ active, label, onClick, mobile = false }: { active: boolean; label: string; onClick: () => void; mobile?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--body-text)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        padding: mobile ? '0 16px' : '7px 15px',
        minHeight: mobile ? 44 : 36,
        borderRadius: 999,
        fontSize: mobile ? 13 : 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: mobile ? '0 0 auto' : undefined,
        fontFamily: 'var(--body)',
      }}
    >
      {label}
    </button>
  );
}

function Th({ children, center = false, right = false, width }: { children?: React.ReactNode; center?: boolean; right?: boolean; width?: number }) {
  return (
    <th
      style={{
        position: 'sticky',
        top: 0,
        background: 'var(--surface2)',
        textAlign: center ? 'center' : right ? 'right' : 'left',
        padding: '13px 16px',
        borderBottom: '1px solid var(--line)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        zIndex: 2,
        ...(width ? { width } : {}),
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, center = false, right = false }: { children?: React.ReactNode; center?: boolean; right?: boolean }) {
  return <td style={{ padding: '13px 16px', textAlign: center ? 'center' : right ? 'right' : 'left', verticalAlign: 'middle' }}>{children}</td>;
}

function CheckCell({ on, bg, fg }: { on: boolean; bg: string; fg: string }) {
  if (!on) return <Dash />;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: bg, color: fg }}>
      <SetuIcon.check aria-hidden="true" />
    </span>
  );
}

function Dash() {
  return <span style={{ color: 'var(--line2)' }}>–</span>;
}

function SourcePill({ source }: { source: SevakRow['source'] }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--body-text)', background: 'var(--surface2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

function YouTag() {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 5, padding: '1px 6px' }}>
      You
    </span>
  );
}

const editRolesBtn: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--body-text)',
  padding: '6px 12px',
  borderRadius: 'var(--radiusSm)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--body)',
  whiteSpace: 'nowrap',
};

const secondaryBtn: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--body-text)',
  padding: '10px 16px',
  borderRadius: 'var(--radiusSm)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--body)',
};

const iconBtn: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radiusSm)',
  background: 'var(--surface)',
  color: 'var(--muted)',
  cursor: 'pointer',
};

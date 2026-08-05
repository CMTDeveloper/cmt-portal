'use client';

import { useState } from 'react';
import { toast } from '@cmt/ui';
import { removeFamilyMember } from '../remove-member-client';

/**
 * Remove a member from a family - ADMIN ONLY, from the staff member screen.
 *
 * ── Why the office has this and the family does not ─────────────────────────
 * Vaibhav, 2026-08-04: *"remove the option to Remove from family - that should
 * not exist for families - maybe for admins but not for families. Families can
 * disable any member who are no longer valid."* The reason he gave when the
 * disable control was added on 2026-08-02 still applies: *"Not to delete as we
 * loose history."*
 *
 * So the destructive path is not gone, it has moved to the one place where the
 * person doing it is named in an audit row and is not the person whose history
 * is at stake. `deleteMember` writes that row inside the same transaction as
 * the delete, and refuses to remove a family's last manager.
 *
 * ── Why a confirm step, and why the name is in it ───────────────────────────
 * This deletes a person's attendance, their contact key and their place in the
 * family record, with no undo. The confirm quotes the name because the row this
 * sits under is one of several on a page an admin is often skimming - "are you
 * sure?" answers a question they may not have realised they were asked about
 * the wrong person.
 */
export function RemoveMemberControl({
  fid,
  mid,
  memberName,
  isManager,
}: {
  fid: string;
  mid: string;
  memberName: string;
  /** Managers get the extra warning; the server still owns the last-manager rule. */
  isManager: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const result = await removeFamilyMember(fid, mid);
    if (result.ok) {
      toast.success(`${memberName} was removed from this family.`);
      // A HARD navigation, not router.push: this member's page no longer has a
      // member, and /welcome/* reads family data through `use cache` that the
      // DELETE just invalidated. A soft push can render from the pre-delete
      // value and show the admin the person they just removed.
      window.location.assign(`/welcome/family/${fid}`);
      return;
    }
    setBusy(false);
    toast.error(
      result.reason === 'last-manager'
        ? 'This is the family’s only manager. Make someone else a manager first.'
        : result.reason === 'forbidden'
          ? 'Only an admin can remove a member from a family.'
          : result.reason === 'not-found'
            ? 'That member is already gone.'
            : 'Could not remove them. Please try again.',
    );
  }

  return (
    <div
      className="card"
      data-testid="remove-member-control"
      style={{ padding: 16, marginTop: 16, borderColor: 'var(--line)' }}
    >
      <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>Remove from family</strong>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
            Deletes {memberName} and their attendance history. Families cannot do
            this - if they only want them off class lists, ask them to untick
            “taking part” instead.
          </div>
        </div>
        {!open && (
          <button
            type="button"
            className="btn btn--g"
            style={{ fontSize: 13, whiteSpace: 'nowrap', color: 'var(--err)', borderColor: 'var(--err)' }}
            onClick={() => setOpen(true)}
          >
            Remove
          </button>
        )}
      </div>

      {open && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, margin: 0 }}>
            Remove <strong>{memberName}</strong> from this family? Their record and
            past attendance are deleted permanently. This cannot be undone.
            {isManager ? ' They are a family manager.' : ''}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--p"
              style={{ fontSize: 13, background: 'var(--err)', borderColor: 'var(--err)' }}
              disabled={busy}
              onClick={submit}
            >
              {busy ? 'Removing…' : `Yes, remove ${memberName}`}
            </button>
            <button
              type="button"
              className="btn btn--g"
              style={{ fontSize: 13 }}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import type { SevaSignupStatusType } from '@cmt/shared-domain';
import { getOpportunity, serializeOpportunity } from './get-opportunities';
import { listSignupsForOpp } from './get-signups';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

export interface RosterRow {
  signupId: string;
  fid: string;
  familyName: string;
  mid: string | null;
  memberName: string | null;
  status: SevaSignupStatusType;
  hoursAwarded: number;
  signedUpAt: string;
}

export interface RosterData {
  opportunity: ReturnType<typeof serializeOpportunity>;
  rows: RosterRow[];
}

// Confirmer-facing sort: outstanding sign-ups first so they're easy to action.
// `cancelled` rows are pre-filtered out before the sort, so the cancelled entry
// and the `?? 9` unknown-status fallback are purely defensive.
const STATUS_ORDER: Record<string, number> = { 'signed-up': 0, completed: 1, 'no-show': 2, cancelled: 3 };

export async function getOpportunityRoster(oppId: string): Promise<RosterData | null> {
  const opp = await getOpportunity(oppId);
  if (!opp) return null;

  const signups = (await listSignupsForOpp(oppId)).filter((s) => s.status !== 'cancelled');

  // Resolve each distinct family once (getFamilyByFid is 'use cache').
  const uniqueFids = [...new Set(signups.map((s) => s.fid))];
  const families = await Promise.all(uniqueFids.map((fid) => getFamilyByFid(fid)));
  const familyByFid = new Map(uniqueFids.map((fid, i) => [fid, families[i] ?? null]));

  const rows: RosterRow[] = signups
    .slice()
    .sort((a, b) => {
      const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      return s !== 0 ? s : a.signedUpAt.getTime() - b.signedUpAt.getTime();
    })
    .map((s) => {
      const fam = familyByFid.get(s.fid) ?? null;
      const member = s.mid && fam ? (fam.members.find((m) => m.mid === s.mid) ?? null) : null;
      return {
        signupId: s.signupId,
        fid: s.fid,
        familyName: fam?.family.name ?? s.fid,
        mid: s.mid,
        memberName: member ? `${member.firstName} ${member.lastName}`.trim() : null,
        status: s.status,
        hoursAwarded: s.hoursAwarded,
        signedUpAt: s.signedUpAt.toISOString(),
      };
    });

  return { opportunity: serializeOpportunity(opp), rows };
}

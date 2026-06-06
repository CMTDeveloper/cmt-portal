import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from './get-opportunities';
import { listFamilySignups, listSignupsForOpp, serializeSignup, isActiveSignup } from './get-signups';

export async function getFamilySevaView(fid: string) {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return { currentSevaYear: null, hoursPerYear, opportunities: [], mySignups: [] };
  }

  const [opps, mySignupsAll] = await Promise.all([
    listOpportunities({ sevaYear: currentSevaYear, status: 'open' }),
    listFamilySignups(fid),
  ]);

  // Active count per capacity-limited opportunity (for spots-left).
  const activeByOpp = new Map<string, number>();
  await Promise.all(
    opps
      .filter((o) => o.capacity != null)
      .map(async (o) => {
        const signups = await listSignupsForOpp(o.oppId);
        activeByOpp.set(o.oppId, signups.filter(isActiveSignup).length);
      }),
  );

  const myThisYear = mySignupsAll.filter((s) => s.sevaYear === currentSevaYear);
  const myByOpp = new Map(myThisYear.map((s) => [s.oppId, s]));

  const opportunities = opps.map((o) => {
    const mine = myByOpp.get(o.oppId);
    const spotsLeft = o.capacity != null ? Math.max(0, o.capacity - (activeByOpp.get(o.oppId) ?? 0)) : null;
    return { ...serializeOpportunity(o), mySignupStatus: mine ? mine.status : null, spotsLeft };
  });

  // A signup for an opportunity that has since been CLOSED won't be in the
  // open-only `opps` list, so its `opportunity` summary is null (the UI renders
  // a minimal row). Acceptable for Slice B; C/D can fetch closed opps.
  const oppById = new Map(opps.map((o) => [o.oppId, o]));
  const mySignups = myThisYear
    .filter((s) => s.status !== 'cancelled')
    .map((s) => {
      const opp = oppById.get(s.oppId);
      return { ...serializeSignup(s), opportunity: opp ? serializeOpportunity(opp) : null };
    });

  return { currentSevaYear, hoursPerYear, opportunities, mySignups };
}

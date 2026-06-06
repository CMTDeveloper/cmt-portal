import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from './get-opportunities';
import { listFamilySignups, listSignupsForOpp, serializeSignup, isActiveSignup } from './get-signups';

export async function getFamilySevaView(fid: string) {
  const { hoursPerYear, currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) {
    return { currentSevaYear: null, hoursPerYear, hoursEarned: 0, opportunities: [], mySignups: [] };
  }

  // openOpps drives the browse list; allOpps (incl. closed) backs the
  // my-signups join so a resolved sign-up on a since-closed opp still shows
  // its summary.
  const [openOpps, allOpps, mySignupsAll] = await Promise.all([
    listOpportunities({ sevaYear: currentSevaYear, status: 'open' }),
    listOpportunities({ sevaYear: currentSevaYear }),
    listFamilySignups(fid),
  ]);

  const activeByOpp = new Map<string, number>();
  await Promise.all(
    openOpps
      .filter((o) => o.capacity != null)
      .map(async (o) => {
        const signups = await listSignupsForOpp(o.oppId);
        activeByOpp.set(o.oppId, signups.filter(isActiveSignup).length);
      }),
  );

  const myThisYear = mySignupsAll.filter((s) => s.sevaYear === currentSevaYear);
  const myByOpp = new Map(myThisYear.map((s) => [s.oppId, s]));

  const opportunities = openOpps.map((o) => {
    const mine = myByOpp.get(o.oppId);
    const spotsLeft = o.capacity != null ? Math.max(0, o.capacity - (activeByOpp.get(o.oppId) ?? 0)) : null;
    return { ...serializeOpportunity(o), mySignupStatus: mine ? mine.status : null, spotsLeft };
  });

  const oppById = new Map(allOpps.map((o) => [o.oppId, o]));
  const mySignups = myThisYear
    .filter((s) => s.status !== 'cancelled')
    .map((s) => {
      const opp = oppById.get(s.oppId);
      return { ...serializeSignup(s), opportunity: opp ? serializeOpportunity(opp) : null };
    });

  const hoursEarned = myThisYear
    .filter((s) => s.status === 'completed')
    .reduce((sum, s) => sum + (s.hoursAwarded ?? 0), 0);

  return { currentSevaYear, hoursPerYear, hoursEarned, opportunities, mySignups };
}

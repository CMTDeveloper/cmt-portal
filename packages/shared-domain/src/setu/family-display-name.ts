// Pure display-name helper: render a family's PARENTS' names for a card title,
// instead of the messy legacy `family.name`. Shared by the welcome roster report
// and the welcome family search so the rule lives in exactly one place.

export interface ParentNameMember {
  firstName: string;
  lastName: string;
  type: string; // 'Adult' | 'Child'
  manager?: boolean;
}

/**
 * Parents' names for a family card:
 *  - adults (type === 'Adult') only, MANAGER first
 *  - all adults share a last name  -> "First1 & First2 LastName"
 *  - mixed last names              -> "First1 Last1 & First2 Last2"
 *  - one adult                     -> "First Last"
 *  - no adult (or all names blank) -> `fallback` (the stored family name)
 */
export function formatFamilyParentNames(members: ParentNameMember[], fallback: string): string {
  const adults = members
    .filter((m) => m.type === 'Adult' && (m.firstName.trim() !== '' || m.lastName.trim() !== ''))
    // Manager first; Array.prototype.sort is stable, so the rest keep their order.
    .sort((a, b) => (b.manager ? 1 : 0) - (a.manager ? 1 : 0));

  if (adults.length === 0) return fallback;

  const names = adults.map((a) => ({ first: a.firstName.trim(), last: a.lastName.trim() }));
  const firstLast = names[0]!.last;
  const allSameLast = firstLast !== '' && names.every((n) => n.last === firstLast);

  if (allSameLast) {
    const firsts = names.map((n) => n.first).filter((f) => f !== '');
    const joined = `${firsts.join(' & ')} ${firstLast}`.trim();
    return joined || fallback;
  }

  const joined = names.map((n) => `${n.first} ${n.last}`.trim()).join(' & ').trim();
  return joined || fallback;
}

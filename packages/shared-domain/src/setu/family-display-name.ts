// Pure display-name helper: render a family's PARENTS' names for a card title,
// instead of the messy legacy `family.name`. Shared by the welcome roster report
// and the welcome family search so the rule lives in exactly one place.
//
// Legacy data is messy: duplicate adult rows, inconsistent casing ("Tayl"/"tayl"),
// and garbage last names (a family "Surendra & Rovita Nawbatt" migrated into a member
// with first="Surendra", last="& Rovita"). So we dedupe, prefer clean (letters-only)
// surnames, and cap at two parents rather than trust the raw rows.

export interface ParentNameMember {
  firstName: string;
  lastName: string;
  type: string; // 'Adult' | 'Child'
  manager?: boolean;
}

type Adult = { first: string; last: string; manager: boolean };

// A "clean" name part is letters (any script) plus spaces / ' . - . Rejects the
// legacy junk like "& Rovita".
const CLEAN_NAME_RE = /^\p{L}[\p{L}\s'.-]*$/u;
const isClean = (s: string): boolean => s !== '' && CLEAN_NAME_RE.test(s);
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');

/**
 * Parents' names for a family card:
 *  - adults (type === 'Adult') only, deduped, MANAGER first, at most two
 *  - shared last name (case-insensitive) -> "First1 & First2 LastName"
 *  - mixed last names                    -> "First1 Last1 & First2 Last2"
 *  - one adult                           -> "First Last" (or just "First")
 *  - no usable adult                     -> `fallback` (the stored family name)
 */
export function formatFamilyParentNames(members: ParentNameMember[], fallback: string): string {
  const adults: Adult[] = members
    .filter((m) => m.type === 'Adult')
    .map((m) => ({ first: norm(m.firstName), last: norm(m.lastName), manager: m.manager === true }))
    .filter((a) => a.first !== '' || a.last !== '');

  if (adults.length === 0) return fallback;

  // Dedupe by lowercased first name (falling back to last name when there's no first).
  // Within a group keep the "best" row: a clean surname wins over junk, then the
  // manager, then the first seen. This collapses "Surendra '& Rovita'" +
  // "Surendra Nawbatt" -> the clean "Surendra Nawbatt", and drops exact duplicates.
  const byKey = new Map<string, Adult>();
  for (const a of adults) {
    const key = (a.first || a.last).toLowerCase();
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, a);
      continue;
    }
    const aClean = isClean(a.last);
    const curClean = isClean(cur.last);
    const better = (aClean && !curClean) || (aClean === curClean && a.manager && !cur.manager);
    if (better) byKey.set(key, a);
  }

  const uniq = [...byKey.values()]
    // Manager first; Array.prototype.sort is stable, so the rest keep their order.
    .sort((x, y) => (y.manager ? 1 : 0) - (x.manager ? 1 : 0))
    .slice(0, 2);

  const firstLast = uniq[0]!.last;
  const sharedSurname =
    firstLast !== '' && uniq.every((a) => a.last.toLowerCase() === firstLast.toLowerCase());

  if (sharedSurname) {
    const firsts = uniq.map((a) => a.first).filter((f) => f !== '');
    return `${firsts.join(' & ')} ${firstLast}`.trim() || fallback;
  }
  return uniq.map((a) => `${a.first} ${a.last}`.trim()).join(' & ').trim() || fallback;
}

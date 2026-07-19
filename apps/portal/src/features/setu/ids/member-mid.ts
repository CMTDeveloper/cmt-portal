/**
 * Allocate the next member doc id (`mid`) for a family, collision-free.
 *
 * A mid is `${fid}-${zeroPad(n)}`. The next one MUST be derived from the highest
 * existing suffix + 1, NEVER from the member count: count+1 collides with an
 * existing member as soon as the numbering has a gap (e.g. a deleted member),
 * and the callers write with `txn.set`, which SILENTLY OVERWRITES the colliding
 * doc. That is exactly how the Rana family lost a child — the wife's slot (-02)
 * had been deleted, so count+1 resolved to -04 and clobbered Harshita (-04).
 *
 * Pure/synchronous: the caller passes the existing member doc ids (already read
 * inside its transaction) so allocation stays consistent with the txn snapshot.
 */
export function nextMemberMid(fid: string, existingMids: Iterable<string>): string {
  const prefix = `${fid}-`;
  const taken = new Set<string>();
  let max = 0;
  for (const id of existingMids) {
    taken.add(id);
    if (!id.startsWith(prefix)) continue; // foreign id — ignore
    const n = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  // max+1 is always free for well-formed numeric suffixes; the loop is a
  // belt-and-suspenders guard so a malformed existing id can never be overwritten.
  let n = max + 1;
  let candidate = `${fid}-${zeroPad(n)}`;
  while (taken.has(candidate)) candidate = `${fid}-${zeroPad(++n)}`;
  return candidate;
}

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

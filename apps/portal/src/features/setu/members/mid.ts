/** Derive the fid from a mid (`${fid}-NN`). */
export function fidFromMid(mid: string): string {
  const i = mid.lastIndexOf('-');
  return i > 0 ? mid.slice(0, i) : mid;
}

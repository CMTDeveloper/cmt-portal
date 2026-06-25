/** User-facing Family ID: the 4-digit publicFid when assigned, else the legacy CMT- fid. */
export function displayFid(f: { publicFid?: string | null | undefined; fid: string }): string {
  return f.publicFid ?? f.fid;
}

/** User-facing Member ID: the 5-digit publicMid when assigned, else the legacy ${fid}-NN mid. */
export function displayMid(m: { publicMid?: string | null | undefined; mid: string }): string {
  return m.publicMid ?? m.mid;
}

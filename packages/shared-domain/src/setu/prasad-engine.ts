import type { PrasadAssignmentDoc } from './prasad';

export interface PrasadEngineChild {
  mid: string;
  name: string;
  /** Ladder index (JK=0, SK=1, Grade n = n+1) or null when grade is unknown. */
  gradeRung: number | null;
  birthMonth: number | null; // 1-12
}

export interface PrasadEngineFamily {
  fid: string;
  familyName: string;
  children: PrasadEngineChild[];
  /** Already-assigned (any source) → kept verbatim, seat consumed. */
  existing: { date: string } | null;
}

export interface PrasadEngineInput {
  pid: string;
  location: string;
  cap: number;
  /** Eligible class Sundays (kind=class, enabled, prasadNeeded, future-only) — caller filters. */
  sundays: Array<{ date: string }>;
  families: PrasadEngineFamily[];
}

export type PrasadProposalRow = Pick<
  PrasadAssignmentDoc,
  'fid' | 'familyName' | 'location' | 'date' | 'youngestMid' | 'youngestName' | 'birthMonth' | 'reason'
>;

export interface PrasadProposal {
  pid: string;
  cap: number;
  rows: PrasadProposalRow[];                       // NEW proposals only (existing excluded)
  unplaced: Array<{ fid: string; familyName: string }>;
  perSunday: Array<{ date: string; count: number }>; // existing + proposed
  stats: {
    families: number;
    keptExisting: number;
    birthdayMonth: number;
    spill: number;
    noBirthMonth: number;
    unplaced: number;
  };
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}
const monthOf = (ymd: string): number => Number(ymd.slice(5, 7));

/** Youngest = lowest gradeRung (null rungs sort last); tie → lower mid. */
function pickTarget(children: PrasadEngineChild[]): { youngest: PrasadEngineChild | null; birthMonth: number | null; carrier: PrasadEngineChild | null } {
  const sorted = [...children].sort((a, b) => {
    const ra = a.gradeRung ?? Number.MAX_SAFE_INTEGER;
    const rb = b.gradeRung ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || a.mid.localeCompare(b.mid);
  });
  const youngest = sorted[0] ?? null;
  const carrier = sorted.find((c) => c.birthMonth != null) ?? null;
  return { youngest, birthMonth: carrier?.birthMonth ?? null, carrier };
}

export function proposePrasadAssignments(input: PrasadEngineInput): PrasadProposal {
  // seats[date] = remaining capacity. Existing assignments consume seats first
  // (even if their date is no longer in `sundays`, they are kept — just not counted
  // against a seat map entry that doesn't exist).
  const seats = new Map<string, number>(input.sundays.map((s) => [s.date, input.cap]));
  const counts = new Map<string, number>(input.sundays.map((s) => [s.date, 0]));
  let keptExisting = 0;

  for (const f of input.families) {
    if (f.existing) {
      keptExisting++;
      if (seats.has(f.existing.date)) {
        seats.set(f.existing.date, Math.max(0, seats.get(f.existing.date)! - 1));
        counts.set(f.existing.date, (counts.get(f.existing.date) ?? 0) + 1);
      }
    }
  }

  const ordered = (dates: string[]): string[] =>
    [...dates].sort((a, b) => (seats.get(b)! - seats.get(a)!) || dayNumber(a) - dayNumber(b));

  const take = (date: string): void => {
    seats.set(date, seats.get(date)! - 1);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  };

  const allDates = input.sundays.map((s) => s.date);
  const rows: PrasadProposalRow[] = [];
  const unplaced: Array<{ fid: string; familyName: string }> = [];
  const stats = { birthdayMonth: 0, spill: 0, noBirthMonth: 0 };

  const unassigned = input.families.filter((f) => !f.existing);
  const withMonth = unassigned
    .map((f) => ({ f, t: pickTarget(f.children) }))
    .filter((x) => x.t.birthMonth != null)
    .sort((a, b) => a.f.fid.localeCompare(b.f.fid));
  const withoutMonth = unassigned
    .map((f) => ({ f, t: pickTarget(f.children) }))
    .filter((x) => x.t.birthMonth == null)
    .sort((a, b) => a.f.fid.localeCompare(b.f.fid));

  const place = (
    f: PrasadEngineFamily,
    t: ReturnType<typeof pickTarget>,
    date: string | undefined,
    reason: PrasadProposalRow['reason'],
  ): void => {
    if (!date) {
      unplaced.push({ fid: f.fid, familyName: f.familyName });
      return;
    }
    take(date);
    if (reason === 'birthday-month') stats.birthdayMonth++;
    else if (reason === 'spill') stats.spill++;
    else stats.noBirthMonth++;
    rows.push({
      fid: f.fid,
      familyName: f.familyName,
      location: input.location,
      date,
      youngestMid: t.youngest?.mid ?? null,
      youngestName: t.youngest?.name ?? null,
      birthMonth: t.birthMonth,
      reason,
    });
  };

  // Pass 1 — birthday-month families.
  for (const { f, t } of withMonth) {
    const inMonth = ordered(allDates.filter((d) => monthOf(d) === t.birthMonth && seats.get(d)! > 0));
    if (inMonth.length > 0) {
      place(f, t, inMonth[0], 'birthday-month');
      continue;
    }
    // Spill: nearest open Sunday to the target month. Anchor = the first
    // in-month Sunday if the month exists on the calendar (it's just full),
    // else the 15th of the birth month in the season's median year.
    const anchor = (() => {
      const inMonthAll = allDates.filter((d) => monthOf(d) === t.birthMonth);
      if (inMonthAll.length > 0) return dayNumber(inMonthAll[0]!);
      const median = allDates[Math.floor(allDates.length / 2)]!;
      const year = Number(median.slice(0, 4));
      return Date.UTC(year, t.birthMonth! - 1, 15) / 86_400_000;
    })();
    const candidates = allDates
      .filter((d) => seats.get(d)! > 0)
      .sort((a, b) => {
        const da = Math.abs(dayNumber(a) - anchor);
        const db = Math.abs(dayNumber(b) - anchor);
        return da - db || dayNumber(a) - dayNumber(b);
      });
    place(f, t, candidates[0], 'spill');
  }

  // Pass 2 — no-birth-month families → emptiest Sundays.
  for (const { f, t } of withoutMonth) {
    const open = ordered(allDates.filter((d) => seats.get(d)! > 0));
    place(f, t, open[0], 'no-birth-month');
  }

  return {
    pid: input.pid,
    cap: input.cap,
    rows,
    unplaced,
    perSunday: allDates.map((date) => ({ date, count: counts.get(date) ?? 0 })),
    stats: {
      families: input.families.length,
      keptExisting,
      ...stats,
      unplaced: unplaced.length,
    },
  };
}

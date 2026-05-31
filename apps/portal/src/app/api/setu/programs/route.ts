import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { listPrograms } from '@/features/setu/programs/get-programs';
import { getOpenOfferings } from '@/features/setu/enrollment/get-open-offerings';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import type { OfferingDoc } from '@cmt/shared-domain';

function serializeOffering(o: OfferingDoc) {
  return {
    ...o,
    startDate: o.startDate.toISOString(),
    endDate: o.endDate != null ? o.endDate.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/**
 * GET /api/setu/programs
 *
 * Returns active programs that have ≥1 open offering for the caller's family
 * location, each with its open offerings. Intended as the family-facing
 * eligible-programs list (also readable by welcome-team).
 *
 * Both web cookie and Bearer ID token are supported via readSessionFromHeaders.
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  // Resolve the caller's location from the family doc (when available).
  // Welcome-team sessions have no fid; they see all programs regardless of location.
  let familyLocation: string | null = null;
  if (isSetuFamily(session) && session.fid) {
    const familyData = await getFamilyByFid(session.fid);
    familyLocation = familyData?.family.location ?? null;
  }

  const allPrograms = await listPrograms();
  const activePrograms = allPrograms.filter((p) => p.status === 'active');

  const results: Array<{
    programKey: string;
    label: string;
    shortDescription: string;
    termType: string;
    eligibility: unknown;
    capabilities: unknown;
    openOfferings: ReturnType<typeof serializeOffering>[];
  }> = [];

  for (const program of activePrograms) {
    const openOfferings = await getOpenOfferings({
      programKey: program.programKey,
      location: familyLocation as Parameters<typeof getOpenOfferings>[0]['location'],
    });

    if (openOfferings.length === 0) continue;

    results.push({
      programKey: program.programKey,
      label: program.label,
      shortDescription: program.shortDescription,
      termType: program.termType,
      eligibility: program.eligibility,
      capabilities: program.capabilities,
      openOfferings: openOfferings.map(serializeOffering),
    });
  }

  return NextResponse.json({ programs: results });
}

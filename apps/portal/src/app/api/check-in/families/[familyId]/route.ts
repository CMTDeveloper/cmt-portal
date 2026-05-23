import { NextResponse } from 'next/server';
import { findFamilyById } from '@/features/check-in/shared';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const { familyId } = await params;
  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }
  return NextResponse.json(family, { status: 200 });
}

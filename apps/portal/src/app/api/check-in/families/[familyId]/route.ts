import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { findFamilyById } from '@/features/check-in/shared';


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  if (!flags.checkInKiosk) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  const { familyId } = await params;
  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }
  return NextResponse.json(family, { status: 200 });
}

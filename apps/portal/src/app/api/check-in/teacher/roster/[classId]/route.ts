import { NextResponse } from 'next/server';
import { getRosterForClass } from '@/features/check-in/shared';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const roster = await getRosterForClass(classId);
  if (!roster) {
    return NextResponse.json({ error: 'class-not-found' }, { status: 404 });
  }
  return NextResponse.json(roster, { status: 200 });
}

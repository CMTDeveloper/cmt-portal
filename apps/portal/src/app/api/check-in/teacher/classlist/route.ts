import { NextResponse } from 'next/server';
import { listClasses } from '@/features/check-in/shared';
import type { TeacherClassListResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const classes = await listClasses();
  const body: TeacherClassListResponse = { classes };
  return NextResponse.json(body, { status: 200 });
}

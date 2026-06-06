import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isWelcomeTeam, CreateSevaOpportunitySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities, serializeOpportunity } from '@/features/setu/seva/get-opportunities';

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const sevaYear = searchParams.get('sevaYear') ?? undefined;
  const opportunities = (await listOpportunities(sevaYear ? { sevaYear } : undefined)).map(serializeOpportunity);
  return NextResponse.json({ opportunities });
}

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = CreateSevaOpportunitySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const { currentSevaYear } = await getSevaRequirement();
  if (!currentSevaYear) return NextResponse.json({ error: 'seva-year-not-set' }, { status: 400 });

  const db = portalFirestore();
  const oppId = randomUUID();
  const now = FieldValue.serverTimestamp();
  await db.collection('seva_opportunities').doc(oppId).set({
    oppId, title: parsed.data.title, description: parsed.data.description,
    date: new Date(parsed.data.date), location: parsed.data.location,
    defaultHours: parsed.data.defaultHours, capacity: parsed.data.capacity,
    sevaYear: currentSevaYear, status: 'open',
    createdAt: now, createdBy: session.uid, updatedAt: now, updatedBy: session.uid,
  });
  revalidateTag('seva-opportunities', 'max');
  return NextResponse.json({ oppId }, { status: 201 });
}

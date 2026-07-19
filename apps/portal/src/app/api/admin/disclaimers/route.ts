import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getDisclaimersConfig, setDisclaimersConfig } from '@/features/setu/disclaimers/config';

// Write-time validation: non-empty id/title/body (the read schema deliberately
// does NOT enforce this). 1..8 sections is a sane bound for the editor. intro and
// acknowledgement are optional (default '') — trimmed, generously bounded.
const PutSchema = z.object({
  intro: z.string().trim().max(4000).optional().default(''),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(8),
  acknowledgement: z.string().trim().max(4000).optional().default(''),
});

/** GET /api/admin/disclaimers — current editable content (admin only). */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const config = await getDisclaimersConfig(portalFirestore());
  return NextResponse.json(
    { version: config.version, intro: config.intro, sections: config.sections, acknowledgement: config.acknowledgement },
    { status: 200 },
  );
}

/** PUT /api/admin/disclaimers — publish edited content; bumps the version when
 *  content changed (⇒ all families re-accept on next visit). Admin only. */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // actorMid: prefer the admin's mid; fall back to uid so the audit field is set.
  const actor = session.mid ?? session.uid ?? 'admin';
  const { intro, sections, acknowledgement } = parsed.data;
  const config = await setDisclaimersConfig(portalFirestore(), { intro, sections, acknowledgement }, actor);
  return NextResponse.json({ version: config.version }, { status: 200 });
}

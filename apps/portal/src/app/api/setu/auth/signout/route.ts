import { NextResponse } from 'next/server';

// Mobile clients pass ?mode=mobile (or { mode: 'mobile' } in body) to get
// a JSON acknowledgement instead of a 303 redirect. They drop the local
// Firebase ID token client-side; the server-side state to clear is just
// the cookie (web).

export async function POST(req: Request) {
  const url = new URL(req.url);
  let mode = url.searchParams.get('mode') ?? '';
  if (!mode) {
    const body = (await req.json().catch(() => null)) as { mode?: string } | null;
    if (body && typeof body.mode === 'string') mode = body.mode;
  }

  if (mode === 'mobile') {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const res = NextResponse.redirect(new URL('/', req.url), { status: 303 });
  res.cookies.set('__session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

import { NextResponse } from 'next/server';


export async function POST(req: Request) {
  // 303 See Other so HTML <form method="post"> submits land on /login via GET.
  // Mobile clients can treat this as a success signal (just discard their
  // locally-held Firebase ID token); they don't need to follow the redirect.
  const res = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  res.cookies.set('__session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

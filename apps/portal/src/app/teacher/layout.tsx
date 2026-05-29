import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isTeacher, type WithRole } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { LoadingOm } from '@/components/chrome/loading-om';

// Defensive re-verify (middleware also gates /teacher → isTeacher). isTeacher
// passes a teacher-only role, a parent with extraRoles=['teacher'], and admin
// (inherits). No strict role equality.
async function TeacherGate({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  let allowed = false;
  if (sessionCookie) {
    const raw = await verifyPortalSessionCookie(sessionCookie);
    if (raw && isTeacher(raw as unknown as WithRole)) allowed = true;
  }

  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 48px' }}>
        {allowed ? (
          children
        ) : (
          <p style={{ color: 'var(--err)', fontSize: 14, padding: 32 }}>
            Access denied. Teacher role required.
          </p>
        )}
      </main>
    </CspRoot>
  );
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingOm />}>
      <TeacherGate>{children}</TeacherGate>
    </Suspense>
  );
}

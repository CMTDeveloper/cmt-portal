import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { DisclaimersEditor } from '@/features/admin/disclaimers/disclaimers-editor';

export const metadata = { title: 'Disclaimers' };

export default async function AdminDisclaimersPage() {
  await connection();
  const config = await getDisclaimersConfig(portalFirestore());

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Admin</p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Disclaimers</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          The family agreement sections shown when a family signs in. Edit the text below and publish.
          Publishing asks every family to re-accept on their next visit; a new school year also re-prompts.
        </p>
      </header>

      <div style={{ maxWidth: 640 }}>
        <DisclaimersEditor initialSections={config.sections} initialVersion={config.version} />
      </div>
    </>
  );
}

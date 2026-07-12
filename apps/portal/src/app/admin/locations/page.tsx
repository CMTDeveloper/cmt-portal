import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { getLocationOptions } from '@/lib/locations';
import { LocationsEditor } from '@/features/admin/locations/locations-editor';

export const metadata = { title: 'Locations' };

export default async function AdminLocationsPage() {
  await connection();

  const options = await getLocationOptions();

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}
        >
          <SetuIcon.back /> Back to admin
        </Link>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          Admin
        </p>
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Locations</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          The centres families choose from at registration, and that programs, levels, and the class calendar are
          organized by. A centre can be removed only once no family, offering, level, or enrollment references it.
        </p>
      </header>

      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)', maxWidth: 640 }}>
        <LocationsEditor initialOptions={options} />
      </div>
    </>
  );
}

import { connection } from 'next/server';
import Link from 'next/link';
import { SetuIcon } from '@cmt/ui';
import { getVolunteeringSkillOptions } from '@/lib/volunteering-skills';
import { SkillsEditor } from '@/features/admin/volunteering-skills/skills-editor';

export const metadata = { title: 'Volunteering skills' };

export default async function AdminVolunteeringSkillsPage() {
  await connection();

  const options = await getVolunteeringSkillOptions();

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
        <h1 style={{ fontSize: 'clamp(28px, 7vw, 38px)', fontWeight: 400, marginTop: 6, lineHeight: 1.1 }}>Volunteering skills</h1>
        <p style={{ fontSize: 14, color: 'var(--body-text)', marginTop: 10, maxWidth: 640, lineHeight: 1.55 }}>
          The list families choose from when recording an adult member&apos;s volunteering skills.
          Add or remove options below — changes apply the next time a family opens the member form.
          Existing skills a member already has are kept even if you remove them from this list.
        </p>
      </header>

      <div className="card" style={{ padding: 'clamp(14px, 4vw, 22px)', maxWidth: 640 }}>
        <SkillsEditor initialOptions={options} />
      </div>
    </>
  );
}

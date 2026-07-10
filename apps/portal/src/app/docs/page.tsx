import Link from 'next/link';
import { DOC_CATEGORIES, visibleGuides, type DocGuide } from '@/features/docs/registry';
import { getDocsViewer } from '@/features/docs/viewer';

export const metadata = { title: 'Guides · Chinmaya Setu' };

const AUDIENCE_LABELS: Record<DocGuide['audience'][number], string> = {
  admin: 'Admin',
  'welcome-team': 'Welcome team',
  teacher: 'Teachers',
};

function GuideCard({ guide }: { guide: DocGuide }) {
  return (
    <Link
      href={`/docs/${guide.slug}`}
      data-testid={`doc-card-${guide.slug}`}
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: '18px 20px',
        textDecoration: 'none',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>{guide.title}</h3>
      <p style={{ margin: '8px 0 12px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--muted)' }}>
        {guide.description}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {guide.audience.map((a) => (
          <span
            key={a}
            style={{
              fontSize: 11,
              color: 'var(--accentDeep)',
              background: 'var(--accentSoft)',
              borderRadius: 999,
              padding: '2px 9px',
              fontWeight: 550,
            }}
          >
            {AUDIENCE_LABELS[a]}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default async function DocsIndexPage() {
  const viewer = await getDocsViewer();
  if (!viewer) return null; // layout renders the access-denied state

  const guides = visibleGuides(viewer);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 26, color: 'var(--ink)' }}>Portal guides</h1>
      <p style={{ margin: '10px 0 28px', fontSize: 14.5, lineHeight: 1.6, color: 'var(--muted)', maxWidth: 620 }}>
        Step-by-step documentation for running the portal — written for the team, verified against
        the code. You see the guides that apply to your role.
      </p>
      {DOC_CATEGORIES.map((category) => {
        const inCategory = guides.filter((g) => g.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} style={{ marginBottom: 32 }}>
            <h2
              style={{
                margin: '0 0 12px',
                fontSize: 13,
                fontWeight: 650,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
              }}
            >
              {category}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 14,
              }}
            >
              {inCategory.map((g) => (
                <GuideCard key={g.slug} guide={g} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

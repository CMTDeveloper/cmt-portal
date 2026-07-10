import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canViewGuide, findGuide } from '@/features/docs/registry';
import { readGuideMarkdown } from '@/features/docs/read-guide';
import { renderGuideHtml } from '@/features/docs/render-markdown';
import { getDocsViewer } from '@/features/docs/viewer';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = findGuide(slug);
  return { title: guide ? `${guide.title} · Chinmaya Setu guides` : 'Guides · Chinmaya Setu' };
}

export default async function DocGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  const viewer = await getDocsViewer();
  if (!viewer) return null; // layout renders the access-denied state
  // A guide outside the viewer's audience is indistinguishable from a
  // missing one — no oracle for what other roles' docs exist.
  if (!canViewGuide(viewer, guide)) notFound();

  const markdown = await readGuideMarkdown(guide.file);
  if (markdown === null) notFound();

  const html = await renderGuideHtml(markdown);

  return (
    <div>
      <nav style={{ marginBottom: 18 }}>
        <Link
          href="/docs"
          style={{ fontSize: 13, color: 'var(--accentDeep)', textDecoration: 'none', fontWeight: 550 }}
        >
          ← All guides
        </Link>
      </nav>
      <article
        className="docs-prose"
        data-testid="doc-article"
        // Trusted repo-authored markdown (see render-markdown.ts) — never user input.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

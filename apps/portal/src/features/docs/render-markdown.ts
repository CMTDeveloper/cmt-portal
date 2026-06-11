import { Marked } from 'marked';
import { DOC_GUIDES } from './registry';

// Server-side markdown → HTML for the /docs reader. The source is our own
// repo's runbooks (trusted content reviewed in PRs), so the rendered HTML is
// injected without sanitization — do NOT point this at user-supplied input.

const marked = new Marked({ gfm: true, breaks: false });

const FILE_TO_SLUG = new Map(DOC_GUIDES.map((g) => [g.file, g.slug]));

// Guides cross-reference each other as plain markdown links to sibling files,
// e.g. [the rollover guide](school-year-rollover-guide.md). Rewrite those to
// portal routes BEFORE parsing (string-level — immune to marked renderer API
// churn). Files not in the registry (e.g. the cutover checklist) are left
// untouched and will render as dead relative links — the registry test keeps
// the in-registry set complete.
function rewriteGuideLinks(markdown: string): string {
  return markdown.replace(
    /\]\((?:\.\/)?([A-Za-z0-9_-]+\.md)(#[^)\s]*)?(\s+"[^"]*")?\)/g,
    (match, file: string, anchor: string | undefined, title: string | undefined) => {
      const slug = FILE_TO_SLUG.get(file);
      return slug ? `](/docs/${slug}${anchor ?? ''}${title ?? ''})` : match;
    },
  );
}

export async function renderGuideHtml(markdown: string): Promise<string> {
  return marked.parse(rewriteGuideLinks(markdown));
}

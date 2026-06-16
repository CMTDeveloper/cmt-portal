import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { DOC_GUIDES } from './registry';

// Server-side markdown → HTML for the /docs reader. The source is our own
// repo's runbooks, but the rendered HTML is injected via
// dangerouslySetInnerHTML, so we sanitize as defense-in-depth: a future
// runbook edit with raw <script>, an inline event handler, or a
// javascript:/data: link must not become stored XSS for staff.

const marked = new Marked({ gfm: true, breaks: false });

// Allowlist: the markdown prose + GFM tables our guides use. Raw HTML tags
// not listed here are stripped; only http/https/mailto + relative/anchor
// hrefs survive (javascript:/data: are dropped).
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'br',
    'strong', 'em', 'code', 'pre', 'span',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Allow relative + same-page-anchor hrefs (our /docs/{slug} cross-links).
  allowProtocolRelative: false,
};

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
  const html = await marked.parse(rewriteGuideLinks(markdown));
  return sanitizeHtml(html, SANITIZE_OPTS);
}

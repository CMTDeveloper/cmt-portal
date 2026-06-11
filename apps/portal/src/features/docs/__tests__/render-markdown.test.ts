import { describe, it, expect } from 'vitest';
import { renderGuideHtml } from '../render-markdown';

describe('renderGuideHtml', () => {
  it('renders headings, lists, and GFM tables', async () => {
    const html = await renderGuideHtml(
      '# Title\n\nSome **bold** text.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('rewrites cross-guide .md links to /docs/{slug} routes (anchors kept)', async () => {
    const html = await renderGuideHtml(
      'See [the rollover guide](school-year-rollover-guide.md) and [prasad](./prasad-module-guide.md#stage-1).',
    );
    expect(html).toContain('href="/docs/rollover"');
    expect(html).toContain('href="/docs/prasad#stage-1"');
    expect(html).not.toContain('school-year-rollover-guide.md');
  });

  it('rewrites links that carry a markdown title', async () => {
    const html = await renderGuideHtml('[seva](seva-module-guide.md "Seva guide")');
    expect(html).toContain('href="/docs/seva"');
    expect(html).toContain('title="Seva guide"');
  });

  it('leaves external links and non-registry .md links untouched', async () => {
    const html = await renderGuideHtml(
      '[ext](https://example.com/page) and [ops](production-cutover-checklist.md)',
    );
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('href="production-cutover-checklist.md"');
  });

  it('keeps filename mentions in backticks as inline code, not links', async () => {
    const html = await renderGuideHtml('See `school-year-rollover-guide.md` for details.');
    expect(html).toContain('<code>school-year-rollover-guide.md</code>');
    expect(html).not.toContain('href="/docs/rollover"');
  });
});

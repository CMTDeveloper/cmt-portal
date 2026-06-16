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

  // Defense-in-depth: the source is repo-authored, but the output is injected
  // via dangerouslySetInnerHTML, so a future runbook with raw HTML / dangerous
  // links must be neutralized.
  it('strips a raw <script> tag from a runbook', async () => {
    const html = await renderGuideHtml('Hi\n\n<script>alert(1)</script>\n\nbye');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('drops a javascript: link href (keeps the text)', async () => {
    const html = await renderGuideHtml('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('strips an inline event-handler attribute', async () => {
    const html = await renderGuideHtml('<p onclick="alert(1)">hi</p>');
    expect(html).not.toContain('onclick');
  });

  it('keeps safe prose, links, and tables intact after sanitizing', async () => {
    const html = await renderGuideHtml(
      '# Title\n\n[ok](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
});

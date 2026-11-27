import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, renderMarkdown, renderPlain } from '../../src/ts/markdown';

describe('renderMarkdown', () => {
  it('renders Markdown to HTML', () => {
    expect(renderMarkdown('## Kop\n\n*nadruk*')).toBe('<h2>Kop</h2>\n<p><em>nadruk</em></p>\n');
  });

  it('removes scripts, event handlers and unsafe links', () => {
    const html = renderMarkdown(
      '<img src="x.png" onerror="alert(1)"><script>alert(2)</script>[a](javascript:alert(3)) [b](https://example.org/)',
    );
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.org/"');
    expect(html).toContain(`src="${window.location.origin}/x.png"`);
  });

  it('drops an image source that is not http(s)', () => {
    expect(renderMarkdown('![x](data:image/png;base64,AAAA)')).not.toContain('src=');
  });
});

describe('looksLikeMarkdown', () => {
  it.each([
    ['a heading of two or more hashes', 'Tekst\n## Kop'],
    ['a table', '| a | b |\n| --- | :-: |\n| 1 | 2 |'],
    ['bold', 'een **vet** woord'],
    ['italic', 'een *schuin* woord'],
    ['strikethrough', 'een ~~weg~~ woord'],
  ])('recognises %s', (_name, src) => {
    expect(looksLikeMarkdown(src)).toBe(true);
  });

  it.each([
    ['plain text', 'Gewone tekst.\nMet regels.'],
    ['a single-hash comment', '# acties'],
    ['a lone asterisk', '5 * 3 = 15'],
    ['a horizontal rule after a line without a pipe', 'tekst\n---'],
    ['a pipe without a delimiter row', 'a | b\nc | d'],
  ])('does not mistake %s for Markdown', (_name, src) => {
    expect(looksLikeMarkdown(src)).toBe(false);
  });
});

describe('renderPlain', () => {
  it('escapes the text and keeps paragraphs and line breaks', () => {
    expect(renderPlain('a <b>\nc\n\nd')).toBe(
      '<p style="margin:0 0 .8em;white-space:pre-wrap">a &lt;b&gt;<br>c</p>' +
        '<p style="margin:0 0 .8em;white-space:pre-wrap">d</p>',
    );
  });

  it('keeps Meilisearch highlighting when asked', () => {
    expect(renderPlain('<em>hit</em> <b>', true)).toContain('<em>hit</em> &lt;b&gt;');
    expect(renderPlain('<em>hit</em>')).toContain('&lt;em&gt;hit&lt;/em&gt;');
  });
});

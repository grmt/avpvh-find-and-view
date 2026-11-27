import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  highlightHtml,
  quoteFilter,
  safeLocalOcrUrl,
  safeUrl,
  urlAttribute,
} from '../../src/ts/escape';

describe('escapeHtml', () => {
  it('escapes the five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });

  it('turns null and undefined into an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(false)).toBe('false');
  });
});

describe('highlightHtml', () => {
  it('keeps bare em tags and escapes everything else', () => {
    expect(highlightHtml('<em>hit</em> <b>x</b>')).toBe('<em>hit</em> &lt;b&gt;x&lt;/b&gt;');
  });

  it('does not let attributes through on em tags', () => {
    expect(highlightHtml('<em onclick="x">a</em>')).toBe('&lt;em onclick=&quot;x&quot;&gt;a</em>');
    expect(highlightHtml('<em onclick="x">a</em>')).not.toContain('<em ');
  });
});

describe('safeUrl', () => {
  it('accepts http and https, absolute or relative', () => {
    expect(safeUrl('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(safeUrl('/wp-content/x.pdf')).toBe(`${window.location.origin}/wp-content/x.pdf`);
  });

  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x'])(
    'rejects %s',
    (url) => {
      expect(safeUrl(url)).toBe('');
    },
  );

  it('rejects non-strings and blanks', () => {
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl(42)).toBe('');
    expect(safeUrl('   ')).toBe('');
  });

  it('rejects what URL cannot parse', () => {
    expect(safeUrl('http://[')).toBe('');
  });
});

describe('urlAttribute', () => {
  it('escapes a safe URL for an attribute', () => {
    expect(urlAttribute('https://example.org/?a=1&b="2"')).toBe(
      'https://example.org/?a=1&amp;b=%222%22',
    );
  });

  it('returns an empty string for an unsafe URL', () => {
    expect(urlAttribute('javascript:alert(1)')).toBe('');
  });
});

describe('quoteFilter', () => {
  it('quotes and escapes backslashes and double quotes', () => {
    expect(quoteFilter('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });
});

describe('safeLocalOcrUrl', () => {
  it.each(['http://localhost:8080/ocr', 'https://127.0.0.1/ocr', 'http://[::1]:5000/'])(
    'accepts loopback %s',
    (url) => {
      expect(safeLocalOcrUrl(` ${url} `)).toBe(new URL(url).href);
    },
  );

  it.each([
    'http://example.org/ocr',
    'http://user:pw@localhost/ocr',
    'ftp://localhost/ocr',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(safeLocalOcrUrl(url)).toBe('');
  });

  it('rejects non-strings', () => {
    expect(safeLocalOcrUrl(null)).toBe('');
  });
});

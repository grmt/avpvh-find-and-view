import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }));
}

const HEADING_RE = /^#{2,6}\s+\S/m;

// A GFM table delimiter row, e.g. "| --- | --- |" or "|:--|--:|" — pipes,
// dashes and colons only, at least two columns. Checked against the line
// right after one containing a pipe (the header row), so a plain "---"
// horizontal-rule/setext-heading line elsewhere in OCR'd text doesn't count.
const TABLE_DELIMITER_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function hasMarkdownTable(src: string): boolean {
  const lines = src.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    if (prev !== undefined && line !== undefined && prev.includes('|') && TABLE_DELIMITER_RE.test(line)) return true;
  }
  return false;
}

// Inline emphasis — *italic*, **bold**, ~~strikethrough~~ — typed by hand
// the same way headings and tables are (see below): the marker must be
// flush against a real character on both sides, not whitespace and not
// another marker character, so "5 * 3" or "quote ends. * next" don't
// false-positive on a lone asterisk used as punctuation.
const EMPHASIS_RE = /(\*\*|\*|~~)([^\s*~](?:[\s\S]*?[^\s*~])?)\1/;

// Documents hand-edited through the admin "Document bewerken" tool have no
// way to set text_format (it only ever PUTs {id, text}), so a heading or
// table typed there stays tagged as plain text. Recognize either as a
// fallback signal so it still renders instead of showing the literal
// markup. Heading detection requires 2+ hashes (## or more), not a single
// "#": a lone "#" turns out to also match things like shell/code comments
// in OCR'd exhibits ("# acties") and stray OCR artifacts, which real
// section headings in this content never use — they're consistently "##"
// or deeper.
export function looksLikeMarkdown(src: string): boolean {
  return HEADING_RE.test(src) || hasMarkdownTable(src) || EMPHASIS_RE.test(src);
}

export function renderPlain(src: string): string {
  return src.split(/\n\n+/).map(p => `<p style="margin:0 0 .8em">${p.replace(/\n/g, '<br>')}</p>`).join('');
}

import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }));
}

// Documents hand-edited through the admin "Document bewerken" tool have no
// way to set text_format (it only ever PUTs {id, text}), so a heading typed
// there stays tagged as plain text. Recognize a Markdown heading line as a
// fallback signal so it still renders instead of showing the literal "##".
// Requires 2+ hashes (## or more), not a single "#": a lone "#" turns out to
// also match things like shell/code comments in OCR'd exhibits ("# acties")
// and stray OCR artifacts, which real section headings in this content never
// use — they're consistently "##" or deeper.
export function looksLikeMarkdown(src: string): boolean {
  return /^#{2,6}\s+\S/m.test(src);
}

/** Escape text for both HTML text and quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]!);
}

/** Meilisearch highlighting may add only literal, attribute-free em tags. */
export function highlightHtml(value: unknown): string {
  return escapeHtml(value).replace(/&lt;(\/?)em&gt;/g, '<$1em>');
}

/** Reject executable schemes even when disguised with whitespace/entities. */
export function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function urlAttribute(value: unknown): string {
  return escapeHtml(safeUrl(value));
}

export function quoteFilter(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Local OCR runs only against loopback addresses on the editor's own machine. */
export function safeLocalOcrUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

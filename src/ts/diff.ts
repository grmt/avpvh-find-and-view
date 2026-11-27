import { escapeHtml } from './escape';

const DIFF_TOKEN_RE = /\s+|\S+/g;

// Word-level "track changes" diff: an LCS over whitespace/word tokens, deletions struck through,
// insertions highlighted, flowing as normal text.
export function diffWords(oldText: string, newText: string): string {
  const a = oldText.match(DIFF_TOKEN_RE) ?? [];
  const b = newText.match(DIFF_TOKEN_RE) ?? [];
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  let i = 0,
    j = 0;
  const parts: string[] = [];
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      parts.push(escapeHtml(a[i]!));
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      parts.push(`<del>${escapeHtml(a[i]!)}</del>`);
      i++;
    } else {
      parts.push(`<ins>${escapeHtml(b[j]!)}</ins>`);
      j++;
    }
  }
  while (i < n) {
    parts.push(`<del>${escapeHtml(a[i]!)}</del>`);
    i++;
  }
  while (j < m) {
    parts.push(`<ins>${escapeHtml(b[j]!)}</ins>`);
    j++;
  }
  return parts.join('');
}

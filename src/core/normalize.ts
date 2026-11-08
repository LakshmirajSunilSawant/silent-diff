import type { NormalizeOptions } from './types';

const NULL_LIKE = new Set(['', 'null', 'nil', 'none', 'n/a', 'na', 'nan', '-', '#n/a', 'undefined']);

// 1000 | -1,000.50 | $1,000 | 1.5e3 | (1,000) | 12% — thousands separators must be well-formed.
const NUMERIC = /^\(?([+-])?[$€£¥]?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\)?%?$/i;

/** Parse text that looks like a number. Returns null for anything else. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s || !NUMERIC.test(s)) return null;
  const negParen = s.startsWith('(') && s.endsWith(')');
  if (s.startsWith('(') !== s.endsWith(')')) return null;
  const n = Number(s.replace(/[()$€£¥,%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negParen ? -n : n;
}

/** Map a cell to the string it is compared by, given the user's normalization settings. */
export function normalizeValue(v: string, o: NormalizeOptions): string {
  let s = o.trim ? v.trim() : v;
  if (o.nullEqual && NULL_LIKE.has(s.trim().toLowerCase())) return '';
  if (o.numeric) {
    const n = parseNumber(s);
    // Prefix so a number never collides with plain text.
    if (n !== null) return '\u0000' + (Object.is(n, -0) ? 0 : n);
  }
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

export const ALL_NORMALIZATIONS: NormalizeOptions = { trim: true, ignoreCase: true, numeric: true, nullEqual: true };

export function describeNormalize(o: NormalizeOptions): string {
  const on: string[] = [];
  if (o.trim) on.push('trimmed whitespace');
  if (o.ignoreCase) on.push('ignored case');
  if (o.numeric) on.push('compared numbers numerically');
  if (o.nullEqual) on.push('treated empty and null-like values as equal');
  return on.length ? on.join(', ') : 'no normalization (exact text comparison)';
}

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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const TIME = String.raw`(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([ap]m)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const ISO = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})` + TIME + '$', 'i');
const NUMERIC_DATE = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})` + TIME + '$', 'i');
const NAMED_DMY = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})` + TIME + '$', 'i');
const NAMED_MDY = new RegExp(String.raw`^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})` + TIME + '$', 'i');

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number, time: (string | undefined)[]): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  let out = `${y}-${pad(m)}-${pad(d)}`;
  const [hh, mm, ss, ampm] = time;
  if (hh !== undefined) {
    let h = Number(hh);
    if (ampm) h = (h % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
    const t = `${pad(h)}:${mm}:${ss ?? '00'}`;
    // Midnight equals a bare date, so "2024-01-05 00:00" matches "2024-01-05".
    if (t !== '00:00:00') out += `T${t}`;
  }
  return out;
}

/** Parse common date formats to an ISO string (yyyy-mm-dd[Thh:mm:ss]). Returns null for anything else. */
export function parseDate(raw: string, order: 'MDY' | 'DMY' = 'MDY'): string | null {
  const s = raw.trim();
  if (s.length < 6 || s.length > 40) return null;
  let m = ISO.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3], m.slice(4));
  m = NUMERIC_DATE.exec(s);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    // An impossible month settles the order regardless of the setting.
    const dmy = a > 12 ? true : b > 12 ? false : order === 'DMY';
    return dmy ? iso(+m[3], b, a, m.slice(4)) : iso(+m[3], a, b, m.slice(4));
  }
  m = NAMED_DMY.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mon ? iso(+m[3], mon, +m[1], m.slice(4)) : null;
  }
  m = NAMED_MDY.exec(s);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    return mon ? iso(+m[3], mon, +m[2], m.slice(4)) : null;
  }
  return null;
}

/** True when both values are numbers within the user's tolerance. */
export function withinTolerance(a: string, b: string, o: NormalizeOptions): boolean {
  if (!(o.tolerance > 0)) return false;
  const x = parseNumber(a);
  const y = parseNumber(b);
  if (x === null || y === null) return false;
  const diff = Math.abs(x - y);
  const limit = o.toleranceMode === 'pct' ? (o.tolerance / 100) * Math.max(Math.abs(x), Math.abs(y)) : o.tolerance;
  return diff <= limit + 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

/** Map a cell to the string it is compared by, given the user's normalization settings. */
export function normalizeValue(v: string, o: NormalizeOptions): string {
  let s = o.trim ? v.trim() : v;
  if (o.nullEqual && NULL_LIKE.has(s.trim().toLowerCase())) return '';
  if (o.dates) {
    const d = parseDate(s, o.dateOrder);
    // Prefix so a date never collides with plain text.
    if (d !== null) return '\u0002' + d;
  }
  if (o.numeric) {
    const n = parseNumber(s);
    // Prefix so a number never collides with plain text.
    if (n !== null) return '\u0000' + (Object.is(n, -0) ? 0 : n);
  }
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

export const ALL_NORMALIZATIONS: NormalizeOptions = {
  trim: true,
  ignoreCase: true,
  numeric: true,
  nullEqual: true,
  dates: true,
  dateOrder: 'MDY',
  tolerance: 0,
  toleranceMode: 'abs',
};

export function describeNormalize(o: NormalizeOptions): string {
  const on: string[] = [];
  if (o.trim) on.push('trimmed whitespace');
  if (o.ignoreCase) on.push('ignored case');
  if (o.numeric) on.push('compared numbers numerically');
  if (o.nullEqual) on.push('treated empty and null-like values as equal');
  if (o.dates) on.push(`compared dates by calendar day (${o.dateOrder === 'DMY' ? 'D/M/Y' : 'M/D/Y'})`);
  if (o.tolerance > 0) on.push(`allowed numbers to differ by ${o.tolerance}${o.toleranceMode === 'pct' ? '%' : ''}`);
  return on.length ? on.join(', ') : 'no normalization (exact text comparison)';
}

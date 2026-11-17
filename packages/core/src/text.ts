/** Judging whether a string is something a person typed, and tidying it for display. */

const CODE_PUNCT = new Set(Array.from('{}[]<>=;|\\_"/:`$#@^~*+', (c) => c.charCodeAt(0)));

/** Rejects strings with control characters or decoding damage. */
export function isMostlyText(s: string): boolean {
  const n = s.length;
  if (n === 0) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f || c === 0xfffd || (c >= 0x80 && c <= 0x9f)) bad++;
  }
  return n < 50 ? bad === 0 : bad <= n * 0.02;
}

/**
 * 0..1: how much a string reads like human writing rather than data, markup, tokens or code.
 * It is a heuristic for ranking and noise filtering only. Text taken from a real text box is
 * kept whatever this says, so code typed into a form is still found.
 */
export function proseScore(text: string): number {
  const n = text.length;
  if (n < 8) return 0;
  const s = n > 6000 ? text.slice(0, 3000) + ' ' + text.slice(n - 3000) : text;
  const m = s.length;
  let letters = 0;
  let spaces = 0;
  let code = 0;
  let ctrl = 0;
  let wide = 0;
  for (let i = 0; i < m; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9 || c === 0xa0) spaces++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++;
    else if (c < 32 || c === 0xfffd) ctrl++;
    else if (c >= 0xc0 && !(c >= 0x2000 && c <= 0x2bff)) {
      letters++;
      if (c >= 0x2e80) wide++; // CJK, kana, hangul: written without spaces
    } else if (CODE_PUNCT.has(c)) code++;
  }
  const spaceRatio = spaces / m;
  const letterRatio = letters / m;
  const codeRatio = code / m;
  let score = 1;
  if (wide / m < 0.3) {
    if (spaceRatio < 0.04) score *= 0.15;
    else if (spaceRatio < 0.09) score *= 0.6;
    const tokens = s.split(/\s+/).filter(Boolean);
    const avg = (m - spaces) / Math.max(1, tokens.length);
    if (avg > 16) score *= 0.35;
    else if (avg > 10) score *= 0.7;
    if (tokens.length >= 12) {
      const distinct = new Set(tokens.map((t) => t.toLowerCase())).size;
      if (distinct / tokens.length < 0.25) score *= 0.5;
    }
    let longest = 0;
    for (const t of tokens) if (t.length > longest) longest = t.length;
    if (longest > 120) score *= 0.6;
  }
  if (spaceRatio > 0.45) score *= 0.5;
  if (letterRatio < 0.45) score *= 0.35;
  else if (letterRatio < 0.6) score *= 0.75;
  if (codeRatio > 0.14) score *= 0.4;
  else if (codeRatio > 0.07) score *= 0.7;
  if (ctrl / m > 0.01) score *= 0.3;
  return Math.max(0, Math.min(1, score));
}

export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
}

export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

const TAG_RE = /<\/?[a-zA-Z][^<>]{0,300}>/g;
const BLOCK_TAG_RE = /<(p|div|br|span|li|ul|ol|h[1-6]|blockquote|strong|em|b|i|a)\b/i;

const MAX_HTML_CHARS = 2_000_000;

/** Removes <style> and <script> blocks in one linear pass (a regex here can backtrack badly). */
function dropStyleAndScript(s: string): string {
  const lower = s.toLowerCase();
  let out = '';
  let pos = 0;
  for (;;) {
    const a = lower.indexOf('<style', pos);
    const b = lower.indexOf('<script', pos);
    const open = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    if (open < 0) break;
    const closeTag = open === a ? '</style' : '</script';
    const close = lower.indexOf(closeTag, open);
    if (close < 0) break;
    const end = lower.indexOf('>', close);
    if (end < 0) break;
    out += s.slice(pos, open);
    pos = end + 1;
  }
  return pos === 0 ? s : out + s.slice(pos);
}

/** Rich editors save drafts as HTML. Give people their words back, not the markup. */
export function htmlToTextIfHtml(s: string): { text: string; wasHtml: boolean } {
  if (s.length > MAX_HTML_CHARS || s.indexOf('<') < 0 || !BLOCK_TAG_RE.test(s)) return { text: s, wasHtml: false };
  const tags = s.match(TAG_RE);
  if (!tags || tags.length < 2) return { text: s, wasHtml: false };
  let t = dropStyleAndScript(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<li\b[^<>]*>/gi, '- ')
    .replace(TAG_RE, '');
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  t = t
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: t, wasHtml: true };
}

export function looksLikeUrl(s: string): boolean {
  return /^(https?|file|chrome|edge|about|blob|data|chrome-extension|moz-extension):/i.test(s.trim()) && !/\s/.test(s.trim());
}

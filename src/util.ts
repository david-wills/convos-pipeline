import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hhmmssToSeconds(hhmmss: string): number {
  const parts = hhmmss.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export function secondsToHhmmss(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const FILLER_WORDS = new Set(['um', 'uh', 'uh-huh', 'mm-hmm', 'hmm', 'mhm', 'mm', 'ah']);

/** First `maxWords` non-filler words, lowercased. */
export function extractAnchorPhrase(words: { text: string }[], maxWords = 15): string {
  const meaningful: string[] = [];
  for (const w of words) {
    if (meaningful.length >= maxWords) break;
    const clean = w.text.toLowerCase().replace(/[^a-z']/g, '');
    if (clean && !FILLER_WORDS.has(clean)) meaningful.push(w.text.toLowerCase());
  }
  return meaningful.join(' ');
}

export function slugify(text: string, maxLen = 60): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` over `items` with at most `limit` in flight. Preserves order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- tiny JSON file store -------------------------------------------------

export function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function log(scope: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${ts} [${scope}] ${message}`);
}

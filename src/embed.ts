// Optional retriever: embeddings over segment title + description.
//
// Voyage AI over plain fetch, no SDK, so the repository keeps its two
// dependencies. Vectors are cached under data/embeddings/ by content hash, so
// a re-run that changes no text costs nothing. Only the segment's title and
// description are embedded, never transcript text: keyword search reads the
// same thirty-odd words, and the comparison is only meaningful if both
// retrievers see the same input.

import path from 'node:path';
import { recordUsage } from './claude.ts';
import type { Convo, Episode, EpisodeConvos, Story } from './types.ts';
import { log, readJson, sha256, sleep, writeJson } from './util.ts';

export const EMBED_MODEL = process.env.CONVOS_EMBED_MODEL ?? 'voyage-4-lite';
const ENDPOINT = process.env.CONVOS_EMBED_ENDPOINT ?? 'https://api.voyageai.com/v1/embeddings';
/** Texts per request. The API allows 1000; smaller batches keep a retry cheap. */
const BATCH_SIZE = 128;

/** Voyage prepends a retrieval instruction that differs for the two sides of a search. */
export type InputType = 'document' | 'query';

export function segmentText(c: Convo): string {
  return `${c.title}. ${c.description}`;
}

export function storyText(s: Story): string {
  return `${s.title}. ${s.summary} Keywords: ${s.keywords.join(', ')}`;
}

export function requireVoyageKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error('VOYAGE_API_KEY is not set. The embedding retriever needs a Voyage AI key; the default keyword pipeline does not.');
  }
  return key;
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens?: number };
}

async function postWithRetry(apiKey: string, payload: unknown, maxAttempts = 6): Promise<VoyageResponse> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as VoyageResponse;
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxAttempts) {
      throw new Error(`Voyage embeddings HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2_000 * 2 ** (attempt - 1));
    log('embed', `HTTP ${res.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
    await sleep(waitMs);
  }
}

/** Embed texts, preserving order. Token counts are recorded under `step` against the embedding model. */
export async function embedTexts(texts: string[], inputType: InputType, step: string): Promise<number[][]> {
  const apiKey = requireVoyageKey();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const body = await postWithRetry(apiKey, { input: batch, model: EMBED_MODEL, input_type: inputType, truncation: true });
    if (!Array.isArray(body.data) || body.data.length !== batch.length) {
      throw new Error(`Voyage returned ${body.data?.length ?? 0} vectors for ${batch.length} inputs`);
    }
    const ordered = [...body.data].sort((a, b) => a.index - b.index);
    out.push(...ordered.map((d) => d.embedding));
    recordUsage(step, EMBED_MODEL, body.usage?.total_tokens ?? 0, 0);
  }
  return out;
}

interface EmbeddingCache {
  model: string;
  inputType: InputType;
  dimension: number;
  /** sha256(text) -> vector */
  vectors: Record<string, number[]>;
}

/**
 * Embed `texts`, reading and extending the JSON cache at `file`. Keyed by a hash
 * of the text; a different model or input type throws the cache away.
 */
export async function embedCached(file: string, texts: string[], inputType: InputType, step: string): Promise<number[][]> {
  const existing = readJson<EmbeddingCache>(file);
  const cache: EmbeddingCache =
    existing && existing.model === EMBED_MODEL && existing.inputType === inputType
      ? existing
      : { model: EMBED_MODEL, inputType, dimension: 0, vectors: {} };

  const keys = texts.map((t) => sha256(t));
  const missing = [...new Set(keys.filter((k) => !(k in cache.vectors)))];
  if (missing.length > 0) {
    const textByKey = new Map(keys.map((k, i) => [k, texts[i]]));
    const vectors = await embedTexts(missing.map((k) => textByKey.get(k)!), inputType, step);
    missing.forEach((k, i) => {
      // Seven significant digits keeps the cache readable; the effect on cosine is under 1e-6.
      cache.vectors[k] = vectors[i].map((v) => Number(v.toPrecision(7)));
    });
    cache.dimension = vectors[0]?.length ?? cache.dimension;
    writeJson(file, cache);
  }
  log('embed', `${texts.length} ${inputType} texts: ${missing.length} embedded with ${EMBED_MODEL}, ${texts.length - missing.length} from cache`);
  return keys.map((k) => cache.vectors[k]);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface IndexedSegment {
  episode: Episode;
  convo: Convo;
  vector: number[];
}

export async function buildSegmentIndex(
  episodes: Episode[],
  convosByEpisode: Map<string, EpisodeConvos>,
  cacheDir: string,
  step = 'embed',
): Promise<IndexedSegment[]> {
  const items: { episode: Episode; convo: Convo }[] = [];
  for (const episode of episodes) {
    const ec = convosByEpisode.get(episode.id);
    if (!ec) continue;
    for (const convo of ec.convos) items.push({ episode, convo });
  }
  const vectors = await embedCached(path.join(cacheDir, 'segments.json'), items.map((i) => segmentText(i.convo)), 'document', step);
  return items.map((item, i) => ({ ...item, vector: vectors[i] }));
}

export async function embedStories(stories: Story[], cacheDir: string, step = 'embed'): Promise<Map<string, number[]>> {
  const vectors = await embedCached(path.join(cacheDir, 'stories.json'), stories.map(storyText), 'query', step);
  return new Map(stories.map((s, i) => [s.id, vectors[i]]));
}

export interface RankedSegment {
  segment: IndexedSegment;
  similarity: number;
  /** 1-based position among all segments for this story. */
  rank: number;
}

/** Every segment ordered by cosine similarity to the story, newest episode first on ties. */
export function rankSegments(storyVector: number[], index: IndexedSegment[]): RankedSegment[] {
  return index
    .map((segment) => ({ segment, similarity: cosine(storyVector, segment.vector) }))
    .sort((a, b) => b.similarity - a.similarity || (b.segment.episode.pubDate ?? '').localeCompare(a.segment.episode.pubDate ?? ''))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

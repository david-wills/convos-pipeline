import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PipelineConfig } from './types.ts';
import { readJson } from './util.ts';

export interface Paths {
  data: string;
  out: string;
  transcripts: string;
  convos: string;
  episodes: string;
  newsItems: string;
  stories: string;
  matches: string;
  transcribeState: string;
  /** Cached vectors for the optional embedding retriever. */
  embeddings: string;
  /** Raw output of `compare`. */
  comparison: string;
  /** Disagreements from `compare`, laid out for a person to label. */
  spotCheck: string;
}

export function resolvePaths(dataDir: string, outDir: string): Paths {
  const data = path.resolve(dataDir);
  return {
    data,
    out: path.resolve(outDir),
    transcripts: path.join(data, 'transcripts'),
    convos: path.join(data, 'convos'),
    episodes: path.join(data, 'episodes.json'),
    newsItems: path.join(data, 'news-items.json'),
    stories: path.join(data, 'stories.json'),
    matches: path.join(data, 'matches.json'),
    transcribeState: path.join(data, 'transcribe-state.json'),
    embeddings: path.join(data, 'embeddings'),
    comparison: path.join(data, 'comparison.json'),
    spotCheck: path.join(data, 'spot-check.md'),
  };
}

/** Load `.env` from the working directory if present. No dependency needed on Node 22+. */
export function loadDotenv(): void {
  const file = path.resolve('.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (error) {
    console.warn(`Could not load .env: ${(error as Error).message}`);
  }
}

export function loadConfig(file: string): PipelineConfig {
  const config = readJson<PipelineConfig>(file);
  if (!config) throw new Error(`Config not found: ${file}`);
  if (!Array.isArray(config.podcasts) || config.podcasts.length === 0) {
    throw new Error('Config needs at least one podcast feed');
  }
  if (!Array.isArray(config.news) || config.news.length === 0) {
    throw new Error('Config needs at least one news feed');
  }
  const partial = config as Partial<PipelineConfig>;
  return {
    ...config,
    selection: { sinceDays: 3, maxPerFeed: 2, maxDurationSec: 2700, ...partial.selection },
    clustering: { maxHeadlines: 75, ...partial.clustering },
    matching: {
      minScore: 7,
      maxCandidates: 200,
      ...partial.matching,
      embedding: { topK: 25, minSimilarity: 0.5, ...partial.matching?.embedding },
    },
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

// Step 5: story -> podcast segments that discuss it.
//
// Two-stage retrieval. Stage one is cheap. By default it is lexical: any story
// keyword appearing in a segment's title or description makes it a candidate.
// An optional embedding retriever ranks segments by cosine similarity instead,
// and the two can be unioned. Stage two is a model call: the verifier scores
// every candidate 0-10 against the story and only high scores survive. Then a
// decayed trending score ranks stories by how much verified coverage they have.

import { complete, loadPrompt, MODELS, parseJsonArray } from './claude.ts';
import { rankSegments, type IndexedSegment } from './embed.ts';
import type { Convo, Episode, EpisodeConvos, Match, PipelineConfig, Story } from './types.ts';
import { log } from './util.ts';

const SYSTEM_PROMPT = loadPrompt('verify-match.md');

export interface Candidate {
  episodeId: string;
  convoIdx: number;
  convoTitle: string;
  convoDescription: string;
  episodeTitle: string;
  podcastTitle: string;
  pubDate: string | null;
  startTime: number;
  endTime: number;
  audioUrl: string;
}

export function toCandidate(ep: Episode, c: Convo): Candidate {
  return {
    episodeId: ep.id,
    convoIdx: c.index,
    convoTitle: c.title,
    convoDescription: c.description,
    episodeTitle: ep.title,
    podcastTitle: ep.podcastTitle,
    pubDate: ep.pubDate,
    startTime: c.startTime,
    endTime: c.endTime,
    audioUrl: ep.audioUrl,
  };
}

/** Identity of a segment, shared by every retriever. */
export function candidateKey(c: { episodeId: string; convoIdx: number }): string {
  return `${c.episodeId}:${c.convoIdx}`;
}

/** Newest episode first, then a fixed tiebreak so a merged list is reproducible. */
export function sortCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.sort(
    (a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? '') || a.episodeId.localeCompare(b.episodeId) || a.convoIdx - b.convoIdx,
  );
}

/**
 * Whole-word, case-insensitive. Production used SQL `LIKE '%kw%'`, which let a
 * keyword like "AI" match "said", "raise" and "Haiti" and flood the verifier
 * with candidates; the standalone port found that and fixed it here.
 */
export function keywordPattern(keyword: string): RegExp | null {
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b only works next to word characters; keywords like "$12.9 billion" start with a symbol.
  const lead = /^\w/.test(trimmed) ? '\\b' : '(?<!\\S)';
  const tail = /\w$/.test(trimmed) ? '\\b' : '(?!\\S)';
  return new RegExp(`${lead}${escaped}${tail}`, 'i');
}

export function keywordSearch(
  story: Story,
  episodes: Episode[],
  convosByEpisode: Map<string, EpisodeConvos>,
  maxCandidates: number,
): Candidate[] {
  const patterns = story.keywords.map(keywordPattern).filter((p): p is RegExp => p !== null);
  if (patterns.length === 0) return [];

  const candidates: Candidate[] = [];
  for (const ep of episodes) {
    const ec = convosByEpisode.get(ep.id);
    if (!ec) continue;
    for (const c of ec.convos) {
      const haystack = `${c.title} ${c.description}`;
      if (patterns.some((p) => p.test(haystack))) candidates.push(toCandidate(ep, c));
    }
  }
  // Newest episodes first, then cap. Mirrors the production query.
  candidates.sort((a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? ''));
  return candidates.slice(0, maxCandidates);
}

/** Top-K segments by cosine similarity to the story, minus anything under the floor. */
export function embeddingSearch(storyVector: number[], index: IndexedSegment[], matching: PipelineConfig['matching']): Candidate[] {
  const { topK, minSimilarity } = matching.embedding;
  return rankSegments(storyVector, index)
    .filter((r) => r.rank <= topK && r.similarity >= minSimilarity)
    .slice(0, matching.maxCandidates)
    .map((r) => toCandidate(r.segment.episode, r.segment.convo));
}

// --- retrievers ---------------------------------------------------------------

export type RetrieverName = 'keyword' | 'embedding' | 'both';
export const RETRIEVER_NAMES: readonly RetrieverName[] = ['keyword', 'embedding', 'both'];

export interface Retriever {
  name: RetrieverName;
  candidates(story: Story): Candidate[];
}

export function keywordRetriever(episodes: Episode[], convosByEpisode: Map<string, EpisodeConvos>, config: PipelineConfig): Retriever {
  return {
    name: 'keyword',
    candidates: (story) => keywordSearch(story, episodes, convosByEpisode, config.matching.maxCandidates),
  };
}

export function embeddingRetriever(index: IndexedSegment[], storyVectors: Map<string, number[]>, config: PipelineConfig): Retriever {
  return {
    name: 'embedding',
    candidates: (story) => {
      const vector = storyVectors.get(story.id);
      return vector ? embeddingSearch(vector, index, config.matching) : [];
    },
  };
}

export function unionRetriever(a: Retriever, b: Retriever, maxCandidates: number): Retriever {
  return {
    name: 'both',
    candidates: (story) => {
      const merged = new Map<string, Candidate>();
      for (const c of [...a.candidates(story), ...b.candidates(story)]) {
        if (!merged.has(candidateKey(c))) merged.set(candidateKey(c), c);
      }
      return sortCandidates([...merged.values()]).slice(0, maxCandidates);
    },
  };
}

// --- verification ---------------------------------------------------------------

export interface VerificationResult {
  matches: Match[];
  scored: { index: number; score: number }[];
}

export async function verifyCandidates(story: Story, candidates: Candidate[], minScore: number, step = 'verify'): Promise<VerificationResult> {
  // Candidates are addressed by list position. The production prompt asked the
  // model to echo (episodeId, convoIdx) instead; with 100+ candidates it started
  // returning list positions in the convoIdx slot and every match was dropped.
  const convoList = candidates
    .map((c, i) => `[${i}] Episode: "${c.episodeTitle}" | Convo: "${c.convoTitle}" | Description: "${c.convoDescription}"`)
    .join('\n');

  const { text } = await complete({
    step,
    model: MODELS.classify,
    system: SYSTEM_PROMPT,
    user: `Story: "${story.title}"\nCategory: ${story.category}\n\nRate these podcast convos for relevance (0-10):\n\n${convoList}`,
    maxTokens: 4096,
    temperature: 0,
  });

  const scored = parseJsonArray<{ index: number; score: number }>(text) ?? [];
  const matches: Match[] = [];
  const seen = new Set<number>();
  for (const s of scored) {
    if (typeof s.score !== 'number' || s.score < minScore) continue;
    if (!Number.isInteger(s.index) || seen.has(s.index)) continue;
    const c = candidates[s.index];
    if (!c) continue;
    seen.add(s.index);
    matches.push({
      storyId: story.id,
      episodeId: c.episodeId,
      convoIdx: c.convoIdx,
      relevanceScore: s.score,
      convoTitle: c.convoTitle,
      convoDescription: c.convoDescription,
      episodeTitle: c.episodeTitle,
      podcastTitle: c.podcastTitle,
      startTime: c.startTime,
      endTime: c.endTime,
      audioUrl: c.audioUrl,
    });
  }
  return { matches, scored };
}

/**
 * trending = matches x avg relevance x (1 + 0.2 x distinct podcasts) x 0.5^(age in days / 3)
 * A story with one verified match becomes active; an active story decays to
 * archived once its score drops under 0.5.
 */
export function scoreStory(story: Story, matches: Match[], now: Date): void {
  const mine = matches.filter((m) => m.storyId === story.id);
  const podcasts = new Set(mine.map((m) => m.podcastTitle));
  const avg = mine.length ? mine.reduce((s, m) => s + m.relevanceScore, 0) / mine.length : 0;
  const ageDays = (now.getTime() - new Date(story.firstSeenAt).getTime()) / 86_400_000;
  const score = mine.length * avg * (1 + 0.2 * podcasts.size) * Math.pow(0.5, ageDays / 3);

  story.matchCount = mine.length;
  story.podcastCount = podcasts.size;
  story.avgRelevance = Math.round(avg * 100) / 100;
  story.trendingScore = Math.round(score * 100) / 100;
  if (story.status === 'candidate' && mine.length >= 1) story.status = 'active';
  if (story.status === 'active' && score < 0.5) story.status = 'archived';
}

export interface MatchRunResult {
  retriever: RetrieverName;
  storiesProcessed: number;
  candidatesTotal: number;
  matchesTotal: number;
  perStory: { storyId: string; title: string; candidates: number; matches: number }[];
}

export async function matchStories(
  stories: Story[],
  episodes: Episode[],
  convosByEpisode: Map<string, EpisodeConvos>,
  matches: Match[],
  config: PipelineConfig,
  { force = false, now = new Date(), retriever = keywordRetriever(episodes, convosByEpisode, config) }: { force?: boolean; now?: Date; retriever?: Retriever } = {},
): Promise<MatchRunResult> {
  const result: MatchRunResult = { retriever: retriever.name, storiesProcessed: 0, candidatesTotal: 0, matchesTotal: 0, perStory: [] };

  for (const story of stories) {
    if (story.status === 'archived') continue;
    if (story.matchedAt && !force) continue;

    const candidates = retriever.candidates(story);
    let verified: Match[] = [];
    if (candidates.length > 0) {
      ({ matches: verified } = await verifyCandidates(story, candidates, config.matching.minScore));
    }

    // Replace this story's matches wholesale; the verifier is the source of truth.
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i].storyId === story.id) matches.splice(i, 1);
    matches.push(...verified);

    story.matchedAt = now.toISOString();
    result.storiesProcessed++;
    result.candidatesTotal += candidates.length;
    result.matchesTotal += verified.length;
    result.perStory.push({ storyId: story.id, title: story.title, candidates: candidates.length, matches: verified.length });
    log('match', `"${story.title}": ${candidates.length} ${retriever.name} candidates -> ${verified.length} verified`);
  }

  for (const story of stories) scoreStory(story, matches, now);
  return result;
}

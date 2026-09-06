// The experiment behind samples/retrieval-comparison.md: run keyword search
// and embedding search over the same stories and segments, verify the union
// of their candidates once so a shared candidate gets one score, then credit
// every verified match to the retriever or retrievers that surfaced it.
//
// data/comparison.json holds the raw per-candidate facts. Everything derived
// from it, totals, the floor sweep and the Markdown, is computed at render
// time, so `report` re-renders without an API call and the similarity floor
// can be changed without re-verifying.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { estimateCostUsd, MODELS, usageByStep } from './claude.ts';
import type { Paths } from './config.ts';
import { buildSegmentIndex, EMBED_MODEL, embedStories, rankSegments } from './embed.ts';
import { candidateKey, keywordSearch, sortCandidates, toCandidate, VERIFIER_PROMPT_FILES, verifyCandidates, type Candidate, type VerifierName } from './match.ts';
import type { Episode, EpisodeConvos, Match, ModelUsage, PipelineConfig, Story } from './types.ts';
import { log, readJson, secondsToHhmmss, writeJson } from './util.ts';

export const EMBED_STEP = 'compare:embed';
export const VERIFY_STEP = 'compare:verify';
/** Candidates per verifier call. Index addressing fixed the 126-candidate failure; shorter lists still score more consistently. */
const CHUNK_SIZE = 50;

export interface ComparedCandidate {
  episodeId: string;
  convoIdx: number;
  podcastTitle: string;
  episodeTitle: string;
  pubDate: string | null;
  convoTitle: string;
  convoDescription: string;
  startTime: number;
  endTime: number;
  /** Surfaced by keyword search. */
  keyword: boolean;
  /** Cosine similarity between the story vector and the segment vector. */
  similarity: number;
  /** 1-based rank among all segments by similarity for this story. */
  rank: number;
  /** Verifier score, or null when the verifier did not return it (under the cutoff). */
  score: number | null;
  /** Score this segment had in data/matches.json from the pipeline run, if it was a match there. */
  committedScore: number | null;
}

export interface ComparedStory {
  storyId: string;
  title: string;
  keywords: string[];
  candidates: ComparedCandidate[];
}

export interface ComparisonData {
  ranAt: string;
  embedding: { model: string; dimension: number; topK: number; minSimilarity: number };
  verifier: { model: string; variant: VerifierName; prompt: string; minScore: number; chunkSize: number; calls: number };
  keywordMaxCandidates: number;
  segments: number;
  committedMatches: number;
  stories: ComparedStory[];
  /** Token tallies for this run's embedding and verification calls. */
  usage: Record<string, ModelUsage & { model: string }>;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** File names for one verifier variant. The production variant keeps the unsuffixed names. */
export function comparisonNames(verifier: VerifierName): { spotCheck: string; sampleBase: string } {
  const suffix = verifier === 'production' ? '' : `-${verifier}`;
  return { spotCheck: `spot-check${suffix}.md`, sampleBase: `retrieval-comparison${suffix}` };
}

export function comparisonFiles(paths: Paths, verifier: VerifierName): { data: string; spotCheck: string; sampleBase: string } {
  const suffix = verifier === 'production' ? '' : `-${verifier}`;
  const names = comparisonNames(verifier);
  return { data: path.join(paths.data, `comparison${suffix}.json`), spotCheck: path.join(paths.data, names.spotCheck), sampleBase: names.sampleBase };
}

export async function runComparison(paths: Paths, config: PipelineConfig, now: Date, verifier: VerifierName = 'production'): Promise<ComparisonData> {
  const episodes = readJson<Episode[]>(paths.episodes) ?? [];
  const stories = readJson<Story[]>(paths.stories) ?? [];
  const matches = readJson<Match[]>(paths.matches) ?? [];
  const convosByEpisode = new Map<string, EpisodeConvos>();
  for (const ep of episodes) {
    const c = readJson<EpisodeConvos>(path.join(paths.convos, `${ep.id}.json`));
    if (c) convosByEpisode.set(ep.id, c);
  }
  if (stories.length === 0 || convosByEpisode.size === 0) {
    throw new Error(`nothing to compare: ${stories.length} stories, ${convosByEpisode.size} segmented episodes in ${paths.data}. Run the pipeline through match first.`);
  }

  const index = await buildSegmentIndex(episodes, convosByEpisode, paths.embeddings, EMBED_STEP);
  const storyVectors = await embedStories(stories, paths.embeddings, EMBED_STEP);
  const committed = new Map(matches.map((m) => [`${m.storyId}:${candidateKey(m)}`, m.relevanceScore]));
  const { topK, minSimilarity } = config.matching.embedding;
  const { minScore, maxCandidates } = config.matching;

  let calls = 0;
  const compared: ComparedStory[] = [];
  for (const story of stories) {
    const ranked = rankSegments(storyVectors.get(story.id)!, index);
    const rankByKey = new Map(ranked.map((r) => [candidateKey({ episodeId: r.segment.episode.id, convoIdx: r.segment.convo.index }), r]));
    const keyword = keywordSearch(story, episodes, convosByEpisode, maxCandidates);
    const keywordKeys = new Set(keyword.map(candidateKey));

    // Union of the keyword hits and the whole embedding top K. No similarity floor
    // here: verifying the full top K lets the floor be chosen afterwards for free.
    const union = new Map<string, Candidate>();
    for (const c of keyword) union.set(candidateKey(c), c);
    for (const r of ranked.slice(0, topK)) {
      const c = toCandidate(r.segment.episode, r.segment.convo);
      if (!union.has(candidateKey(c))) union.set(candidateKey(c), c);
    }
    const list = sortCandidates([...union.values()]);

    const scores = new Map<string, number>();
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      const { scored } = await verifyCandidates(story, chunk, minScore, VERIFY_STEP, verifier);
      calls++;
      for (const s of scored) {
        if (!Number.isInteger(s.index) || typeof s.score !== 'number') continue;
        const c = chunk[s.index];
        if (c && !scores.has(candidateKey(c))) scores.set(candidateKey(c), s.score);
      }
    }

    const candidates: ComparedCandidate[] = list.map((c) => {
      const key = candidateKey(c);
      const r = rankByKey.get(key)!;
      return {
        episodeId: c.episodeId,
        convoIdx: c.convoIdx,
        podcastTitle: c.podcastTitle,
        episodeTitle: c.episodeTitle,
        pubDate: c.pubDate,
        convoTitle: c.convoTitle,
        convoDescription: c.convoDescription,
        startTime: c.startTime,
        endTime: c.endTime,
        keyword: keywordKeys.has(key),
        similarity: round(r.similarity, 4),
        rank: r.rank,
        score: scores.get(key) ?? null,
        committedScore: committed.get(`${story.id}:${key}`) ?? null,
      };
    });
    const verified = candidates.filter((c) => c.score !== null && c.score >= minScore).length;
    log('compare', `"${story.title}": ${keyword.length} keyword + top ${topK} embedding = ${list.length} candidates -> ${verified} verified`);
    compared.push({ storyId: story.id, title: story.title, keywords: story.keywords, candidates });
  }

  const usage: ComparisonData['usage'] = {};
  for (const step of [EMBED_STEP, VERIFY_STEP]) if (usageByStep[step]) usage[step] = { ...usageByStep[step] };

  return {
    ranAt: now.toISOString(),
    embedding: { model: EMBED_MODEL, dimension: index[0]?.vector.length ?? 0, topK, minSimilarity },
    verifier: { model: MODELS.classify, variant: verifier, prompt: VERIFIER_PROMPT_FILES[verifier], minScore, chunkSize: CHUNK_SIZE, calls },
    keywordMaxCandidates: maxCandidates,
    segments: index.length,
    committedMatches: matches.length,
    stories: compared,
    usage,
  };
}

// --- derived numbers ---------------------------------------------------------------

function flags(c: ComparedCandidate, data: ComparisonData, floor: number, minScore = data.verifier.minScore) {
  return {
    kw: c.keyword,
    emb: c.rank <= data.embedding.topK && c.similarity >= floor,
    verified: c.score !== null && c.score >= minScore,
  };
}

export interface RetrieverTotals {
  candidates: number;
  verified: number;
  /** Stories with at least one verified segment. */
  stories: number;
  /** Distinct shows among verified segments. */
  shows: number;
  /** Verified segments the other retriever did not surface. */
  onlyVerified: number;
}

export interface PerStory {
  storyId: string;
  title: string;
  keyword: { candidates: number; verified: number };
  embedding: { candidates: number; verified: number };
  overlap: { candidates: number; verified: number };
  keywordOnlyVerified: number;
  embeddingOnlyVerified: number;
  unionVerified: number;
}

export interface Summary {
  floor: number;
  keyword: RetrieverTotals;
  embedding: RetrieverTotals;
  union: RetrieverTotals;
  overlap: RetrieverTotals;
  /** Verified segments inside the top K whose similarity fell under the floor: neither retriever is credited. */
  verifiedBelowFloor: number;
  perStory: PerStory[];
}

type Acc = RetrieverTotals & { storyIds: Set<string>; showNames: Set<string> };
const newAcc = (): Acc => ({ candidates: 0, verified: 0, stories: 0, shows: 0, onlyVerified: 0, storyIds: new Set(), showNames: new Set() });
const finish = ({ storyIds, showNames, ...t }: Acc): RetrieverTotals => ({ ...t, stories: storyIds.size, shows: showNames.size });

export function summarize(data: ComparisonData, floor = data.embedding.minSimilarity, minScore = data.verifier.minScore): Summary {
  const acc = { keyword: newAcc(), embedding: newAcc(), union: newAcc(), overlap: newAcc() };
  let verifiedBelowFloor = 0;
  const perStory: PerStory[] = [];

  for (const s of data.stories) {
    const row: PerStory = {
      storyId: s.storyId,
      title: s.title,
      keyword: { candidates: 0, verified: 0 },
      embedding: { candidates: 0, verified: 0 },
      overlap: { candidates: 0, verified: 0 },
      keywordOnlyVerified: 0,
      embeddingOnlyVerified: 0,
      unionVerified: 0,
    };
    for (const c of s.candidates) {
      const { kw, emb, verified } = flags(c, data, floor, minScore);
      const sets: (keyof typeof acc)[] = [];
      if (kw) sets.push('keyword');
      if (emb) sets.push('embedding');
      if (kw || emb) sets.push('union');
      if (kw && emb) sets.push('overlap');
      for (const name of sets) {
        acc[name].candidates++;
        if (verified) {
          acc[name].verified++;
          acc[name].storyIds.add(s.storyId);
          acc[name].showNames.add(c.podcastTitle);
        }
      }
      if (kw) { row.keyword.candidates++; if (verified) row.keyword.verified++; }
      if (emb) { row.embedding.candidates++; if (verified) row.embedding.verified++; }
      if (kw && emb) { row.overlap.candidates++; if (verified) row.overlap.verified++; }
      if (verified) {
        if (kw && !emb) { row.keywordOnlyVerified++; acc.keyword.onlyVerified++; }
        if (emb && !kw) { row.embeddingOnlyVerified++; acc.embedding.onlyVerified++; }
        if (kw || emb) row.unionVerified++;
        else verifiedBelowFloor++;
      }
    }
    perStory.push(row);
  }
  return {
    floor,
    keyword: finish(acc.keyword),
    embedding: finish(acc.embedding),
    union: finish(acc.union),
    overlap: finish(acc.overlap),
    verifiedBelowFloor,
    perStory,
  };
}

export interface SweepRow { floor: number; candidates: number; verified: number; onlyVerified: number; verifiedLost: number }

/** The embedding retriever at each floor from "none" up through the top-K similarity range, in steps of 0.05. */
export function floorSweep(data: ComparisonData): SweepRow[] {
  const sims = data.stories.flatMap((s) => s.candidates.filter((c) => c.rank <= data.embedding.topK).map((c) => c.similarity));
  if (sims.length === 0) return [];
  const lo = Math.floor(Math.min(...sims) * 20) / 20;
  const hi = Math.ceil(Math.max(...sims) * 20) / 20;
  const floors = new Set<number>([0]);
  for (let f = lo; f <= hi + 1e-9; f += 0.05) floors.add(round(f, 2));
  return [...floors].sort((a, b) => a - b).map((floor) => {
    const s = summarize(data, floor);
    return { floor, candidates: s.embedding.candidates, verified: s.embedding.verified, onlyVerified: s.embedding.onlyVerified, verifiedLost: s.verifiedBelowFloor };
  });
}

export interface ThresholdRow {
  threshold: number;
  keyword: { verified: number; onlyVerified: number };
  embedding: { verified: number; onlyVerified: number };
  either: number;
  both: number;
}

/** Same scores, higher cutoffs. The pipeline keeps 7 and above; 8 and 9 are what a stricter cutoff would leave. */
export function thresholdSweep(data: ComparisonData): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  for (let threshold = data.verifier.minScore; threshold <= 9; threshold++) {
    const s = summarize(data, data.embedding.minSimilarity, threshold);
    rows.push({
      threshold,
      keyword: { verified: s.keyword.verified, onlyVerified: s.keyword.onlyVerified },
      embedding: { verified: s.embedding.verified, onlyVerified: s.embedding.onlyVerified },
      either: s.union.verified,
      both: s.overlap.verified,
    });
  }
  return rows;
}

export interface Distribution { count: number; min: number; p10: number; median: number; p90: number; max: number }

function distribution(values: number[]): Distribution {
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.round((p / 100) * (v.length - 1)))] : 0);
  return { count: v.length, min: v[0] ?? 0, p10: at(10), median: at(50), p90: at(90), max: v[v.length - 1] ?? 0 };
}

/** Cosine similarity of verified against unverified candidates inside the top K. */
export function similarityStats(data: ComparisonData): { verifiedInTopK: Distribution; unverifiedInTopK: Distribution } {
  const inTopK = data.stories.flatMap((s) => s.candidates.filter((c) => c.rank <= data.embedding.topK));
  const isVerified = (c: ComparedCandidate) => c.score !== null && c.score >= data.verifier.minScore;
  return {
    verifiedInTopK: distribution(inTopK.filter(isVerified).map((c) => c.similarity)),
    unverifiedInTopK: distribution(inTopK.filter((c) => !isVerified(c)).map((c) => c.similarity)),
  };
}

export interface Disagreement {
  storyTitle: string;
  foundBy: 'keyword' | 'embedding';
  podcastTitle: string;
  episodeTitle: string;
  convoTitle: string;
  convoDescription: string;
  startTime: number;
  endTime: number;
  score: number;
  similarity: number;
  rank: number;
}

/** Verified segments that only one retriever surfaced. Embedding-only first, then keyword-only, best score first. */
export function disagreements(data: ComparisonData, floor = data.embedding.minSimilarity): Disagreement[] {
  const out: Disagreement[] = [];
  for (const s of data.stories) {
    for (const c of s.candidates) {
      const { kw, emb, verified } = flags(c, data, floor);
      if (!verified || kw === emb) continue;
      out.push({
        storyTitle: s.title,
        foundBy: kw ? 'keyword' : 'embedding',
        podcastTitle: c.podcastTitle,
        episodeTitle: c.episodeTitle,
        convoTitle: c.convoTitle,
        convoDescription: c.convoDescription,
        startTime: c.startTime,
        endTime: c.endTime,
        score: c.score!,
        similarity: c.similarity,
        rank: c.rank,
      });
    }
  }
  return out.sort((a, b) => a.foundBy.localeCompare(b.foundBy) || b.score - a.score || b.similarity - a.similarity);
}

export interface Agreement {
  committed: number;
  rescored: number;
  reverified: number;
  dropped: { storyTitle: string; podcastTitle: string; convoTitle: string; committedScore: number; score: number | null }[];
  newlyVerifiedKeyword: number;
}

/** How the union verification treated the matches the keyword pipeline had already committed. */
export function committedAgreement(data: ComparisonData): Agreement {
  const out: Agreement = { committed: data.committedMatches, rescored: 0, reverified: 0, dropped: [], newlyVerifiedKeyword: 0 };
  for (const s of data.stories) {
    for (const c of s.candidates) {
      const verified = c.score !== null && c.score >= data.verifier.minScore;
      if (c.committedScore !== null) {
        out.rescored++;
        if (verified) out.reverified++;
        else out.dropped.push({ storyTitle: s.title, podcastTitle: c.podcastTitle, convoTitle: c.convoTitle, committedScore: c.committedScore, score: c.score });
      } else if (c.keyword && verified) {
        out.newlyVerifiedKeyword++;
      }
    }
  }
  return out;
}

export interface VerdictCell {
  both: number;
  onlyBaseline: number;
  onlyThis: number;
}

export type Attribution = 'keyword only' | 'embedding only' | 'both retrievers' | 'top-K under the floor';
const ATTRIBUTIONS: Attribution[] = ['keyword only', 'embedding only', 'both retrievers', 'top-K under the floor'];

export interface BaselineDiff {
  baselineVariant: VerifierName;
  byAttribution: Record<Attribution, VerdictCell>;
  all: VerdictCell;
  changed: {
    storyTitle: string;
    foundBy: Attribution;
    podcastTitle: string;
    convoTitle: string;
    convoDescription: string;
    baselineScore: number | null;
    score: number | null;
  }[];
}

/**
 * Same candidates scored by two verifier prompts: who verified what. Retrieval
 * attribution is identical on both sides because the union is the same.
 */
export function againstBaseline(data: ComparisonData, baseline: ComparisonData): BaselineDiff {
  const base = new Map<string, ComparedCandidate>();
  for (const s of baseline.stories) for (const c of s.candidates) base.set(`${s.storyId}:${candidateKey(c)}`, c);
  const cell = (): VerdictCell => ({ both: 0, onlyBaseline: 0, onlyThis: 0 });
  const out: BaselineDiff = {
    baselineVariant: baseline.verifier.variant,
    byAttribution: { 'keyword only': cell(), 'embedding only': cell(), 'both retrievers': cell(), 'top-K under the floor': cell() },
    all: cell(),
    changed: [],
  };
  for (const s of data.stories) {
    for (const c of s.candidates) {
      const b = base.get(`${s.storyId}:${candidateKey(c)}`);
      if (!b) continue;
      const { kw, emb, verified } = flags(c, data, data.embedding.minSimilarity);
      const baseVerified = b.score !== null && b.score >= baseline.verifier.minScore;
      const attribution: Attribution = kw && emb ? 'both retrievers' : kw ? 'keyword only' : emb ? 'embedding only' : 'top-K under the floor';
      for (const target of [out.byAttribution[attribution], out.all]) {
        if (verified && baseVerified) target.both++;
        else if (baseVerified) target.onlyBaseline++;
        else if (verified) target.onlyThis++;
      }
      if (verified !== baseVerified) {
        out.changed.push({ storyTitle: s.title, foundBy: attribution, podcastTitle: c.podcastTitle, convoTitle: c.convoTitle, convoDescription: c.convoDescription, baselineScore: b.score, score: c.score });
      }
    }
  }
  const order = (x: BaselineDiff['changed'][number]) => (x.baselineScore !== null && x.score === null ? 0 : 1);
  out.changed.sort((a, b) => order(a) - order(b) || ATTRIBUTIONS.indexOf(a.foundBy) - ATTRIBUTIONS.indexOf(b.foundBy) || a.storyTitle.localeCompare(b.storyTitle));
  return out;
}

// --- rendering ---------------------------------------------------------------

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const hms = (seconds: number) => secondsToHhmmss(seconds).replace(/^00:/, '');
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const sim = (n: number) => n.toFixed(3);

export function renderComparison(data: ComparisonData, baseline?: ComparisonData): string {
  const s = summarize(data);
  const sweep = floorSweep(data);
  const stats = similarityStats(data);
  const agree = committedAgreement(data);
  const dis = disagreements(data);
  const embedUsage = data.usage[EMBED_STEP];
  const verifyUsage = data.usage[VERIFY_STEP];
  const { topK, minSimilarity: floor } = data.embedding;
  const { minScore } = data.verifier;
  const L: string[] = [];

  const variant = data.verifier.variant;
  L.push(`# Retrieval comparison: keyword search against embeddings${variant === 'production' ? '' : `, ${variant} verifier`}`, '');
  L.push(`Written by \`node src/cli.ts compare${variant === 'production' ? '' : ` --verifier ${variant}`}\` on ${data.ranAt.slice(0, 10)}. Same ${data.stories.length} stories, same ${data.segments} segments, same verifier prompt and model for every candidate. Nothing here was edited by hand.`, '');

  L.push(`## How the two retrievers were compared`, '');
  L.push(`- **Keyword.** Any story keyword, matched as a whole word, in a segment's title or description. Capped at ${data.keywordMaxCandidates} candidates per story, newest episode first. This is the pipeline's retriever.`);
  L.push(`- **Embedding.** Cosine similarity between the story text and each segment text with \`${data.embedding.model}\` at ${data.embedding.dimension} dimensions. Story text is the title, summary and keywords; segment text is the title and description. The top ${topK} segments per story, then a similarity floor of ${floor}.`);
  L.push(`- **Same input.** Neither retriever sees transcript text. Both read the same segment title and one-sentence description.`);
  L.push(`- **Verified once.** For each story the union of both candidate lists was scored by \`${data.verifier.model}\` at temperature 0 with \`prompts/${data.verifier.prompt}\`, in calls of at most ${data.verifier.chunkSize} candidates. A candidate both retrievers found therefore has one score. Verified means ${minScore} or more.`);
  if (variant === 'context') {
    L.push(`- **Story context.** This verifier was also shown the story's summary, keywords and source headlines, and told that a convo about the same beat but a different event scores at most 6. The production verifier sees only the title and category.`);
  }
  L.push(`- **No floor at verification time.** The whole top ${topK} was verified, so the floor is a filter over already-scored candidates and can be varied below without another model call.`, '');
  L.push(`| | |`, `|---|---|`);
  L.push(`| Verifier calls | ${data.verifier.calls} |`);
  L.push(`| Verifier tokens | ${verifyUsage ? `${verifyUsage.inputTokens} in, ${verifyUsage.outputTokens} out` : 'none'} |`);
  L.push(`| Embedding tokens | ${embedUsage ? `${embedUsage.inputTokens}` : 'none, vectors were already cached'} |`);
  L.push(`| Cost of this comparison at list price | $${estimateCostUsd(data.usage).toFixed(2)} |`, '');

  L.push(`## Totals`, '');
  L.push(`| Retriever | Candidates | Verified | Verified per candidate | Stories with coverage | Shows | Verified that only this retriever found |`);
  L.push(`|---|---|---|---|---|---|---|`);
  const row = (name: string, t: RetrieverTotals, only: boolean) =>
    L.push(`| ${name} | ${t.candidates} | ${t.verified} | ${pct(t.verified, t.candidates)} | ${t.stories} | ${t.shows} | ${only ? t.onlyVerified : ''} |`);
  row('Keyword', s.keyword, true);
  row(`Embedding, top ${topK}, floor ${floor}`, s.embedding, true);
  row('Either', s.union, false);
  row('Both', s.overlap, false);
  if (s.verifiedBelowFloor) {
    L.push('', `${s.verifiedBelowFloor} verified segment${s.verifiedBelowFloor === 1 ? '' : 's'} sat inside the embedding top ${topK} but under the floor, so neither retriever is credited above.`);
  }
  L.push('');

  L.push(`## Story by story`, '');
  L.push(`| Story | Keyword candidates | Embedding candidates | In both | Keyword verified | Embedding verified | Only keyword | Only embedding |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  const perStory = [...s.perStory].sort((a, b) => b.unionVerified - a.unionVerified || b.keyword.candidates - a.keyword.candidates || a.title.localeCompare(b.title));
  for (const p of perStory) {
    L.push(`| ${cell(p.title)} | ${p.keyword.candidates} | ${p.embedding.candidates} | ${p.overlap.candidates} | ${p.keyword.verified} | ${p.embedding.verified} | ${p.keywordOnlyVerified} | ${p.embeddingOnlyVerified} |`);
  }
  L.push('');

  L.push(`## Where they disagree`, '');
  L.push(`Every verified segment that only one retriever surfaced. For keyword-only rows the cosine and rank say how far the embedding retriever was from finding it. Embedding-only rows contain none of the story's keywords by construction.`, '');
  if (dis.length === 0) {
    L.push(`No disagreements: every verified segment was found by both retrievers.`, '');
  } else {
    L.push(`| Story | Found by | Show | Segment | Time | Score | Cosine | Rank of ${data.segments} |`);
    L.push(`|---|---|---|---|---|---|---|---|`);
    for (const d of dis) {
      L.push(`| ${cell(d.storyTitle)} | ${d.foundBy} | ${cell(d.podcastTitle)} | **${cell(d.convoTitle)}** ${cell(d.convoDescription)} | ${hms(d.startTime)} to ${hms(d.endTime)} | ${d.score} | ${sim(d.similarity)} | ${d.rank} |`);
    }
    L.push('');
  }

  L.push(`## Choosing the floor`, '');
  L.push(`Cosine similarity of verified against unverified candidates inside the top ${topK}:`, '');
  L.push(`| | Count | Min | p10 | Median | p90 | Max |`, `|---|---|---|---|---|---|---|`);
  const dist = (name: string, d: Distribution) => L.push(`| ${name} | ${d.count} | ${sim(d.min)} | ${sim(d.p10)} | ${sim(d.median)} | ${sim(d.p90)} | ${sim(d.max)} |`);
  dist(`Verified, score ${minScore} or more`, stats.verifiedInTopK);
  dist('Not verified', stats.unverifiedInTopK);
  L.push('', `The embedding retriever at each floor. "Lost" counts verified segments inside the top ${topK} that the floor removes.`, '');
  L.push(`| Floor | Candidates | Verified | Only embedding | Lost |`, `|---|---|---|---|---|`);
  for (const r of sweep) L.push(`| ${r.floor === 0 ? 'none' : r.floor.toFixed(2)} | ${r.candidates} | ${r.verified} | ${r.onlyVerified} | ${r.verifiedLost} |`);
  L.push('', `The configured floor is ${floor}, set in \`feeds.json\` under \`matching.embedding.minSimilarity\`.`, '');

  L.push(`## Choosing the threshold`, '');
  L.push(`The pipeline keeps scores of ${minScore} and above. Same candidates and same scores at a stricter cutoff:`, '');
  L.push(`| Threshold | Keyword verified | Embedding verified | Only keyword | Only embedding | Either | Both |`, `|---|---|---|---|---|---|---|`);
  for (const r of thresholdSweep(data)) L.push(`| ${r.threshold} | ${r.keyword.verified} | ${r.embedding.verified} | ${r.keyword.onlyVerified} | ${r.embedding.onlyVerified} | ${r.either} | ${r.both} |`);
  L.push('');

  L.push(`## Agreement with the pipeline run`, '');
  L.push(`\`data/matches.json\` holds ${agree.committed} matches from the keyword pipeline. ${agree.rescored} of them were re-scored here, ${agree.reverified} scored ${minScore} or more again and ${agree.dropped.length} did not. ${agree.newlyVerifiedKeyword} keyword candidate${agree.newlyVerifiedKeyword === 1 ? '' : 's'} verified here that had not in the pipeline run. The verifier runs at temperature 0, but a candidate's score moves with the other candidates in its call, so some drift is expected.`, '');
  if (agree.dropped.length) {
    L.push(`| Story | Show | Segment | Pipeline score | Score here |`, `|---|---|---|---|---|`);
    for (const d of agree.dropped) L.push(`| ${cell(d.storyTitle)} | ${cell(d.podcastTitle)} | ${cell(d.convoTitle)} | ${d.committedScore} | ${d.score ?? `under ${minScore}`} |`);
    L.push('');
  }

  if (baseline && baseline.verifier.variant !== variant) {
    const d = againstBaseline(data, baseline);
    L.push(`## Against the ${d.baselineVariant} verifier`, '');
    L.push(`Same candidates in the same chunks; only the prompt differs. "Only ${d.baselineVariant}" is what this verifier stopped passing, "only ${variant}" is what it newly passed.`, '');
    L.push(`| Candidates found by | Verified by both | Only ${d.baselineVariant} | Only ${variant} |`, `|---|---|---|---|`);
    for (const a of ATTRIBUTIONS) { const c = d.byAttribution[a]; L.push(`| ${a[0].toUpperCase()}${a.slice(1)} | ${c.both} | ${c.onlyBaseline} | ${c.onlyThis} |`); }
    L.push(`| All | ${d.all.both} | ${d.all.onlyBaseline} | ${d.all.onlyThis} |`, '');
    if (d.changed.length) {
      L.push(`Every verdict that changed:`, '');
      L.push(`| Story | Found by | Show | Segment | ${d.baselineVariant[0].toUpperCase()}${d.baselineVariant.slice(1)} | ${variant[0].toUpperCase()}${variant.slice(1)} |`, `|---|---|---|---|---|---|`);
      for (const c of d.changed) {
        L.push(`| ${cell(c.storyTitle)} | ${c.foundBy} | ${cell(c.podcastTitle)} | **${cell(c.convoTitle)}** ${cell(c.convoDescription)} | ${c.baselineScore ?? `under ${minScore}`} | ${c.score ?? `under ${minScore}`} |`);
      }
      L.push('');
    }
  }

  L.push(`## Caveats`, '');
  L.push(`- Every number above is graded by the verifier, not by a person. \`data/${comparisonNames(variant).spotCheck}\` lists the disagreements for manual labelling; until that comes back, "verified" means the verifier said ${minScore} or more.`);
  L.push(`- Both retrievers read only the segment title and description. Embedding transcript text would be a different experiment with a different cost.`);
  L.push(`- Candidates were verified in chunks, so a score can depend on its chunk-mates. Both retrievers share the chunks, so the comparison stays fair where absolute scores drift.`);
  L.push(`- Story clustering is not reproducible at temperature 0. This comparison used the committed \`data/stories.json\` and did not re-cluster.`);
  return L.join('\n') + '\n';
}

/**
 * The floor was never applied at verification time, so the configured value in
 * feeds.json is applied here, at render time. Top-K did shape the verified set,
 * so a changed top-K needs `compare --force`.
 */
export function withConfiguredFloor(data: ComparisonData, matching: PipelineConfig['matching']): ComparisonData {
  if (matching.embedding.topK !== data.embedding.topK) {
    log('compare', `feeds.json has topK ${matching.embedding.topK} but the stored comparison verified top ${data.embedding.topK}; run compare --force to redo it`);
  }
  return { ...data, embedding: { ...data.embedding, minSimilarity: matching.embedding.minSimilarity } };
}

export function writeComparisonSamples(outDir: string, data: ComparisonData, baseline?: ComparisonData): { md: string; json: string } {
  const { perStory, ...totals } = summarize(data);
  const baseName = comparisonNames(data.verifier.variant).sampleBase;
  // The committed twin keeps every candidate a retriever surfaced at the configured
  // floor, plus anything the verifier passed. Unverified top-K segments under the
  // floor stay in data/comparison.json, where the floor sweep reads them.
  const stories = data.stories.map((s) => ({
    ...s,
    candidates: s.candidates.filter((c) => {
      const { kw, emb, verified } = flags(c, data, data.embedding.minSimilarity);
      return kw || emb || verified;
    }),
  }));
  const json = path.join(outDir, `${baseName}.json`);
  writeJson(json, {
    ranAt: data.ranAt,
    embedding: data.embedding,
    verifier: data.verifier,
    keywordMaxCandidates: data.keywordMaxCandidates,
    segments: data.segments,
    totals,
    perStory,
    floorSweep: floorSweep(data),
    thresholdSweep: thresholdSweep(data),
    similarity: similarityStats(data),
    disagreements: disagreements(data),
    committedAgreement: committedAgreement(data),
    ...(baseline && baseline.verifier.variant !== data.verifier.variant ? { againstBaseline: againstBaseline(data, baseline) } : {}),
    usage: data.usage,
    costUsd: estimateCostUsd(data.usage),
    candidatesIncluded: 'surfaced by keyword search, by the embedding retriever at the configured floor, or verified',
    stories,
  });
  const md = path.join(outDir, `${baseName}.md`);
  writeFileSync(md, renderComparison(data, baseline));
  return { md, json };
}

/** Disagreements laid out for a person to label. Not committed; lives in data/. */
export function writeSpotCheck(file: string, data: ComparisonData, limit = 20): number {
  const all = disagreements(data);
  const listed = all.slice(0, limit);
  const L: string[] = [];
  L.push(`# Spot check: retrieval disagreements`, '');
  L.push(`Each entry is a segment the verifier scored ${data.verifier.minScore} or more that only one retriever surfaced. Fill in \`label:\` with \`right\` if the segment really covers the story and \`wrong\` if it does not. ${listed.length} of ${all.length} disagreements listed; embedding-only first.`, '');
  listed.forEach((d, i) => {
    L.push(`## ${i + 1}. ${d.storyTitle}`, '');
    L.push(`- Found by: ${d.foundBy} only. Cosine ${sim(d.similarity)}, rank ${d.rank} of ${data.segments}.`);
    L.push(`- Show: ${d.podcastTitle}, episode "${d.episodeTitle}"`);
    L.push(`- Segment: **${d.convoTitle}**, ${hms(d.startTime)} to ${hms(d.endTime)}. ${d.convoDescription}`);
    L.push(`- Verifier score: ${d.score}`);
    L.push(`- label:`, '');
  });
  writeFileSync(file, L.join('\n'));
  return listed.length;
}

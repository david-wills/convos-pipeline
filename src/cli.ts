#!/usr/bin/env node
// Orchestrates the steps. Every step is idempotent over the data directory:
// re-running skips work that already has output, so a failed step can be
// retried without redoing transcription or paying for segmentation twice.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { estimateCostUsd, isClaudeModel, MODELS, usageByStep } from './claude.ts';
import { comparisonFiles, runComparison, summarize, withConfiguredFloor, writeComparisonSamples, writeSpotCheck, type ComparisonData } from './compare.ts';
import { loadConfig, loadDotenv, requireEnv, resolvePaths, type Paths } from './config.ts';
import { buildSegmentIndex, EMBED_MODEL, embedStories, requireVoyageKey } from './embed.ts';
import { ingest } from './ingest.ts';
import { embeddingRetriever, keywordRetriever, matchStories, RETRIEVER_NAMES, unionRetriever, VERIFIER_NAMES, type Retriever, type RetrieverName, type VerifierName } from './match.ts';
import { writeSamples, type RunSummary } from './report.ts';
import { segmentEpisode } from './segment.ts';
import { clusterHeadlines, fetchAllNews, mergeStories } from './stories.ts';
import { SPEECH_MODEL, transcribeAll } from './transcribe.ts';
import type { Episode, EpisodeConvos, Match, NewsItem, PipelineConfig, Story, Transcript } from './types.ts';
import { log, mapLimit, readJson, writeJson } from './util.ts';

const USAGE = `convos-pipeline

Usage: node src/cli.ts <command> [options]

Commands
  ingest      Fetch podcast feeds, select episodes           (free)
  transcribe  Transcribe selected episodes with AssemblyAI   (paid: audio hours)
  segment     Split transcripts into topical segments        (paid: Claude)
  stories     Fetch news feeds, cluster into stories         (paid: Claude, small)
  match       Find and verify segments that cover each story (paid: Claude small, Voyage tiny)
  report      Write samples/ (REPORT.md, JSON) and viz/data.js
  run         All of the above, in order
  compare     Keyword search vs embeddings over existing data  (paid: Claude small, Voyage tiny)

Options
  --config <file>     Feed and selection config   (default: ./feeds.json)
  --data <dir>        Working directory           (default: ./data)
  --out <dir>         Report directory            (default: ./samples)
  --concurrency <n>   Parallel Claude calls       (default: 4)
  --retriever <name>  keyword | embedding | both. Default: matching.retriever in
                      feeds.json (both). embedding and both need VOYAGE_API_KEY
  --verifier <name>   production | context. Default: matching.verifier in
                      feeds.json (context, which shows the verifier the story
                      summary, keywords and headlines)
  --force             Redo steps that already have output
  --help
`;

interface Ctx {
  config: PipelineConfig;
  paths: Paths;
  concurrency: number;
  retriever: RetrieverName;
  verifier: VerifierName;
  force: boolean;
  startedAt: Date;
  notes: string[];
}

async function main(): Promise<void> {
  loadDotenv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'feeds.json' },
      data: { type: 'string', default: 'data' },
      out: { type: 'string', default: 'samples' },
      concurrency: { type: 'string', default: '4' },
      retriever: { type: 'string' },
      verifier: { type: 'string' },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const config = loadConfig(values.config);
  const retriever = values.retriever ?? config.matching.retriever;
  const verifier = values.verifier ?? config.matching.verifier;
  if (!(RETRIEVER_NAMES as readonly string[]).includes(retriever)) {
    console.error(`retriever must be one of ${RETRIEVER_NAMES.join(', ')}, got "${retriever}"`);
    process.exit(1);
  }
  if (!(VERIFIER_NAMES as readonly string[]).includes(verifier)) {
    console.error(`verifier must be one of ${VERIFIER_NAMES.join(', ')}, got "${verifier}"`);
    process.exit(1);
  }
  const ctx: Ctx = {
    config,
    paths: resolvePaths(values.data, values.out),
    concurrency: Math.max(1, parseInt(values.concurrency, 10) || 4),
    retriever: retriever as RetrieverName,
    verifier: verifier as VerifierName,
    force: values.force,
    startedAt: new Date(),
    notes: [],
  };
  mkdirSync(ctx.paths.data, { recursive: true });

  const steps: Record<string, (ctx: Ctx) => Promise<void>> = {
    ingest: stepIngest,
    transcribe: stepTranscribe,
    segment: stepSegment,
    stories: stepStories,
    match: stepMatch,
    report: stepReport,
    compare: stepCompare,
    run: async (c) => {
      for (const step of [stepIngest, stepTranscribe, stepSegment, stepStories, stepMatch, stepReport]) await step(c);
    },
  };
  const step = steps[command];
  if (!step) {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }
  try {
    await step(ctx);
  } finally {
    persistUsage(ctx);
  }
}

/**
 * Fold this process's token tallies into data/claude-usage.json and return the
 * running totals. In-memory tallies are cleared so a second call can't double
 * count. Separate invocations of the steps therefore add up to one run.
 */
function persistUsage(ctx: Ctx): typeof usageByStep {
  const usageFile = path.join(ctx.paths.data, 'claude-usage.json');
  const totals = readJson<typeof usageByStep>(usageFile) ?? {};
  for (const [step, u] of Object.entries(usageByStep)) {
    const p = totals[step] ?? { model: u.model, calls: 0, inputTokens: 0, outputTokens: 0 };
    totals[step] = { model: u.model, calls: p.calls + u.calls, inputTokens: p.inputTokens + u.inputTokens, outputTokens: p.outputTokens + u.outputTokens };
    delete usageByStep[step];
  }
  writeJson(usageFile, totals);
  return totals;
}

// --- steps ------------------------------------------------------------------

async function stepIngest(ctx: Ctx): Promise<void> {
  const existing = new Map((readJson<Episode[]>(ctx.paths.episodes) ?? []).map((e) => [e.id, e]));
  const { selected, perFeed } = await ingest(ctx.config, ctx.startedAt);
  for (const ep of selected) existing.set(ep.id, ep);
  writeJson(ctx.paths.episodes, [...existing.values()]);
  writeJson(path.join(ctx.paths.data, 'ingest-log.json'), { ranAt: ctx.startedAt.toISOString(), perFeed });
  const failed = perFeed.filter((f) => f.error).length;
  log('ingest', `${selected.length} episodes selected from ${perFeed.length - failed} feeds${failed ? ` (${failed} feeds failed)` : ''}; ${existing.size} total in ${ctx.paths.episodes}`);
}

async function stepTranscribe(ctx: Ctx): Promise<void> {
  const apiKey = requireEnv('ASSEMBLYAI_API_KEY');
  const episodes = readJson<Episode[]>(ctx.paths.episodes) ?? [];
  const todo = episodes.filter((ep) => ctx.force || !existsSync(path.join(ctx.paths.transcripts, `${ep.id}.json`)));
  if (todo.length === 0) {
    log('transcribe', 'nothing to do');
    return;
  }
  const minutes = todo.reduce((s, e) => s + (e.duration ?? 0), 0) / 60;
  log('transcribe', `${todo.length} episodes, ~${Math.round(minutes)} minutes of audio`);

  const state = readJson<Record<string, string>>(ctx.paths.transcribeState) ?? {};
  const { completed, failed } = await transcribeAll(
    todo,
    apiKey,
    state,
    (t: Transcript) => writeJson(path.join(ctx.paths.transcripts, `${t.episodeId}.json`), t),
    () => writeJson(ctx.paths.transcribeState, state),
  );
  log('transcribe', `${completed} completed, ${failed.length} failed`);
  if (failed.length) ctx.notes.push(`transcription failed for ${failed.length} episode(s): ${failed.map((f) => f.error).join('; ')}`);
}

async function stepSegment(ctx: Ctx): Promise<void> {
  requireEnv('ANTHROPIC_API_KEY');
  const episodes = readJson<Episode[]>(ctx.paths.episodes) ?? [];
  const todo = episodes.filter((ep) => {
    const hasTranscript = existsSync(path.join(ctx.paths.transcripts, `${ep.id}.json`));
    const hasConvos = existsSync(path.join(ctx.paths.convos, `${ep.id}.json`));
    return hasTranscript && (ctx.force || !hasConvos);
  });
  if (todo.length === 0) {
    log('segment', 'nothing to do');
    return;
  }
  log('segment', `${todo.length} episodes with ${MODELS.segment}`);

  let failures = 0;
  await mapLimit(todo, ctx.concurrency, async (ep) => {
    const transcript = readJson<Transcript>(path.join(ctx.paths.transcripts, `${ep.id}.json`))!;
    try {
      const result = await segmentEpisode(ep, transcript);
      writeJson(path.join(ctx.paths.convos, `${ep.id}.json`), result);
      log('segment', `${ep.podcastTitle} — ${ep.title}: ${result.convos.length} segments`);
    } catch (error) {
      failures++;
      log('segment', `FAILED ${ep.title}: ${(error as Error).message}`);
    }
  });
  if (failures) ctx.notes.push(`segmentation failed for ${failures} episode(s)`);
}

async function stepStories(ctx: Ctx): Promise<void> {
  requireEnv('ANTHROPIC_API_KEY');
  const stories = readJson<Story[]>(ctx.paths.stories) ?? [];
  const seenNews = new Map((readJson<NewsItem[]>(ctx.paths.newsItems) ?? []).map((n) => [n.id, n]));

  const fetched = await fetchAllNews(ctx.config);
  const fresh = fetched.filter((n) => ctx.force || !seenNews.has(n.id));
  for (const n of fetched) seenNews.set(n.id, n);
  writeJson(ctx.paths.newsItems, [...seenNews.values()]);

  // Newest first, in batches of maxHeadlines. Production ran one batch every
  // 30 minutes and merged each into the running story list; a one-shot run
  // just does the batches back to back.
  const sorted = fresh.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
  const batchSize = ctx.config.clustering.maxHeadlines;
  const batches: NewsItem[][] = [];
  for (let i = 0; i < sorted.length; i += batchSize) batches.push(sorted.slice(i, i + batchSize));
  log('stories', `${fetched.length} headlines fetched, ${fresh.length} new, ${batches.length} batch(es) of ≤${batchSize} to ${MODELS.classify}`);
  if (batches.length === 0) {
    log('stories', 'no new headlines; keeping existing stories');
    return;
  }

  const allTouched = new Set<string>();
  for (const [i, batch] of batches.entries()) {
    const clusters = await clusterHeadlines(batch);
    const touched = mergeStories(clusters, stories, ctx.startedAt.toISOString());
    touched.forEach((id) => allTouched.add(id));
    writeJson(ctx.paths.stories, stories);
    log('stories', `batch ${i + 1}/${batches.length}: ${batch.length} headlines -> ${clusters.length} clusters -> ${touched.length} stories touched (${stories.length} total)`);
  }
  for (const s of stories.filter((s) => allTouched.has(s.id))) {
    log('stories', `  • ${s.title} [${s.keywords.join(', ')}]`);
  }
}

async function stepMatch(ctx: Ctx): Promise<void> {
  requireEnv('ANTHROPIC_API_KEY');
  if (ctx.retriever !== 'keyword') requireVoyageKey();
  const episodes = readJson<Episode[]>(ctx.paths.episodes) ?? [];
  const stories = readJson<Story[]>(ctx.paths.stories) ?? [];
  const matches = readJson<Match[]>(ctx.paths.matches) ?? [];
  const convosByEpisode = new Map<string, EpisodeConvos>();
  for (const ep of episodes) {
    const c = readJson<EpisodeConvos>(path.join(ctx.paths.convos, `${ep.id}.json`));
    if (c) convosByEpisode.set(ep.id, c);
  }
  if (stories.length === 0 || convosByEpisode.size === 0) {
    log('match', `nothing to do (${stories.length} stories, ${convosByEpisode.size} segmented episodes)`);
    return;
  }

  const retriever = await buildRetriever(ctx, episodes, stories, convosByEpisode);
  const result = await matchStories(stories, episodes, convosByEpisode, matches, ctx.config, { force: ctx.force, now: ctx.startedAt, retriever, verifier: ctx.verifier });
  writeJson(ctx.paths.stories, stories);
  writeJson(ctx.paths.matches, matches);
  writeJson(path.join(ctx.paths.data, 'match-log.json'), { ranAt: ctx.startedAt.toISOString(), ...result });
  log('match', `${result.storiesProcessed} stories processed with ${result.retriever} retrieval and the ${result.verifier} verifier, ${result.candidatesTotal} candidates, ${result.matchesTotal} verified matches`);
}

/** The keyword retriever needs nothing; the others embed every segment and story first (cached under data/embeddings/). */
async function buildRetriever(ctx: Ctx, episodes: Episode[], stories: Story[], convosByEpisode: Map<string, EpisodeConvos>): Promise<Retriever> {
  const keyword = keywordRetriever(episodes, convosByEpisode, ctx.config);
  if (ctx.retriever === 'keyword') return keyword;
  const index = await buildSegmentIndex(episodes, convosByEpisode, ctx.paths.embeddings);
  const vectors = await embedStories(stories, ctx.paths.embeddings);
  const embedding = embeddingRetriever(index, vectors, ctx.config);
  return ctx.retriever === 'embedding' ? embedding : unionRetriever(keyword, embedding, ctx.config.matching.maxCandidates);
}

/**
 * Run both retrievers over the data the pipeline already produced and write the
 * comparison. Reads stories, segments and matches; writes only data/embeddings/,
 * data/comparison.json, data/spot-check.md and samples/retrieval-comparison.*.
 */
async function stepCompare(ctx: Ctx): Promise<void> {
  const files = comparisonFiles(ctx.paths, ctx.verifier);
  let data = readJson<ComparisonData>(files.data);
  if (data && !ctx.force) {
    log('compare', `${files.data} exists; re-rendering from it with the floor in feeds.json (--force re-runs retrieval and verification)`);
  } else {
    requireVoyageKey();
    requireEnv('ANTHROPIC_API_KEY');
    data = await runComparison(ctx.paths, ctx.config, ctx.startedAt, ctx.verifier);
    writeJson(files.data, data);
  }
  data = withConfiguredFloor(data, ctx.config.matching);
  // A variant verifier is reported against the production one when that has been run.
  const production = ctx.verifier === 'production' ? null : readJson<ComparisonData>(ctx.paths.comparison);
  const { md } = writeComparisonSamples(ctx.paths.out, data, production ? withConfiguredFloor(production, ctx.config.matching) : undefined);
  const listed = writeSpotCheck(files.spotCheck, data);
  const s = summarize(data);
  log('compare', `keyword: ${s.keyword.verified} verified of ${s.keyword.candidates} candidates. embedding (top ${data.embedding.topK}, floor ${s.floor}): ${s.embedding.verified} of ${s.embedding.candidates}. only keyword ${s.keyword.onlyVerified}, only embedding ${s.embedding.onlyVerified}, both ${s.overlap.verified}`);
  log('compare', `wrote ${md}; ${listed} disagreements to label in ${files.spotCheck}`);
}

async function stepReport(ctx: Ctx): Promise<void> {
  const episodes = readJson<Episode[]>(ctx.paths.episodes) ?? [];
  let audioSeconds = 0;
  let transcribed = 0;
  let segmented = 0;
  let latest = readJson<{ ranAt?: string }>(path.join(ctx.paths.data, 'match-log.json'))?.ranAt ?? '';
  for (const ep of episodes) {
    const t = readJson<Transcript>(path.join(ctx.paths.transcripts, `${ep.id}.json`));
    if (t) { transcribed++; audioSeconds += t.audioDuration; }
    const c = readJson<EpisodeConvos>(path.join(ctx.paths.convos, `${ep.id}.json`));
    if (c) { segmented++; if (c.generatedAt > latest) latest = c.generatedAt; }
  }
  if (segmented === 0) {
    throw new Error(`nothing to report: no segmented episodes in ${ctx.paths.data}. Run ingest, transcribe and segment first (samples/ left untouched).`);
  }
  const stories = readJson<Story[]>(ctx.paths.stories) ?? [];
  const matches = readJson<Match[]>(ctx.paths.matches) ?? [];

  // Claude usage from the pipeline steps only. The comparison's own calls are
  // prefixed `compare:` and reported in retrieval-comparison.json instead; a
  // pipeline run with `--retriever embedding` records Voyage tokens separately.
  const usage = persistUsage(ctx);
  const pipeline = Object.entries(usage).filter(([step]) => !step.startsWith('compare:'));
  const claude = Object.fromEntries(pipeline.filter(([, u]) => isClaudeModel(u.model)));
  const embedding = Object.fromEntries(pipeline.filter(([, u]) => !isClaudeModel(u.model)));

  // Stamp the report with when the pipeline last produced data, not when it was rendered,
  // so re-running `report` over unchanged data is a no-op in git.
  const run: RunSummary = {
    ranAt: latest || ctx.startedAt.toISOString(),
    models: { ...MODELS, ...(ctx.retriever === 'keyword' ? {} : { embed: EMBED_MODEL }) },
    transcription: { provider: 'assemblyai', model: SPEECH_MODEL },
    selection: ctx.config.selection,
    matching: { ...ctx.config.matching, retriever: ctx.retriever, verifier: ctx.verifier },
    counts: {
      podcastFeeds: ctx.config.podcasts.length,
      episodesSelected: episodes.length,
      episodesTranscribed: transcribed,
      episodesSegmented: segmented,
      newsFeeds: ctx.config.news.length,
      stories: stories.length,
      storiesWithMatches: stories.filter((s) => s.matchCount > 0).length,
      matches: matches.length,
    },
    audioHours: Math.round((audioSeconds / 3600) * 100) / 100,
    claudeUsage: claude,
    claudeCostUsd: estimateCostUsd(claude),
    ...(Object.keys(embedding).length ? { embeddingUsage: embedding, embeddingCostUsd: estimateCostUsd(embedding) } : {}),
    notes: ctx.notes,
  };
  const { report } = writeSamples(ctx.paths, run, ctx.config.matching);
  log('report', `wrote ${report}`);
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    if (process.env.CONVOS_DEBUG && error.stack) console.error(error.stack);
  } else {
    console.error(error);
  }
  process.exit(1);
});

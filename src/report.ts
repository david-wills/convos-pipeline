// Step 6: turn the data directory into something a person can read without
// running anything: a Markdown report, per-episode JSON with word timings
// stripped, and a data file for the static visualisation.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withConfiguredFloor, writeComparisonSamples, type ComparisonData } from './compare.ts';
import type { Paths } from './config.ts';
import type { Episode, EpisodeConvos, Match, NewsItem, PipelineConfig, Story, Transcript } from './types.ts';
import { readJson, secondsToHhmmss, slugify, writeJson } from './util.ts';

export interface RunSummary {
  ranAt: string;
  models: Record<string, string>;
  transcription: { provider: string; model: string };
  selection: unknown;
  counts: Record<string, number>;
  audioHours: number;
  claudeUsage: unknown;
  claudeCostUsd: number;
  /** Present only when the pipeline itself ran the embedding retriever. */
  embeddingUsage?: unknown;
  embeddingCostUsd?: number;
  notes: string[];
}

export function loadAll(paths: Paths) {
  const episodes = readJson<Episode[]>(paths.episodes) ?? [];
  const stories = readJson<Story[]>(paths.stories) ?? [];
  const matches = readJson<Match[]>(paths.matches) ?? [];
  const newsItems = readJson<NewsItem[]>(paths.newsItems) ?? [];
  const convosByEpisode = new Map<string, EpisodeConvos>();
  const transcriptsByEpisode = new Map<string, Transcript>();
  for (const ep of episodes) {
    const c = readJson<EpisodeConvos>(path.join(paths.convos, `${ep.id}.json`));
    if (c) convosByEpisode.set(ep.id, c);
    const t = readJson<Transcript>(path.join(paths.transcripts, `${ep.id}.json`));
    if (t) transcriptsByEpisode.set(ep.id, t);
  }
  return { episodes, stories, matches, newsItems, convosByEpisode, transcriptsByEpisode };
}

function episodeSlug(ep: Episode): string {
  const date = (ep.pubDate ?? '').slice(0, 10);
  return `${date}-${slugify(ep.podcastTitle, 24)}-${slugify(ep.title, 40)}`;
}

function hms(seconds: number): string {
  return secondsToHhmmss(seconds).replace(/^00:/, '');
}

export function writeSamples(paths: Paths, run: RunSummary, matching: PipelineConfig['matching']): { report: string } {
  const { episodes, stories, matches, newsItems, convosByEpisode, transcriptsByEpisode } = loadAll(paths);
  const out = paths.out;

  // Fresh episodes/ dir so removed episodes don't linger.
  const epDir = path.join(out, 'episodes');
  rmSync(epDir, { recursive: true, force: true });
  mkdirSync(epDir, { recursive: true });

  const episodeFiles = new Map<string, string>();
  const sortedEpisodes = [...episodes].sort((a, b) => (a.pubDate ?? '').localeCompare(b.pubDate ?? ''));
  for (const ep of sortedEpisodes) {
    const convos = convosByEpisode.get(ep.id);
    const transcript = transcriptsByEpisode.get(ep.id);
    if (!convos || !transcript) continue;
    const file = `${episodeSlug(ep)}.json`;
    episodeFiles.set(ep.id, file);
    writeJson(path.join(epDir, file), {
      episode: { ...ep, description: ep.description?.slice(0, 2000) ?? null },
      transcript: {
        provider: transcript.provider,
        model: transcript.model,
        audioDuration: transcript.audioDuration,
        utteranceCount: transcript.utterances.length,
      },
      segmentation: { model: convos.model, generatedAt: convos.generatedAt },
      convos: convos.convos,
      // Word timings dropped to keep the committed sample readable; the
      // pipeline keeps them in data/transcripts/.
      utterances: transcript.utterances.map((u) => ({
        start: Math.round(u.start / 100) / 10,
        end: Math.round(u.end / 100) / 10,
        speaker: u.speaker,
        text: u.text,
      })),
    });
  }

  const rankedStories = [...stories].sort((a, b) => b.trendingScore - a.trendingScore || b.matchCount - a.matchCount);
  const storiesOut = rankedStories.map((s) => ({
    ...s,
    matches: matches
      .filter((m) => m.storyId === s.id)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map((m) => ({ ...m, episodeFile: episodeFiles.get(m.episodeId) ?? null })),
  }));
  writeJson(path.join(out, 'stories.json'), storiesOut);
  writeJson(path.join(out, 'news-items.json'), newsItems);
  writeJson(path.join(out, 'run.json'), run);

  const report = renderReport(run, storiesOut, sortedEpisodes, convosByEpisode, episodeFiles, newsItems);
  writeFileSync(path.join(out, 'REPORT.md'), report);

  // Data for viz/index.html. A JS file so the page works from file:// with no server.
  const vizData = {
    ranAt: run.ranAt,
    stories: storiesOut.map((s) => ({
      id: s.id, title: s.title, summary: s.summary, category: s.category, keywords: s.keywords,
      status: s.status, trendingScore: s.trendingScore, sourceHeadlines: s.sourceHeadlines,
      matches: s.matches.map((m) => ({
        podcastTitle: m.podcastTitle, episodeTitle: m.episodeTitle, convoTitle: m.convoTitle,
        convoDescription: m.convoDescription, relevanceScore: m.relevanceScore,
        startTime: m.startTime, endTime: m.endTime, episodeId: m.episodeId, convoIdx: m.convoIdx,
      })),
    })),
    episodes: sortedEpisodes.map((ep) => ({
      id: ep.id, podcastTitle: ep.podcastTitle, title: ep.title, pubDate: ep.pubDate,
      duration: transcriptsByEpisode.get(ep.id)?.audioDuration ?? ep.duration,
      convos: (convosByEpisode.get(ep.id)?.convos ?? []).map((c) => ({
        index: c.index, title: c.title, startTime: c.startTime, endTime: c.endTime,
      })),
    })),
  };
  const vizDir = path.join(out, '..', 'viz');
  mkdirSync(vizDir, { recursive: true });
  writeFileSync(path.join(vizDir, 'data.js'), `window.CONVOS_DATA = ${JSON.stringify(vizData)};\n`);

  // The retrieval comparison is a separate experiment over the same data; render it when it has been run.
  const comparison = readJson<ComparisonData>(paths.comparison);
  if (comparison) writeComparisonSamples(out, withConfiguredFloor(comparison, matching));

  return { report: path.join(out, 'REPORT.md') };
}

type StoryOut = Story & { matches: (Match & { episodeFile: string | null })[] };

function renderReport(
  run: RunSummary,
  stories: StoryOut[],
  episodes: Episode[],
  convosByEpisode: Map<string, EpisodeConvos>,
  episodeFiles: Map<string, string>,
  newsItems: NewsItem[],
): string {
  const L: string[] = [];
  const podcasts = new Set(episodes.map((e) => e.podcastTitle));
  const withMatches = stories.filter((s) => s.matches.length > 0);
  const multiShow = withMatches.filter((s) => s.podcastCount >= 2);

  L.push(`# Pipeline run report`, '');
  L.push(`Run at ${run.ranAt.slice(0, 16).replace('T', ' ')} UTC. Everything below was produced by the pipeline; nothing was edited by hand.`, '');
  L.push(`| | |`, `|---|---|`);
  L.push(`| Podcast feeds | ${podcasts.size} |`);
  L.push(`| Episodes transcribed and segmented | ${episodes.filter((e) => convosByEpisode.has(e.id)).length} |`);
  L.push(`| Audio processed | ${run.audioHours.toFixed(1)} hours |`);
  L.push(`| Segments produced | ${[...convosByEpisode.values()].reduce((n, c) => n + c.convos.length, 0)} |`);
  L.push(`| Headlines fetched | ${newsItems.length} |`);
  L.push(`| Stories clustered | ${stories.length} |`);
  L.push(`| Stories with verified podcast coverage | ${withMatches.length} |`);
  L.push(`| Stories covered by 2+ different shows | ${multiShow.length} |`);
  L.push(`| Claude cost (list price) | $${run.claudeCostUsd.toFixed(2)} |`);
  L.push('');

  L.push(`## Stories, ranked by trending score`, '');
  L.push(`Trending score = matches × mean relevance × (1 + 0.2 × distinct shows) × decay. Relevance is the verifier's 0–10 score; only ≥7 is kept.`, '');

  for (const s of stories) {
    const shows = new Set(s.matches.map((m) => m.podcastTitle));
    L.push(`### ${s.title}`, '');
    L.push(`${s.summary}`, '');
    L.push(`- **Category:** ${s.category} · **Keywords:** ${s.keywords.map((k) => `\`${k}\``).join(', ')}`);
    L.push(`- **Sources:** ${s.sourceHeadlines.length} headlines from ${new Set(s.sourceHeadlines.map((h) => h.source)).size} outlets`);
    L.push(`- **Podcast coverage:** ${s.matches.length} segment${s.matches.length === 1 ? '' : 's'} across ${shows.size} show${shows.size === 1 ? '' : 's'} · trending ${s.trendingScore} · status ${s.status}`);
    L.push('');
    if (s.sourceHeadlines.length) {
      L.push(`<details><summary>Headlines in this cluster</summary>`, '');
      for (const h of s.sourceHeadlines) L.push(`- ${h.title} — *${h.source}*`);
      L.push('', `</details>`, '');
    }
    if (s.matches.length) {
      L.push(`| Show | Episode | Segment | Time | Score |`, `|---|---|---|---|---|`);
      for (const m of s.matches) {
        const link = m.episodeFile ? `[${m.episodeTitle}](episodes/${m.episodeFile})` : m.episodeTitle;
        L.push(`| ${m.podcastTitle} | ${link} | **${m.convoTitle}** — ${m.convoDescription} | ${hms(m.startTime)}–${hms(m.endTime)} | ${m.relevanceScore} |`);
      }
      L.push('');
    } else {
      L.push(`_No segment passed verification._`, '');
    }
  }

  L.push(`## Episodes and their segments`, '');
  L.push(`One file per episode under \`episodes/\` holds the full segment list plus the speaker-labelled transcript.`, '');
  for (const ep of episodes) {
    const convos = convosByEpisode.get(ep.id);
    if (!convos) continue;
    const file = episodeFiles.get(ep.id);
    L.push(`### ${ep.podcastTitle} — ${file ? `[${ep.title}](episodes/${file})` : ep.title}`, '');
    L.push(`${(ep.pubDate ?? '').slice(0, 10)} · ${convos.convos.length} segments`, '');
    for (const c of convos.convos) {
      L.push(`- \`${hms(c.startTime)}\` **${c.title}** — ${c.description}`);
    }
    L.push('');
  }
  return L.join('\n');
}

export function listEpisodeFiles(outDir: string): string[] {
  try {
    return readdirSync(path.join(outDir, 'episodes')).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

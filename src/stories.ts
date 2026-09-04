// Step 4: news feeds -> clustered "stories" with matching keywords.
//
// "Same story" is defined operationally here: the clustering model groups
// headlines from different outlets that describe the same event, and emits
// 3-6 proper-noun keywords per story. Those keywords drive candidate retrieval
// in the matching step; the story title and summary are what a reader sees.

import { complete, loadPrompt, MODELS, parseJsonArray } from './claude.ts';
import type { ClusteredStory, NewsFeedConfig, NewsItem, PipelineConfig, Story } from './types.ts';
import { channelAndItems, fetchText, normalizeDate, parseXml, text } from './rss.ts';
import { log, sha256 } from './util.ts';

const SYSTEM_PROMPT = loadPrompt('cluster-stories.md');

/** Two shared keywords between a new cluster and an existing story = same story. */
const MERGE_KEYWORD_OVERLAP = 2;

export async function fetchNewsFeed(feed: NewsFeedConfig): Promise<NewsItem[]> {
  const { items } = channelAndItems(parseXml(await fetchText(feed.url)));
  const out: NewsItem[] = [];
  for (const item of items) {
    const title = text(item['title']);
    if (!title) continue;
    out.push({
      id: sha256(`${title}::${feed.sourceName}`),
      title,
      description: text(item['description']) ?? text(item['content:encoded']) ?? null,
      sourceName: feed.sourceName,
      sourceUrl: text(item['link']) ?? text(item['guid']) ?? '',
      category: feed.category,
      pubDate: normalizeDate(text(item['pubDate']) ?? text(item['dc:date']) ?? text(item['updated'])) ?? new Date().toISOString(),
    });
  }
  return out;
}

export async function fetchAllNews(config: PipelineConfig): Promise<NewsItem[]> {
  const results = await Promise.allSettled(config.news.map((feed) => fetchNewsFeed(feed)));
  const seen = new Map<string, NewsItem>();
  results.forEach((result, i) => {
    const feed = config.news[i];
    if (result.status === 'fulfilled') {
      for (const item of result.value) if (!seen.has(item.id)) seen.set(item.id, item);
      log('stories', `${feed.sourceName}: ${result.value.length} headlines`);
    } else {
      log('stories', `FAILED ${feed.sourceName}: ${(result.reason as Error).message}`);
    }
  });
  return [...seen.values()];
}

export async function clusterHeadlines(newsItems: NewsItem[]): Promise<ClusteredStory[]> {
  const headlineList = newsItems.map((item) => `- "${item.title}" (${item.sourceName})`).join('\n');
  const { text: reply, stopReason } = await complete({
    step: 'cluster',
    model: MODELS.classify,
    system: SYSTEM_PROMPT,
    user: `Cluster these ${newsItems.length} headlines into trending stories:\n\n${headlineList}`,
    maxTokens: 8192,
    temperature: 0,
  });
  if (stopReason === 'max_tokens') log('stories', 'WARNING: clustering output truncated');

  const stories = parseJsonArray<ClusteredStory>(reply) ?? [];
  return stories.filter((s) => s.title && Array.isArray(s.keywords) && s.keywords.length > 0);
}

function keywordOverlap(a: string[], b: string[]): number {
  const lower = new Set(b.map((k) => k.toLowerCase()));
  return a.filter((k) => lower.has(k.toLowerCase())).length;
}

/**
 * Fold new clusters into the story list. A cluster that shares two or more
 * keywords with a live story updates that story (headlines and keywords
 * merged) instead of creating a duplicate. Returns the affected story IDs.
 */
export function mergeStories(candidates: ClusteredStory[], stories: Story[], now: string): string[] {
  const touched: string[] = [];
  const live = () => stories.filter((s) => s.status !== 'archived');

  for (const candidate of candidates) {
    const existing = live().find((s) => keywordOverlap(candidate.keywords, s.keywords) >= MERGE_KEYWORD_OVERLAP);
    if (existing) {
      const seenTitles = new Set(existing.sourceHeadlines.map((h) => h.title));
      for (const h of candidate.sourceHeadlines ?? []) {
        if (!seenTitles.has(h.title)) existing.sourceHeadlines.push(h);
      }
      existing.keywords = [...new Set([...existing.keywords, ...candidate.keywords])];
      existing.updatedAt = now;
      existing.matchedAt = null; // re-verify with the wider keyword set
      touched.push(existing.id);
    } else {
      const story: Story = {
        id: sha256(`${candidate.title}::${now}`).slice(0, 12),
        title: candidate.title,
        summary: candidate.summary ?? '',
        category: candidate.category ?? 'general',
        keywords: candidate.keywords,
        sourceHeadlines: candidate.sourceHeadlines ?? [],
        status: 'candidate',
        firstSeenAt: now,
        updatedAt: now,
        matchedAt: null,
        matchCount: 0,
        podcastCount: 0,
        avgRelevance: 0,
        trendingScore: 0,
      };
      stories.push(story);
      touched.push(story.id);
    }
  }
  return touched;
}

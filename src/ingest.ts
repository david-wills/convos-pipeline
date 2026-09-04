// Step 1: podcast feeds -> a bounded, rule-selected episode list.
// Selection is deterministic so the committed sample can't be cherry-picked:
// newest N per feed, inside the window, under the duration cap.

import type { Episode, PipelineConfig } from './types.ts';
import { attr, channelAndItems, fetchText, normalizeDate, parseDuration, parseXml, text, type XmlNode } from './rss.ts';
import { log, sha256 } from './util.ts';

function parseArtwork(itunesImage: unknown, mediaThumbnail?: unknown): string | null {
  return attr(itunesImage, 'href') ?? text(itunesImage) ?? attr(mediaThumbnail, 'url');
}

function parseEnclosure(enclosure: unknown): string | null {
  if (!enclosure) return null;
  const list = Array.isArray(enclosure) ? enclosure : [enclosure];
  for (const enc of list) {
    const type = attr(enc, 'type') ?? '';
    const url = attr(enc, 'url');
    if (url && type.startsWith('audio/')) return url;
  }
  return null;
}

export interface ParsedFeed {
  podcastTitle: string;
  episodes: Omit<Episode, 'id' | 'podcastTitle' | 'feedUrl'>[];
}

export function parsePodcastFeed(xmlText: string): ParsedFeed {
  const { channel, items } = channelAndItems(parseXml(xmlText));
  const podcastTitle = text(channel['title']) ?? text(channel['itunes:title']) ?? 'Unknown Podcast';

  const episodes: ParsedFeed['episodes'] = [];
  for (const item of items) {
    const audioUrl = parseEnclosure(item['enclosure']);
    if (!audioUrl) continue; // not a playable episode

    const guid = text(item['guid']) ?? text(item['id']) ?? audioUrl;
    const title = text(item['title']) ?? text(item['itunes:title']) ?? 'Untitled';
    const description =
      text(item['itunes:summary']) ?? text(item['description']) ?? text(item['content:encoded']) ?? null;
    const pubDate = normalizeDate(text(item['pubDate']) ?? text(item['dc:date']) ?? text(item['published']));
    const duration = parseDuration(item['itunes:duration'] ?? item['duration']);
    const artworkUrl = parseArtwork(item['itunes:image'], item['media:thumbnail']);

    episodes.push({ guid, title, description, pubDate, duration, audioUrl, artworkUrl });
  }
  return { podcastTitle, episodes };
}

export interface IngestResult {
  selected: Episode[];
  perFeed: { feed: string; podcastTitle: string; total: number; eligible: number; selected: number; error?: string }[];
}

export async function ingest(config: PipelineConfig, now = new Date()): Promise<IngestResult> {
  const { sinceDays, maxPerFeed, maxDurationSec } = config.selection;
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();

  const selected: Episode[] = [];
  const perFeed: IngestResult['perFeed'] = [];

  for (const feed of config.podcasts) {
    try {
      const parsed = parsePodcastFeed(await fetchText(feed.url));
      const podcastTitle = feed.name ?? parsed.podcastTitle;

      const eligible = parsed.episodes
        .filter((ep) => ep.pubDate && ep.pubDate >= since)
        .filter((ep) => ep.duration === null || ep.duration <= maxDurationSec)
        .sort((a, b) => (b.pubDate ?? '').localeCompare(a.pubDate ?? ''));

      const picks = eligible.slice(0, maxPerFeed).map((ep) => ({
        id: sha256(ep.audioUrl),
        podcastTitle,
        feedUrl: feed.url,
        ...ep,
      }));

      selected.push(...picks);
      perFeed.push({ feed: feed.url, podcastTitle, total: parsed.episodes.length, eligible: eligible.length, selected: picks.length });
      log('ingest', `${podcastTitle}: ${parsed.episodes.length} items, ${eligible.length} eligible, ${picks.length} selected`);
    } catch (error) {
      const message = (error as Error).message;
      perFeed.push({ feed: feed.url, podcastTitle: feed.name ?? feed.url, total: 0, eligible: 0, selected: 0, error: message });
      log('ingest', `FAILED ${feed.url}: ${message}`);
    }
  }

  return { selected, perFeed };
}

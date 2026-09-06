// Shared data shapes. Everything the pipeline writes to disk is one of these.

export interface PodcastFeedConfig {
  /** Display name override; the feed's own <title> is used when omitted. */
  name?: string;
  url: string;
}

export interface NewsFeedConfig {
  url: string;
  sourceName: string;
  category: string;
}

export interface PipelineConfig {
  podcasts: PodcastFeedConfig[];
  news: NewsFeedConfig[];
  selection: {
    /** Only episodes published within this many days of the run are eligible. */
    sinceDays: number;
    /** Newest N eligible episodes per feed. */
    maxPerFeed: number;
    /** Skip episodes longer than this (cost control). */
    maxDurationSec: number;
  };
  clustering: {
    /** Newest N headlines handed to the clustering model in one call. */
    maxHeadlines: number;
  };
  matching: {
    /** Verification score (0-10) required to keep a candidate. */
    minScore: number;
    /** Cap on candidates sent to the verifier per story. */
    maxCandidates: number;
    /** Knobs for the optional embedding retriever (`match --retriever` and `compare`). */
    embedding: {
      /** Segments per story, best cosine similarity first. */
      topK: number;
      /** Drop candidates under this cosine similarity even inside the top K. */
      minSimilarity: number;
    };
  };
}

export interface Episode {
  /** sha256 of the audio URL. Stable across runs and feeds. */
  id: string;
  podcastTitle: string;
  feedUrl: string;
  guid: string;
  title: string;
  description: string | null;
  pubDate: string | null;
  duration: number | null;
  audioUrl: string;
  artworkUrl: string | null;
}

/** Word-level timing from the transcription provider. Times in milliseconds. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

/** A speaker turn. Times in milliseconds. */
export interface Utterance {
  text: string;
  start: number;
  end: number;
  speaker: string;
  words: Word[];
}

export interface Transcript {
  episodeId: string;
  transcriptId: string;
  provider: 'assemblyai';
  model: string;
  /** Seconds. */
  audioDuration: number;
  utterances: Utterance[];
}

/** One topical segment of an episode. Times in seconds. */
export interface Convo {
  index: number;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  /** First ~15 non-filler words spoken at startTime; used for on-device re-alignment. */
  anchorPhrase: string;
}

export interface EpisodeConvos {
  episodeId: string;
  model: string;
  generatedAt: string;
  convos: Convo[];
}

export interface NewsItem {
  /** sha256 of title + source. */
  id: string;
  title: string;
  description: string | null;
  sourceName: string;
  sourceUrl: string;
  category: string;
  pubDate: string;
}

/** What the clustering model returns for one story. */
export interface ClusteredStory {
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  sourceHeadlines: { title: string; source: string }[];
}

export type StoryStatus = 'candidate' | 'active' | 'archived';

export interface Story extends ClusteredStory {
  id: string;
  status: StoryStatus;
  firstSeenAt: string;
  updatedAt: string;
  /** Set once the matcher has run for this story. */
  matchedAt: string | null;
  matchCount: number;
  podcastCount: number;
  avgRelevance: number;
  trendingScore: number;
}

export interface Match {
  storyId: string;
  episodeId: string;
  convoIdx: number;
  relevanceScore: number;
  convoTitle: string;
  convoDescription: string;
  episodeTitle: string;
  podcastTitle: string;
  startTime: number;
  endTime: number;
  audioUrl: string;
}

export interface ModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

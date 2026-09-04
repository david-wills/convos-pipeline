// Step 3: transcript -> topical segments ("convos").
//
// The model sees the whole episode as timestamped speaker turns plus the feed
// metadata, and returns start times with headline-style titles. Post-processing
// snaps each start to the nearest utterance boundary, derives end times from
// the next start, and records a short anchor phrase for on-device re-alignment.

import { complete, loadPrompt, MODELS, parseJsonArray } from './claude.ts';
import type { Convo, Episode, EpisodeConvos, Transcript, Utterance } from './types.ts';
import { extractAnchorPhrase, hhmmssToSeconds, secondsToHhmmss } from './util.ts';

const SYSTEM_PROMPT = loadPrompt('segment.md');

/** Only snap to a boundary if the model's timestamp is within this many seconds of one. */
const SNAP_WINDOW_SEC = 30;

/**
 * Diarization sometimes returns one utterance for a whole monologue, which
 * leaves the model with no timestamps to anchor boundaries to. Split anything
 * longer than this at a sentence end (hard cap at 2x) using word timings.
 */
const MAX_UTTERANCE_SEC = 45;

interface RawConvo { start: string; title: string; description: string }

export function splitLongUtterances(utterances: Utterance[]): Utterance[] {
  const out: Utterance[] = [];
  for (const utt of utterances) {
    if ((utt.end - utt.start) / 1000 <= MAX_UTTERANCE_SEC || utt.words.length < 2) {
      out.push(utt);
      continue;
    }
    let chunk: Utterance['words'] = [];
    const flush = () => {
      if (chunk.length === 0) return;
      out.push({
        text: chunk.map((w) => w.text).join(' '),
        start: chunk[0].start,
        end: chunk[chunk.length - 1].end,
        speaker: utt.speaker,
        words: chunk,
      });
      chunk = [];
    };
    for (const word of utt.words) {
      chunk.push(word);
      const elapsed = (word.end - chunk[0].start) / 1000;
      const sentenceEnd = /[.?!]["']?$/.test(word.text);
      if ((elapsed >= MAX_UTTERANCE_SEC && sentenceEnd) || elapsed >= MAX_UTTERANCE_SEC * 2) flush();
    }
    flush();
  }
  return out;
}

export function buildTranscriptPrompt(episode: Episode, transcript: Transcript): string {
  const lines: string[] = [];
  lines.push(`Podcast: ${episode.podcastTitle}`);
  lines.push(`Episode: ${episode.title}`);
  if (episode.description) lines.push(`Description: ${stripHtml(episode.description).slice(0, 1500)}`);
  if (transcript.audioDuration) lines.push(`Duration: ${Math.round(transcript.audioDuration / 60)} minutes`);
  lines.push('', '--- TRANSCRIPT ---', '');
  for (const utt of splitLongUtterances(transcript.utterances)) {
    lines.push(`[${secondsToHhmmss(utt.start / 1000)}] ${utt.speaker}: ${utt.text}`);
  }
  return lines.join('\n');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function segmentEpisode(episode: Episode, transcript: Transcript): Promise<EpisodeConvos> {
  const { text, stopReason } = await complete({
    step: 'segment',
    model: MODELS.segment,
    system: SYSTEM_PROMPT,
    user: buildTranscriptPrompt(episode, transcript),
    maxTokens: 4096,
  });
  if (stopReason === 'max_tokens') {
    throw new Error('Segmentation output truncated at max_tokens');
  }

  const raw = parseJsonArray<RawConvo>(text);
  if (!raw || raw.length === 0) throw new Error(`Could not parse segments: ${text.slice(0, 200)}`);
  for (const r of raw) {
    if (!r.start || !r.title) throw new Error(`Invalid segment entry: ${JSON.stringify(r)}`);
  }

  return {
    episodeId: episode.id,
    model: MODELS.segment,
    generatedAt: new Date().toISOString(),
    convos: postProcess(raw, splitLongUtterances(transcript.utterances), transcript.audioDuration),
  };
}

export function postProcess(raw: RawConvo[], utterances: Utterance[], audioDuration: number): Convo[] {
  const sorted = raw
    .map((r) => ({ ...r, startSeconds: hhmmssToSeconds(r.start) }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  // Rule 1 of the prompt, enforced: the first segment covers the top of the show.
  if (sorted.length > 0 && sorted[0].startSeconds > 0) sorted[0].startSeconds = 0;

  const convos: Convo[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startTime = snapToUtteranceBoundary(sorted[i].startSeconds, utterances);
    const endTime = i < sorted.length - 1
      ? snapToUtteranceBoundary(sorted[i + 1].startSeconds, utterances)
      : audioDuration;
    convos.push({
      index: i,
      title: sorted[i].title,
      description: sorted[i].description ?? '',
      startTime,
      endTime,
      anchorPhrase: anchorPhraseAt(startTime, utterances),
    });
  }
  return convos;
}

export function snapToUtteranceBoundary(targetSeconds: number, utterances: Utterance[]): number {
  if (utterances.length === 0) return targetSeconds;
  let closest = utterances[0].start / 1000;
  let closestDist = Math.abs(closest - targetSeconds);
  for (const utt of utterances) {
    const start = utt.start / 1000;
    const dist = Math.abs(start - targetSeconds);
    if (dist < closestDist) {
      closestDist = dist;
      closest = start;
    }
    if (start > targetSeconds && dist > closestDist) break; // past the target and diverging
  }
  return closestDist <= SNAP_WINDOW_SEC ? closest : targetSeconds;
}

/** The first words spoken at (or just before) the boundary, regardless of which utterance holds them. */
function anchorPhraseAt(startSeconds: number, utterances: Utterance[]): string {
  const words: { text: string }[] = [];
  for (const utt of utterances) {
    if (utt.end / 1000 < startSeconds - 1) continue;
    for (const w of utt.words) {
      if (w.start / 1000 >= startSeconds - 1) words.push(w);
      if (words.length >= 40) break; // plenty for 15 non-filler words
    }
    if (words.length >= 40) break;
  }
  return extractAnchorPhrase(words);
}

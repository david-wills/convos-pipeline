// Step 2: audio URL -> speaker-labelled utterances with word timings.
// Uses AssemblyAI's async API: submit, then poll. Transcript IDs are persisted
// as soon as they're issued so an interrupted run resumes without paying twice.

import type { Episode, Transcript, Utterance } from './types.ts';
import { log, sleep } from './util.ts';

const BASE_URL = 'https://api.assemblyai.com/v2';
export const SPEECH_MODEL = 'universal-3-pro';

export class PermanentError extends Error {
  override name = 'PermanentError';
}

interface AAIWord { text: string; start: number; end: number; confidence: number; speaker: string | null }
interface AAIUtterance { text: string; start: number; end: number; speaker: string; words: AAIWord[] }
interface AAITranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  utterances?: AAIUtterance[];
  audio_duration?: number;
  error?: string;
}

export async function submitTranscription(audioUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/transcript`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: [SPEECH_MODEL],
      speaker_labels: true,
      language_code: 'en',
    }),
  });
  if (!response.ok) {
    throw new Error(`AssemblyAI submit failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function fetchTranscript(transcriptId: string, apiKey: string): Promise<AAITranscript> {
  const response = await fetch(`${BASE_URL}/transcript/${transcriptId}`, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    throw new Error(`AssemblyAI poll failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as AAITranscript;
}

export async function waitForTranscript(
  transcriptId: string,
  apiKey: string,
  { maxAttempts = 180, intervalMs = 5000 } = {},
): Promise<AAITranscript> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const data = await fetchTranscript(transcriptId, apiKey);
    if (data.status === 'completed') return data;
    if (data.status === 'error') throw new PermanentError(`AssemblyAI failed: ${data.error ?? 'unknown error'}`);
    await sleep(intervalMs);
  }
  throw new Error(`AssemblyAI polling timed out after ${(maxAttempts * intervalMs) / 1000}s`);
}

export function toTranscript(episode: Episode, data: AAITranscript): Transcript {
  if (!data.utterances) throw new PermanentError('Transcript completed but has no utterances');
  const utterances: Utterance[] = data.utterances.map((u) => ({
    text: u.text,
    start: u.start,
    end: u.end,
    speaker: u.speaker || 'Unknown',
    words: u.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  }));
  return {
    episodeId: episode.id,
    transcriptId: data.id,
    provider: 'assemblyai',
    model: SPEECH_MODEL,
    audioDuration: data.audio_duration ?? (utterances.at(-1)?.end ?? 0) / 1000,
    utterances,
  };
}

/**
 * Transcribe every episode that lacks a transcript. `state` maps episodeId to an
 * already-issued transcript ID so re-runs resume rather than resubmit.
 */
export async function transcribeAll(
  episodes: Episode[],
  apiKey: string,
  state: Record<string, string>,
  onDone: (transcript: Transcript) => void,
  onState: () => void,
): Promise<{ completed: number; failed: { episodeId: string; error: string }[] }> {
  // Submit everything first: AssemblyAI processes in parallel server-side.
  for (const ep of episodes) {
    if (state[ep.id]) continue;
    try {
      state[ep.id] = await submitTranscription(ep.audioUrl, apiKey);
      onState();
      log('transcribe', `submitted ${ep.podcastTitle} — ${ep.title}`);
    } catch (error) {
      log('transcribe', `submit FAILED for ${ep.title}: ${(error as Error).message}`);
    }
  }

  let completed = 0;
  const failed: { episodeId: string; error: string }[] = [];
  const pending = episodes.filter((ep) => state[ep.id]);

  await Promise.all(
    pending.map(async (ep) => {
      try {
        const data = await waitForTranscript(state[ep.id], apiKey);
        onDone(toTranscript(ep, data));
        completed++;
        log('transcribe', `done ${ep.podcastTitle} — ${ep.title} (${Math.round((data.audio_duration ?? 0) / 60)} min)`);
      } catch (error) {
        const message = (error as Error).message;
        failed.push({ episodeId: ep.id, error: message });
        if (error instanceof PermanentError) delete state[ep.id]; // allow a fresh submit next run
        onState();
        log('transcribe', `FAILED ${ep.title}: ${message}`);
      }
    }),
  );

  return { completed, failed };
}

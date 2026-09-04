// Thin wrapper over the Anthropic SDK: prompt loading, per-step usage accounting,
// and the lenient JSON-array parser the pipeline has always needed.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelUsage } from './types.ts';

const PROMPT_DIR = path.join(import.meta.dirname, '..', 'prompts');

export function loadPrompt(name: string): string {
  return readFileSync(path.join(PROMPT_DIR, name), 'utf8');
}

/**
 * Two tiers: a stronger model for the one generative task (segment titles and
 * boundaries from a full transcript) and a cheaper one for the two
 * classification-shaped tasks (cluster headlines, score candidates).
 */
export const MODELS = {
  segment: process.env.CONVOS_SEGMENT_MODEL ?? 'claude-sonnet-4-6',
  classify: process.env.CONVOS_CLASSIFY_MODEL ?? 'claude-haiku-4-5-20251001',
};

/** USD per million tokens; used only for the cost estimate in run.json. */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export const usageByStep: Record<string, ModelUsage & { model: string }> = {};

export function estimateCostUsd(usage: Record<string, ModelUsage & { model: string }> = usageByStep): number {
  let total = 0;
  for (const u of Object.values(usage)) {
    const price = PRICING[u.model];
    if (!price) continue;
    total += (u.inputTokens * price.input + u.outputTokens * price.output) / 1_000_000;
  }
  return Math.round(total * 10000) / 10000;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
    }
    client = new Anthropic({ maxRetries: 5 });
  }
  return client;
}

export interface CompletionRequest {
  step: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface Completion {
  text: string;
  stopReason: string | null;
}

export async function complete(req: CompletionRequest): Promise<Completion> {
  const response = await getClient().messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  });

  const tally = (usageByStep[req.step] ??= { model: req.model, calls: 0, inputTokens: 0, outputTokens: 0 });
  tally.calls += 1;
  tally.inputTokens += response.usage.input_tokens;
  tally.outputTokens += response.usage.output_tokens;

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return { text, stopReason: response.stop_reason };
}

/**
 * Parse a JSON array out of model text. Handles markdown fences and trailing
 * prose after the closing bracket (both have happened in production).
 */
export function parseJsonArray<T>(text: string): T[] | null {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    // fall through to the balanced-bracket scan
  }
  const start = cleaned.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          return Array.isArray(parsed) ? (parsed as T[]) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

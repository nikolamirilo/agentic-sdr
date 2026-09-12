import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";
import { query } from "@/lib/db/client";

/**
 * One model layer for the whole app. Graph nodes call in here rather than
 * touching a provider SDK, so swapping providers is one file and every call
 * is accounted against the run's token budget.
 */

export class BudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super(`Run budget exceeded: ${reason}`);
    this.name = "BudgetExceededError";
  }
}

type ModelTier = "default" | "fast";

let cached: { default: LanguageModel; fast: LanguageModel } | undefined;

function resolveModels(): { default: LanguageModel; fast: LanguageModel } {
  if (cached) return cached;

  if (env.xaiApiKey) {
    const xai = createXai({ apiKey: env.xaiApiKey });
    cached = {
      default: xai(env.modelId ?? "grok-4.6"),
      fast: xai(env.fastModelId ?? env.modelId ?? "grok-4.6"),
    };
  } else if (env.anthropicApiKey) {
    const anthropic = createAnthropic({ apiKey: env.anthropicApiKey });
    cached = {
      default: anthropic(env.modelId ?? "claude-opus-5"),
      fast: anthropic(env.fastModelId ?? "claude-haiku-4-5-20251001"),
    };
  } else if (env.openaiApiKey) {
    const openai = createOpenAI({ apiKey: env.openaiApiKey });
    cached = {
      default: openai(env.modelId ?? "gpt-5"),
      fast: openai(env.fastModelId ?? env.modelId ?? "gpt-5-mini"),
    };
  } else {
    throw new Error(
      "No model provider configured. Set XAI_API_KEY (or GROK_API_KEY), ANTHROPIC_API_KEY, or OPENAI_API_KEY."
    );
  }
  return cached;
}

export function model(tier: ModelTier = "default"): LanguageModel {
  return resolveModels()[tier];
}

export function hasModelProvider(): boolean {
  return Boolean(env.xaiApiKey || env.anthropicApiKey || env.openaiApiKey);
}

// --- usage accounting -----------------------------------------------------

type Usage = { inputTokens?: number; outputTokens?: number };

async function recordUsage(runId: string | undefined, usage: Usage): Promise<void> {
  if (!runId) return;
  await query(
    `insert into run_usage (run_id, input_tokens, output_tokens, model_calls)
     values ($1, $2, $3, 1)
     on conflict (run_id) do update set
       input_tokens  = run_usage.input_tokens  + excluded.input_tokens,
       output_tokens = run_usage.output_tokens + excluded.output_tokens,
       model_calls   = run_usage.model_calls   + 1,
       updated_at    = now()`,
    [runId, Math.max(0, usage.inputTokens ?? 0), Math.max(0, usage.outputTokens ?? 0)]
  ).catch((error) => console.error("[llm] usage write failed", error));
}

/** Cheap guard called at the top of every loop turn, not on every call. */
export async function assertTokenBudget(runId: string): Promise<void> {
  const rows = await query<{ total: string }>(
    `select coalesce(input_tokens + output_tokens, 0)::text as total from run_usage where run_id = $1`,
    [runId]
  );
  const total = Number(rows[0]?.total ?? 0);
  if (total > env.budgetTokens) {
    throw new BudgetExceededError(`token spend ${total} over cap ${env.budgetTokens}`);
  }
}

export async function getRunUsage(runId: string) {
  const rows = await query<{
    input_tokens: string;
    output_tokens: string;
    model_calls: number;
    tool_calls: number;
  }>(`select input_tokens::text, output_tokens::text, model_calls, tool_calls from run_usage where run_id = $1`, [
    runId,
  ]);
  const row = rows[0];
  return {
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    modelCalls: row?.model_calls ?? 0,
    toolCalls: row?.tool_calls ?? 0,
  };
}

export async function recordToolCall(runId: string | undefined, count = 1): Promise<void> {
  if (!runId) return;
  await query(
    `insert into run_usage (run_id, tool_calls) values ($1, $2)
     on conflict (run_id) do update set tool_calls = run_usage.tool_calls + excluded.tool_calls, updated_at = now()`,
    [runId, count]
  ).catch(() => {});
}

// --- generation -----------------------------------------------------------

export type GenerateJsonOptions<T> = {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Attributes the spend to a run. */
  runId?: string;
  tier?: ModelTier;
  temperature?: number;
  maxOutputTokens?: number;
};

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<T> {
  const result = await generateObject({
    model: model(opts.tier ?? "default"),
    schema: opts.schema,
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: 2,
  });
  await recordUsage(opts.runId, result.usage ?? {});
  return result.object as T;
}

export type GenerateProseOptions = {
  system: string;
  prompt: string;
  runId?: string;
  tier?: ModelTier;
  temperature?: number;
  maxOutputTokens?: number;
};

export async function generateProse(opts: GenerateProseOptions): Promise<string> {
  const result = await generateText({
    model: model(opts.tier ?? "default"),
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: opts.maxOutputTokens,
    maxRetries: 2,
  });
  await recordUsage(opts.runId, result.usage ?? {});
  return result.text;
}

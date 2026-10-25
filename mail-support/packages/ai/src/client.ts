import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnalysisSchema, DraftSchema, PermanentError, TransientError, type Analysis, type Draft } from "@ms/shared";
import type { z } from "zod";
import { CLASSIFY_SYSTEM, DRAFT_SYSTEM, PROMPT_VERSION } from "./prompts";
import { buildClassifyContent, buildDraftContent, type ClassifyInput, type DraftInput } from "./messages";
import { looksLikeInjection } from "./sanitize";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiUsage {
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AiResult<T> {
  output: T;
  usage: AiUsage;
}

/** L'IA a refusé de traiter la demande : le ticket passe en validation humaine. */
export class AiRefusalError extends PermanentError {
  override name = "AiRefusalError";
}

/** Interface implémentée par le client Claude et par les doublures de test. */
export interface AiProvider {
  classify(input: ClassifyInput): Promise<AiResult<Analysis>>;
  draft(input: DraftInput): Promise<AiResult<Draft>>;
}

export interface ClaudeOptions {
  apiKey?: string;
  model: string;
  classifyEffort: Effort;
  draftEffort: Effort;
  /** Repli serveur si le modèle refuse (politique de sécurité). */
  fallbacks: boolean;
  client?: Anthropic;
}

export class ClaudeProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(private readonly opts: ClaudeOptions) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey || undefined, maxRetries: 2, timeout: 120_000 });
  }

  async classify(input: ClassifyInput): Promise<AiResult<Analysis>> {
    const res = await this.call(CLASSIFY_SYSTEM, buildClassifyContent(input), AnalysisSchema, this.opts.classifyEffort, 4000);
    const analysis = { ...res.output, confidence: clamp01(res.output.confidence) };
    // Double sécurité : l'heuristique locale peut aussi lever le drapeau.
    if (!analysis.injectionSuspected && looksLikeInjection(`${input.subject}\n${input.body}`)) {
      analysis.injectionSuspected = true;
      analysis.injectionEvidence = analysis.injectionEvidence ?? "Motif suspect détecté par l'heuristique locale";
    }
    return { output: analysis, usage: res.usage };
  }

  async draft(input: DraftInput): Promise<AiResult<Draft>> {
    const res = await this.call(DRAFT_SYSTEM, buildDraftContent(input), DraftSchema, this.opts.draftEffort, 8000);
    return { output: { ...res.output, confidence: clamp01(res.output.confidence), body: res.output.body.trim() }, usage: res.usage };
  }

  private async call<S extends z.ZodType>(system: string, content: string, schema: S, effort: Effort, maxTokens: number) {
    const started = Date.now();
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.opts.model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
        output_config: { effort, format: betaZodOutputFormat(schema) },
        ...(this.opts.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (err) {
      throw mapError(err);
    }

    if (response.stop_reason === "refusal") {
      throw new AiRefusalError(`Refus du modèle (${response.stop_details?.category ?? "sans catégorie"})`);
    }
    if (response.stop_reason === "max_tokens") throw new TransientError("Réponse IA tronquée (max_tokens)");
    const parsed = response.parsed_output as z.infer<S> | null;
    if (!parsed) throw new TransientError("Sortie IA invalide (schéma non respecté)");

    return {
      output: parsed,
      usage: {
        model: response.model,
        promptVersion: PROMPT_VERSION,
        inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - started,
      },
    };
  }
}

function mapError(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new TransientError(`API Claude indisponible : ${(err as Error).message}`);
  }
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 408 || err.status === 409)) {
    return new TransientError(`API Claude surchargée : ${err.message}`);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new PermanentError(`Clé API Claude invalide : ${err.message}`);
  }
  if (err instanceof Anthropic.BadRequestError) return new PermanentError(`Requête Claude invalide : ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

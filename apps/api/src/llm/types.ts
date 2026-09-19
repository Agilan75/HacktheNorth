/**
 * The one small LLM interface, so the provider can be swapped (PRD §9.1).
 * FROZEN after Run 0 (W0-3).
 *
 * `generateJson({ prompt, parts?, schema: { zod, response }, callName })` is the
 * whole surface. `schema.response` is the provider-enforced `responseSchema`
 * sent with `application/json`; `schema.zod` validates what comes back. One
 * retry, then graceful degrade — never an unchecked object.
 *
 * No LLM decides a verdict, a score or a dollar amount: these types carry prose
 * and typed values only, and every numeric result is re-checked by code.
 */

import type { ZodType } from 'zod';
import type { LlmCallName } from '@retrofit/contracts';

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

export interface LlmTextPart {
  readonly kind: 'text';
  readonly text: string;
}

export interface LlmImagePart {
  readonly kind: 'image';
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly dataBase64: string;
  /** e.g. `frame 3, bearing 120°`. Included in the prompt, never in the bytes. */
  readonly label?: string;
}

export interface LlmPdfPart {
  readonly kind: 'pdf';
  readonly mimeType: 'application/pdf';
  readonly dataBase64: string;
  readonly filename?: string;
}

export type LlmPart = LlmTextPart | LlmImagePart | LlmPdfPart;

/* -------------------------------------------------------------------------- */
/* Response schema (provider-enforced)                                        */
/* -------------------------------------------------------------------------- */

export type ResponseSchemaType =
  | 'STRING'
  | 'NUMBER'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'ARRAY'
  | 'OBJECT';

/**
 * A structural, provider-neutral description of the enforced response shape.
 * Declared here rather than imported from `@google/genai` so that swapping the
 * provider never touches this file.
 */
export interface ResponseSchemaNode {
  readonly type: ResponseSchemaType;
  readonly description?: string;
  readonly nullable?: boolean;
  readonly enum?: readonly string[];
  readonly items?: ResponseSchemaNode;
  readonly properties?: Readonly<Record<string, ResponseSchemaNode>>;
  readonly required?: readonly string[];
  /** Keeps object key order stable, which keeps outputs reproducible. */
  readonly propertyOrdering?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface LlmSchema<T> {
  /** Validated after the call. A failure costs one retry, then degrades. */
  readonly zod: ZodType<T>;
  /** Sent to the provider as `responseSchema` with `application/json`. */
  readonly response: ResponseSchemaNode;
}

/* -------------------------------------------------------------------------- */
/* Request and result                                                         */
/* -------------------------------------------------------------------------- */

export interface GenerateJsonRequest<T> {
  /** One of the eight permitted calls. There is no ninth. */
  readonly callName: LlmCallName;
  readonly prompt: string;
  readonly parts?: readonly LlmPart[];
  readonly schema: LlmSchema<T>;
  readonly systemInstruction?: string;
  /**
   * Thinking is on by default and costs tokens before the answer starts, so
   * this must stay generous and `MAX_TOKENS` is a retryable diagnostic.
   */
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** Abort the whole call, including retries. */
  readonly signal?: AbortSignal;
}

export type LlmFinishReason = 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'OTHER';

export interface LlmUsage {
  readonly promptTokens: number | null;
  readonly outputTokens: number | null;
  readonly thoughtTokens: number | null;
}

export interface GenerateJsonResult<T> {
  readonly data: T;
  /** The model that actually answered, after any fall-through in the chain. */
  readonly model: string;
  readonly attempts: number;
  readonly finishReason: LlmFinishReason;
  readonly usage: LlmUsage | null;
  /** True when the schema never validated and a safe default was returned. */
  readonly degraded: boolean;
  readonly durationMs: number;
}

/** Any request, for code that handles calls generically (logging, fakes). */
export type AnyGenerateJsonRequest = GenerateJsonRequest<unknown>;

export interface LlmProvider {
  /** `gemini`, `fake`, and nothing else in phase 1. */
  readonly name: string;
  /** False when `GEMINI_API_KEY` is unset. The API still starts (PRD §9.1). */
  readonly configured: boolean;
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>>;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class LlmError extends Error {
  readonly callName: LlmCallName;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      readonly callName: LlmCallName;
      readonly retryable?: boolean;
      readonly status?: number | null;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LlmError';
    this.callName = options.callName;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

/** Raised when no provider is configured and no fake was injected. */
export class LlmUnavailableError extends LlmError {
  constructor(callName: LlmCallName) {
    super(`no LLM provider configured for call "${callName}"`, {
      callName,
      retryable: false,
    });
    this.name = 'LlmUnavailableError';
  }
}

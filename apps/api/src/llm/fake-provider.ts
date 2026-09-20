/**
 * The deterministic fake LLM provider. IMPLEMENTED in Run 0 (W0-3) and frozen.
 *
 * Every offline test in the repository uses this: no network, no `Date.now`,
 * no `Math.random`, no clock of any kind. The same `callName` always produces
 * the same object, and every canned object is validated against the caller's
 * own `schema.zod` before it is returned — so a fake that drifts out of shape
 * fails loudly in the unit that owns the schema, not silently three units later.
 *
 * Tests that need a different answer pass `overrides` (per call) or `handler`
 * (per request). Tests that need a failure pass `failFor`.
 */

import type { LlmCallName } from '@retrofit/contracts';
import type {
  AnyGenerateJsonRequest,
  GenerateJsonRequest,
  GenerateJsonResult,
  LlmProvider,
} from './types';
import { LlmError } from './types';

/** The fake never measures time; every result reports this duration. */
export const FAKE_DURATION_MS = 0;
export const FAKE_MODEL = 'fake-deterministic-1';

/**
 * One canned answer per permitted call. Shapes match
 * `@retrofit/contracts`'s `LlmCallOutput<N>` exactly.
 */
export const CANNED_RESPONSES: Readonly<Record<LlmCallName, unknown>> = {
  observe: {
    frames: [
      {
        index: 0,
        usable: true,
        reason: 'clear view of the room',
        ceilingVisible: true,
        objects: [
          {
            label: 'portable_heater',
            category: 'heat_source',
            box_2d: [620, 140, 880, 360],
            distanceBand: 'near',
            confidence: 0.86,
            notes: 'free-standing electric heater on the floor',
          },
          {
            label: 'curtain',
            category: 'combustible',
            box_2d: [120, 180, 720, 340],
            distanceBand: 'near',
            confidence: 0.81,
            notes: 'floor-length fabric curtain beside the heater',
          },
        ],
      },
      {
        index: 1,
        usable: true,
        reason: 'clear view of the ceiling',
        ceilingVisible: true,
        objects: [
          {
            label: 'smoke_detector',
            category: 'protection',
            box_2d: [40, 460, 120, 560],
            distanceBand: 'far',
            confidence: 0.74,
            notes: 'ceiling-mounted detector, indicator not visible',
          },
        ],
      },
    ],
  },
  relate: {
    hazards: [
      {
        hazardKey: 'heaterNearCombustible',
        present: true,
        confidence: 0.78,
        reason: 'the heater and the curtain share a bearing and a distance band',
        observationIds: ['obs-1', 'obs-2'],
      },
    ],
  },
  'verify-fix': {
    stillPresent: false,
    confidence: 0.88,
    reason: 'the heater is no longer within reach of the curtain',
  },
  narrate: {
    text:
      'This account is in appetite on TIV and state but out on premium. ' +
      'The appetite score is 84 with a predicted premium of $88,000. ' +
      'Recommend review before quoting.',
  },
  'schema-assist': {
    mappings: [
      {
        rawPath: 'exposure_units.location.buildings.year_built',
        canonicalPath: 'buildings.yearBuilt',
        confidence: 0.95,
        reason: 'exact semantic match on a building construction year',
      },
    ],
  },
  'draft-request': {
    subject: 'Information needed to complete our review',
    body:
      'Hello,\n\nTo finish our review we need the year built for Building C; ' +
      'it decides the building-age factor. Please reply with that value when ' +
      'you can.\n\nThank you.',
  },
  'extract-reply': {
    values: [
      {
        canonicalPath: 'buildings.yearBuilt',
        value: 1978,
        confidence: 0.92,
        quote: 'Building C was built in 1978.',
      },
    ],
    notFound: [],
  },
  'second-opinion': {
    verdict: 'REFER',
    decidingFactor: 'building_age',
    reasoning:
      'At least one building predates 1990, which the guidelines flag for referral.',
  },
  identify: {
    items: [
      { label: 'sofa', name: 'grey three-seat fabric sofa', brand: null, model: null, confidence: 0.9 },
      { label: 'tv', name: 'wall-mounted TV', brand: 'Samsung', model: null, confidence: 0.8 },
    ],
  },
};

export interface RecordedCall {
  readonly callName: LlmCallName;
  readonly prompt: string;
  readonly partKinds: readonly string[];
  readonly systemInstruction: string | null;
}

export interface FakeLlmOptions {
  /** Replaces the canned answer for a call. */
  readonly overrides?: Partial<Record<LlmCallName, unknown>>;
  /**
   * Per-request answer. Returning `undefined` falls through to `overrides`,
   * then to `CANNED_RESPONSES`.
   */
  readonly handler?: (request: AnyGenerateJsonRequest) => unknown;
  /** These calls throw a retryable `LlmError`, for degrade-path tests. */
  readonly failFor?: readonly LlmCallName[];
  /** Skip the zod check. Only for tests that deliberately return bad data. */
  readonly validate?: boolean;
  /** Reported as `degraded` on every result. Defaults to false. */
  readonly degraded?: boolean;
}

export interface FakeLlmProvider extends LlmProvider {
  readonly name: 'fake';
  /** Every call made, in order. */
  calls(): readonly RecordedCall[];
  callsFor(callName: LlmCallName): readonly RecordedCall[];
  reset(): void;
}

const partKind = (part: { readonly kind: string }): string => part.kind;

/**
 * Builds a fake provider. Safe to share across tests in one file; call
 * `reset()` between cases that assert on `calls()`.
 */
export function createFakeLlm(options: FakeLlmOptions = {}): FakeLlmProvider {
  const { overrides = {}, handler, failFor = [], validate = true, degraded = false } = options;
  const recorded: RecordedCall[] = [];

  const generateJson = async <T>(
    request: GenerateJsonRequest<T>,
  ): Promise<GenerateJsonResult<T>> => {
    recorded.push({
      callName: request.callName,
      prompt: request.prompt,
      partKinds: (request.parts ?? []).map(partKind),
      systemInstruction: request.systemInstruction ?? null,
    });

    if (failFor.includes(request.callName)) {
      throw new LlmError(`fake provider was asked to fail "${request.callName}"`, {
        callName: request.callName,
        retryable: true,
        status: 503,
      });
    }

    const fromHandler =
      handler === undefined ? undefined : handler(request as AnyGenerateJsonRequest);
    const candidate =
      fromHandler !== undefined
        ? fromHandler
        : (overrides[request.callName] ?? CANNED_RESPONSES[request.callName]);

    if (candidate === undefined) {
      throw new LlmError(`fake provider has no canned answer for "${request.callName}"`, {
        callName: request.callName,
        retryable: false,
      });
    }

    let data: T;
    if (validate) {
      const parsed = request.schema.zod.safeParse(candidate);
      if (!parsed.success) {
        throw new LlmError(
          `fake answer for "${request.callName}" does not match its schema: ` +
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')} ${issue.message}`)
              .join('; '),
          { callName: request.callName, retryable: false },
        );
      }
      data = parsed.data;
    } else {
      data = candidate as T;
    }

    return {
      data,
      model: FAKE_MODEL,
      attempts: 1,
      finishReason: 'STOP',
      usage: null,
      degraded,
      durationMs: FAKE_DURATION_MS,
    };
  };

  return {
    name: 'fake',
    configured: true,
    generateJson,
    calls: () => recorded.slice(),
    callsFor: (callName) => recorded.filter((call) => call.callName === callName),
    reset: () => {
      recorded.length = 0;
    },
  };
}

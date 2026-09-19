/**
 * `npm run rating:fit` — fits the commercial rating table from the snapshot and
 * writes the frozen `rating/commercial.json`. Body owned by Run 1 unit E15.
 *
 * This is the ONLY writer of that file. The engine never calls it; it runs once,
 * by hand, and its output is committed.
 *
 * Usage: rating:fit [--dry-run] [--out <path>] [--fitted-at <iso>]
 *                   [--max-iterations <n>] [--tolerance <x>]
 *
 * Training rows come from `realCases()` (the committed snapshot, never the
 * network). Each policy's technical premium is spread over its buildings by
 * TIV share (docs/decisions/E15.md D-1). The error written to the table is
 * re-measured per POLICY by running the real `priceCommercial` on each
 * submission, so the number on screen is the engine's own error, n = policies.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  CanonicalSubmission,
  CommercialRatingTable,
  FeatureVector,
  Sourced,
  VectorSpec,
} from '../types.js';
import { fitError, fitMonotonic } from '../fit/least-squares.js';
import type { FitRow } from '../fit/least-squares.js';
import { commercialPriors } from '../fit/priors.js';
import { realCases } from '../fixtures/real.js';
import { rollup } from '../stages/rollup.js';
import { priceCommercial } from '../stages/price.js';
import { bestValue } from '../util/fields.js';
import { isFiniteNumber } from '../util/math.js';

const DEFAULT_MAX_ITERATIONS = 500;
const DEFAULT_TOLERANCE = 1e-10;
const DEFAULT_OUT = fileURLToPath(new URL('../../rating/commercial.json', import.meta.url));

const USAGE =
  'usage: rating:fit [--dry-run] [--out <path>] [--fitted-at <iso>] [--max-iterations <n>] [--tolerance <x>]';

interface Args {
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly out: string;
  readonly fittedAt: string | null;
  readonly maxIterations: number;
  readonly tolerance: number;
}

function parseArgs(argv: readonly string[]): Args | string {
  let dryRun = false;
  let help = false;
  let out = DEFAULT_OUT;
  let fittedAt: string | null = null;
  let maxIterations = DEFAULT_MAX_ITERATIONS;
  let tolerance = DEFAULT_TOLERANCE;
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] as string;
    const [flag, inline] = raw.includes('=') ? raw.split(/=(.*)/s, 2) : [raw, undefined];
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined) return null;
      i += 1;
      return next;
    };
    switch (flag) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--out': {
        const v = value();
        if (v === null || v === '') return '--out needs a path';
        out = v;
        break;
      }
      case '--fitted-at': {
        const v = value();
        if (v === null || Number.isNaN(Date.parse(v))) return '--fitted-at needs an ISO date';
        fittedAt = v;
        break;
      }
      case '--max-iterations': {
        const v = Number(value());
        if (!Number.isInteger(v) || v < 1) return '--max-iterations needs a positive integer';
        maxIterations = v;
        break;
      }
      case '--tolerance': {
        const v = Number(value());
        if (!isFiniteNumber(v) || v <= 0) return '--tolerance needs a positive number';
        tolerance = v;
        break;
      }
      default:
        return `unknown argument: ${raw}`;
    }
  }
  return { dryRun, help, out, fittedAt, maxIterations, tolerance };
}

function pick<T>(field: Sourced<T> | undefined): T | null {
  const best = bestValue(field);
  return best === null ? null : best.value;
}

function num(field: Sourced<number> | undefined): number | null {
  const v = pick(field);
  return isFiniteNumber(v) ? v : null;
}

/** Submission with its rollup attached (rollup is needed for the loss band). */
function withRollup(s: CanonicalSubmission): CanonicalSubmission {
  if (s.rollup !== undefined) return s;
  const asOf = pick(s.receivedDate) ?? pick(s.effectiveDate);
  if (asOf === null) return s;
  try {
    return { ...s, rollup: rollup(s, asOf) };
  } catch {
    return s;
  }
}

/** One row per building with a known TIV and year, premium spread by TIV share. */
function rowsFor(s: CanonicalSubmission): FitRow[] {
  const technical = num(s.pricing.technicalPremium);
  if (technical === null || technical <= 0) return [];
  const usable = s.buildings
    .map((b) => ({ b, tiv: num(b.tiv), year: num(b.yearBuilt) }))
    .filter((x) => x.tiv !== null && x.tiv > 0 && x.year !== null);
  const totalTiv = usable.reduce((acc, x) => acc + (x.tiv as number), 0);
  if (totalTiv <= 0) return [];
  const loss = s.rollup?.fiveYearLoss;
  const fiveYearLoss = isFiniteNumber(loss) ? loss : Number.NaN;
  return usable.map(({ b, tiv, year }) => {
    let protectionClass = num(b.protectionClass);
    if (protectionClass === null && b.locationExternalId !== undefined) {
      const loc = s.locations.find((l) => l.externalId === b.locationExternalId);
      protectionClass = loc === undefined ? null : num(loc.protectionClass);
    }
    return {
      tiv: tiv as number,
      constructionClass: pick(b.constructionType) ?? '',
      yearBuilt: year as number,
      protectionClass,
      sprinklered: pick(b.sprinklered),
      fiveYearLoss,
      technicalPremium: (technical * (tiv as number)) / totalTiv,
    };
  });
}

const EMPTY_VECTOR: FeatureVector = {
  lineOfBusiness: 'commercial_property',
  specVersion: 'rating-fit',
  x: [],
  t: [],
  m: [],
};
const EMPTY_SPEC: VectorSpec = {
  lineOfBusiness: 'commercial_property',
  version: 'rating-fit',
  components: [],
};

export async function main(_argv: readonly string[]): Promise<number> {
  const args = parseArgs(_argv);
  if (typeof args === 'string') {
    console.error(`rating:fit: ${args}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  let submissions: CanonicalSubmission[];
  try {
    submissions = realCases()
      .filter((c) => c.hasPolicy && c.submission.lineOfBusiness === 'commercial_property')
      .map((c) => withRollup(c.submission));
  } catch (err) {
    console.error(
      `rating:fit: cannot load the snapshot cases: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  const policies = submissions.filter((s) => rowsFor(s).length > 0);
  const rows = policies.flatMap(rowsFor);
  if (rows.length === 0) {
    console.error('rating:fit: no policy carries a technical premium and a building with TIV and year');
    return 1;
  }

  const { table: fitted, error: rowError } = fitMonotonic(rows, {
    monotonicOrder: commercialPriors(),
    maxIterations: args.maxIterations,
    tolerance: args.tolerance,
  });

  // Policy-level error through the runtime pricing path.
  const actual: number[] = [];
  const predicted: number[] = [];
  for (const s of policies) {
    const technical = num(s.pricing.technicalPremium);
    const out = priceCommercial(EMPTY_VECTOR, EMPTY_SPEC, fitted, s);
    if (technical === null || out.predictedPremium === null) continue;
    actual.push(technical);
    predicted.push(out.predictedPremium);
  }
  const policyError = fitError(actual, predicted);

  const table: CommercialRatingTable = {
    ...fitted,
    fitError: policyError,
    ...(args.fittedAt === null ? {} : { fittedAt: args.fittedAt }),
  };
  const json = `${JSON.stringify(table, null, 2)}\n`;

  console.log(
    `rating:fit: ${String(policies.length)} policies, ${String(rows.length)} buildings; ` +
      `policy MAPE ${(policyError.mape * 100).toFixed(1)}%, R² ${policyError.r2.toFixed(3)} ` +
      `(building rows: MAPE ${(rowError.mape * 100).toFixed(1)}%, R² ${rowError.r2.toFixed(3)})`,
  );

  if (args.dryRun) {
    console.log(json);
    return 0;
  }
  writeFileSync(args.out, json, 'utf8');
  console.log(`rating:fit: wrote ${args.out}`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}

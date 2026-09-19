/** Step 2 of PRD §7.5: collect the fields the rules need. Body: Run 1 unit F08. */
import type {
  FactorId,
  RatingTable,
  Rule,
  Rulebook,
  VectorComponentSpec,
  VectorSpec,
} from '@retrofit/engine';
import type { NeededField, TraceRuleNeed } from '../types';

export interface CollectInput {
  readonly spec: VectorSpec;
  readonly rulebook: Rulebook;
  readonly extensions?: Rulebook | undefined;
  readonly ratingTable?: RatingTable | undefined;
}

/* -------------------------------------------------------------------------- */
/* Private vocabulary — canonical (engine) paths only, never Federato names.   */
/* -------------------------------------------------------------------------- */

const TIV = 'buildings[].tiv';
const YEAR_BUILT = 'buildings[].yearBuilt';
const CONSTRUCTION = 'buildings[].constructionType';
const SPRINKLERED = 'buildings[].sprinklered';
const BUILDING_PC = 'buildings[].protectionClass';
const LOCATION_PC = 'locations[].protectionClass';
const LOCATION_STATE = 'locations[].state';
const LOSS_INPUTS: readonly string[] = [
  'history[].dateOfLoss',
  'history[].paidIndemnity',
  'history[].paidExpense',
  'history[].reserves',
  'receivedDate',
];

/**
 * Stage-3 rollup outputs -> the canonical inputs engine rollup reads to build
 * them. A rollup value is never in the schema; the fields under it are.
 */
const ROLLUP_INPUTS: Readonly<Record<string, readonly string[]>> = {
  totalTiv: [TIV],
  buildingCount: [TIV],
  tivKnownBuildingCount: [TIV],
  pctTivPre1990: [YEAR_BUILT, TIV],
  pctTivPost2010: [YEAR_BUILT, TIV],
  pre1990BuildingIds: [YEAR_BUILT, TIV],
  oldestYearBuilt: [YEAR_BUILT],
  newestYearBuilt: [YEAR_BUILT],
  pctTivByConstruction: [CONSTRUCTION, TIV],
  pctTivAcceptableConstruction: [CONSTRUCTION, TIV],
  pctTivSprinklered: [SPRINKLERED, TIV],
  tivWeightedProtectionClass: [BUILDING_PC, LOCATION_PC, TIV],
  primaryState: [LOCATION_STATE, TIV],
  stateShares: [LOCATION_STATE, TIV],
  fiveYearLoss: LOSS_INPUTS,
  fiveYearClaimCount: LOSS_INPUTS,
  claimCount: ['history[].dateOfLoss'],
  lossWindow: ['receivedDate'],
};

/** Commercial rating columns -> the building/claim facts `price` reads. */
const COMMERCIAL_RATING_INPUTS: Readonly<Record<string, readonly string[]>> = {
  baseRate: [TIV],
  construction: [CONSTRUCTION, TIV],
  age: [YEAR_BUILT],
  protectionClass: [BUILDING_PC, LOCATION_PC],
  sprinkler: [SPRINKLERED],
  lossHistory: ['rollup.fiveYearLoss'],
};

/** Tenant rating columns -> the vector component keys `priceTenant` reads. */
const TENANT_RATING_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  contents: ['contentsLimit'],
  buildingAge: ['buildingYearBuilt'],
  term: ['termMonths'],
  smokeDetector: ['smokeDetectorCount'],
};

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

interface Need {
  readonly base: string;
  readonly need: TraceRuleNeed;
  readonly componentKey: string | null;
  readonly factor: FactorId | null;
  readonly required: boolean;
}

/** `buildings[0].yearBuilt` and `buildings[].yearBuilt` are the same field. */
function normalizePath(path: string): string {
  return path.trim().replace(/\[\d+\]/g, '[]');
}

/** A path the rule reads -> the base canonical fields that feed it. */
function baseInputs(path: string, seen: ReadonlySet<string> = new Set()): readonly string[] {
  const p = normalizePath(path);
  if (!p.startsWith('rollup.')) return [p];
  if (seen.has(p)) return [];
  const key = p.slice('rollup.'.length).split('.')[0] ?? '';
  const inputs = ROLLUP_INPUTS[key];
  // An unknown rollup key stays as itself so locate reports it unmapped.
  if (inputs === undefined) return [p];
  const next = new Set(seen);
  next.add(p);
  return inputs.flatMap((i) => baseInputs(i, next));
}

function componentFor(
  spec: VectorSpec,
  field: string,
): VectorComponentSpec | null {
  const byKey = spec.components.find((c) => c.key === field);
  if (byKey !== undefined) return byKey;
  const norm = normalizePath(field);
  return spec.components.find((c) => normalizePath(c.source) === norm) ?? null;
}

function derivationNote(readPath: string, base: string): string {
  return normalizePath(readPath) === base ? '' : ` (${readPath} is derived from ${base})`;
}

function rulesOf(input: CollectInput): readonly Rule[] {
  const line = input.spec.lineOfBusiness;
  const all = [...input.rulebook.rules, ...(input.extensions?.rules ?? [])];
  return all.filter((r) => r.lineOfBusiness === line);
}

function ruleNeeds(input: CollectInput): Need[] {
  const out: Need[] = [];
  for (const rule of rulesOf(input)) {
    for (const cond of rule.when) {
      const component = componentFor(input.spec, cond.field);
      const readPath = component === null ? cond.field : component.source;
      const factor: FactorId | null = component?.factor ?? rule.factor;
      const label = component === null ? cond.field : `${component.key} (${component.source})`;
      for (const base of baseInputs(readPath)) {
        out.push({
          base,
          componentKey: component?.key ?? null,
          factor,
          required: component?.required === true,
          need: {
            ruleId: rule.id,
            factor,
            canonicalPath: readPath,
            why:
              `${rule.id} (${rule.factor}, ${rule.tier}) tests ${label} ${cond.op}` +
              `${cond.value === undefined ? '' : ` ${JSON.stringify(cond.value)}`}` +
              derivationNote(readPath, base) +
              '.',
          },
        });
      }
    }
  }
  return out;
}

function componentNeeds(spec: VectorSpec): Need[] {
  const out: Need[] = [];
  for (const c of spec.components) {
    for (const base of baseInputs(c.source)) {
      out.push({
        base,
        componentKey: c.key,
        factor: c.factor,
        required: c.required,
        need: {
          ruleId: `vector:${c.key}`,
          factor: c.factor,
          canonicalPath: c.source,
          why: `Vector component ${c.key} ("${c.label}") reads ${c.source}${derivationNote(c.source, base)}.`,
        },
      });
    }
  }
  return out;
}

function ratingNeeds(input: CollectInput): Need[] {
  const table = input.ratingTable;
  if (table === undefined || table.lineOfBusiness !== input.spec.lineOfBusiness) return [];
  const out: Need[] = [];
  const push = (column: string, readPath: string, componentKey: string | null, factor: FactorId | null) => {
    for (const base of baseInputs(readPath)) {
      out.push({
        base,
        componentKey,
        factor,
        required: false,
        need: {
          ruleId: `rating:${column}`,
          factor,
          canonicalPath: readPath,
          why: `Rating table ${table.version} column "${column}" reads ${readPath}${derivationNote(readPath, base)}.`,
        },
      });
    }
  };

  if (table.lineOfBusiness === 'commercial_property') {
    for (const [column, paths] of Object.entries(COMMERCIAL_RATING_INPUTS)) {
      for (const p of paths) push(column, p, null, null);
    }
    return out;
  }

  const columns: [string, readonly string[]][] = Object.entries(TENANT_RATING_COMPONENTS).map(
    ([column, keys]) => [column, keys],
  );
  // Hazard factors address components whose source is `hazards.<key>`.
  const hazardKeys = Object.keys(table.hazards ?? {});
  const hazardComponents = input.spec.components
    .filter((c) => hazardKeys.some((k) => normalizePath(c.source) === `hazards.${k}`))
    .map((c) => c.key);
  columns.push(['hazards', hazardComponents]);

  for (const [column, keys] of columns) {
    for (const key of keys) {
      const c = input.spec.components.find((x) => x.key === key);
      if (c === undefined) continue;
      push(column, c.source, c.key, c.factor);
    }
  }
  return out;
}

function single<T>(values: readonly (T | null)[]): T | null {
  const distinct = [...new Set(values.filter((v): v is T => v !== null))];
  return distinct.length === 1 ? (distinct[0] as T) : null;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Walks every rule condition and every rating factor and returns the canonical
 * paths they read, each carrying the rules that need it.
 */
export function collectNeededFields(input: CollectInput): readonly NeededField[] {
  const needs = [...ruleNeeds(input), ...ratingNeeds(input), ...componentNeeds(input.spec)];

  const byBase = new Map<string, Need[]>();
  for (const n of needs) {
    const list = byBase.get(n.base);
    if (list === undefined) byBase.set(n.base, [n]);
    else list.push(n);
  }

  const result: NeededField[] = [];
  for (const [base, list] of byBase) {
    const seen = new Set<string>();
    const requiredBy: TraceRuleNeed[] = [];
    for (const n of list) {
      const id = `${n.need.ruleId}\u0000${n.need.canonicalPath}`;
      if (seen.has(id)) continue;
      seen.add(id);
      requiredBy.push(n.need);
    }
    requiredBy.sort(
      (a, b) => a.ruleId.localeCompare(b.ruleId) || a.canonicalPath.localeCompare(b.canonicalPath),
    );
    result.push({
      canonicalPath: base,
      componentKey: single(list.map((n) => n.componentKey)),
      factor: single(list.map((n) => n.factor)),
      requiredBy,
      required: list.some((n) => n.required),
    });
  }
  return result.sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
}

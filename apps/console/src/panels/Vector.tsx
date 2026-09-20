import type { ReactElement } from 'react';

import { formatMoney, formatPercent, formatScore } from '@retrofit/contracts';

import { Badge } from '../components/atoms/Badge.js';
import type { VectorComponentView, VectorPanelProps } from './types.js';

/** Component keys whose raw value is US dollars (PRD 6.4 components 3, 4, 8). */
const USD_KEYS: ReadonlySet<string> = new Set(['totalTiv', 'quotedPremium', 'fiveYearLoss']);
/** Component keys whose raw value is a 0/1 flag (PRD 6.4 components 0, 1). */
const FLAG_KEYS: ReadonlySet<string> = new Set(['isNewBusiness', 'isPropertyLine']);
/** PRD 6.4 component 2: 0 out, 1 acceptable, 2 target. */
const STATE_TIER_LABEL: Readonly<Record<number, string>> = {
  0: 'out of appetite',
  1: 'acceptable',
  2: 'target',
};
/** INTERPRETATIONS T-SPAN: the only multi-component factor in vectors/commercial.json. */
const BUILDING_AGE_KEYS: readonly string[] = ['pctTivPre1990', 'pctTivPost2010'];

/** Raw value in its own unit. Formatting only; the value is never changed. */
function formatRaw(c: VectorComponentView): string {
  if (c.raw === null || c.mask === 0) return 'Missing';
  const raw = c.raw;
  if (USD_KEYS.has(c.key)) return formatMoney(raw);
  if (FLAG_KEYS.has(c.key)) return raw === 1 ? '1 (yes)' : raw === 0 ? '0 (no)' : formatScore(raw, { decimals: 2 });
  if (c.key === 'stateTier') {
    const label = STATE_TIER_LABEL[raw];
    return label !== undefined ? `${formatScore(raw)} (${label})` : formatScore(raw, { decimals: 2 });
  }
  if (c.key.startsWith('pct')) return formatPercent(raw, { decimals: 1 });
  if (c.key === 'tivWeightedProtectionClass') return formatScore(raw, { decimals: 1 });
  return Number.isInteger(raw) ? formatScore(raw) : formatScore(raw, { decimals: 3 });
}

/**
 * INTERPRETATIONS T-BLANK: the components of the four factors whose Target
 * column is blank (submission type, line of business, construction type, loss
 * value). Tier 1 there is the engine's Acceptable, as panel (b) prints it.
 */
const BLANK_TARGET_KEYS: ReadonlySet<string> = new Set([
  'isNewBusiness',
  'isPropertyLine',
  'pctTivAcceptableConstruction',
  'fiveYearLoss',
]);

function tierName(key: string, tier: number): string | null {
  if (tier === 1) return BLANK_TARGET_KEYS.has(key) ? 'Acceptable' : 'Target';
  if (tier === 0.6) return 'Acceptable';
  if (tier === 0) return 'Not acceptable';
  return null;
}

function formatTier(c: VectorComponentView): string {
  if (!c.appetiteFactor) return 'Not scored';
  if (c.mask === 0) return 'Missing';
  if (c.tier === null) return 'No tier';
  const name = tierName(c.key, c.tier);
  const value = formatScore(c.tier, { decimals: c.tier === 0 || c.tier === 1 ? 0 : 1 });
  return name !== null ? `${value} · ${name}` : value;
}

/** INTERPRETATIONS G-3: a known appetite component with tier 0 sets the knockout mask. */
function isKnockout(c: VectorComponentView): boolean {
  return c.appetiteFactor && c.mask === 1 && c.tier === 0;
}

/**
 * PRD 10 (h) The feature vector itself: raw, tier and mask.
 *
 * Renders the three parallel arrays of PRD 6.4 (`x`, `t`, `m`) plus the scaled
 * value peers and flip read. Every number comes from `vector`; nothing is
 * recomputed (PRD 10, 13).
 */
export function Vector(props: VectorPanelProps): ReactElement {
  const { vector } = props;
  const components = [...vector.components].sort((a, b) => a.index - b.index);
  const known = components.filter((c) => c.mask === 1).length;
  const keys = new Set(components.map((c) => c.key));
  const spansBuildingAge = BUILDING_AGE_KEYS.every((k) => keys.has(k));
  // The scaled column is shown only when the API sent scaled values; it is never filled in here.
  const showScaled = components.some((c) => c.scaled !== null);

  return (
    <div className="rf-panel rf-vector" data-testid="vector-panel">
      <dl className="rf-stats">
        <div className="rf-stat" data-testid="vector-lob">
          <dt>Line of business</dt>
          <dd>{vector.lineOfBusiness}</dd>
        </div>
        <div className="rf-stat" data-testid="vector-spec">
          <dt>Vector spec</dt>
          <dd>{`v${vector.specVersion}`}</dd>
        </div>
        <div className="rf-stat" data-testid="vector-completeness">
          <dt>Completeness</dt>
          <dd>{formatPercent(vector.completeness, { from: 'percent', decimals: 1 })}</dd>
        </div>
        <div className="rf-stat" data-testid="vector-known">
          <dt>Components known</dt>
          <dd>{`${known} of ${components.length}`}</dd>
        </div>
      </dl>

      {components.length === 0 ? (
        <p className="rf-empty">No feature vector was built for this submission.</p>
      ) : (
        <div className="rf-table-wrap rf-scroll-x">
          <table className="rf-table" aria-label="Feature vector">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Component</th>
                <th scope="col">Raw (x)</th>
                <th scope="col">Tier (t)</th>
                <th scope="col">Mask (m)</th>
                {showScaled ? <th scope="col">Scaled</th> : null}
                <th scope="col">Movable</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                const knockout = isKnockout(c);
                return (
                  <tr
                    key={`${c.index}-${c.key}`}
                    data-testid={`vector-row-${c.key}`}
                    data-mask={c.mask}
                    data-knockout={knockout ? 'true' : 'false'}
                  >
                    <td>{c.index}</td>
                    <th scope="row">
                      <span>{c.label}</span>{' '}
                      <code className="rf-code" style={{ opacity: 0.7 }}>
                        {c.key}
                      </code>
                    </th>
                    <td
                      data-testid={`vector-raw-${c.key}`}
                      title={c.raw !== null ? String(c.raw) : undefined}
                    >
                      {formatRaw(c)}
                    </td>
                    <td data-testid={`vector-tier-${c.key}`}>
                      {formatTier(c)}
                      {knockout ? (
                        <>
                          {' '}
                          <Badge
                            label="Knockout"
                            tone="attention"
                            title="A known appetite component at tier 0 sets the knockout (DOES_NOT_FIT)."
                          />
                        </>
                      ) : null}
                    </td>
                    <td data-testid={`vector-mask-${c.key}`}>{c.mask === 1 ? '1 · known' : '0 · missing'}</td>
                    {showScaled ? (
                      <td data-testid={`vector-scaled-${c.key}`}>
                        {c.scaled !== null ? formatScore(c.scaled, { decimals: 3 }) : c.mask === 0 ? 'Missing' : 'Not scaled'}
                      </td>
                    ) : null}
                    <td data-testid={`vector-movable-${c.key}`}>{c.immovable ? 'Immovable' : 'Movable'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ul className="rf-notes" aria-label="How to read the vector">
        <li>
          Tier values are 0 (Not acceptable), 0.6 (Acceptable) and 1 (Target); where the guidelines leave
          Target blank (submission type, line of business, construction, loss value), Acceptable scores 1. A missing component is
          never imputed: it scores 0 points, lowers completeness and forces REFER.
        </li>
        {spansBuildingAge ? (
          <li data-testid="vector-tspan-note">
            Components 5 and 6 both carry the building-age tier; the appetite score counts that factor
            once, over eight factors, not eleven components.
          </li>
        ) : null}
        <li>Immovable components are never proposed by the flip. “Not scored” components feed pricing and peers only.</li>
      </ul>
    </div>
  );
}

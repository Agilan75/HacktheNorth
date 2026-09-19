import type { WilsonInterval } from './types.js';

/**
 * Wilson score interval for the layer-C agreement rate (V07).
 *
 * `successes` of `trials` agreed; the interval is two-sided at `confidence`
 * (default 0.95, z = 1.959963984540054). With zero trials there is no
 * information, so the point is 0 and the interval is the whole of [0, 1].
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  confidence: number = 0.95,
): WilsonInterval {
  if (!Number.isInteger(trials) || trials < 0) {
    throw new RangeError(`wilsonInterval: trials must be a non-negative integer, got ${trials}`);
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) {
    throw new RangeError(
      `wilsonInterval: successes must be an integer in [0, ${trials}], got ${successes}`,
    );
  }
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new RangeError(`wilsonInterval: confidence must be in (0, 1), got ${confidence}`);
  }
  if (trials === 0) return { point: 0, low: 0, high: 1, n: 0, confidence };

  const n = trials;
  const p = successes / n;
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  // The closed-form bounds touch 0 and 1 exactly at p = 0 and p = 1; pin them
  // there so floating-point noise never reports 0.9999999999 for a clean sweep.
  const low = successes === 0 ? 0 : clamp01(centre - half);
  const high = successes === n ? 1 : clamp01(centre + half);
  return { point: p, low, high, n, confidence };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Inverse standard-normal CDF (Acklam's rational approximation, relative error
 * below 1.2e-9). Private: the verify package shares no numeric helpers with
 * the engine.
 */
function normalQuantile(prob: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let x: number;
  if (prob < pLow) {
    const q = Math.sqrt(-2 * Math.log(prob));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (prob <= 1 - pLow) {
    const q = prob - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - prob));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  return x;
}

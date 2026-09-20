/**
 * TEMPORARY — the launch-to-price budget instrument.
 *
 * The budget is: launch to a price on screen in under 60 seconds on device.
 * `markLaunch()` runs when the viewfinder mounts, `markVerdict()` when the
 * verdict screen first paints a price. The elapsed time is printed once per
 * run. Delete this file and both call sites once the number is recorded.
 */

const LABEL = 'launch->verdict';

let launchedAtMs: number | null = null;
let reported = false;

/** Called once, when the viewfinder mounts. Restarts the clock on a new run. */
export function markLaunch(): void {
  launchedAtMs = Date.now();
  reported = false;
  console.time(LABEL);
}

/**
 * Called once, when the verdict screen first renders a price. Returns the
 * elapsed milliseconds, or null when the launch mark is missing or it has
 * already reported.
 */
export function markVerdict(): number | null {
  if (launchedAtMs === null || reported) return null;
  reported = true;
  const elapsedMs = Date.now() - launchedAtMs;
  console.timeEnd(LABEL);
  console.log(`[budget] ${LABEL} ${String(elapsedMs)} ms (budget 60000 ms)`);
  return elapsedMs;
}

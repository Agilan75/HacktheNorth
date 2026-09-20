/**
 * The coverage wash, on web: nothing.
 *
 * Metro picks this file over `CoverageWash.tsx` when the platform is web, and
 * nothing else changes. Skia on web needs a CanvasKit WASM bundle loaded before
 * the first `<Canvas>`, which this app never loads, and the wash has nothing to
 * draw there anyway: it paints only once the pose is live, and the pose comes
 * from the compass and DeviceMotion, neither of which a mobile browser gives
 * us. Drawing nothing is what the native file already does in that state.
 */
import type { CoverageWashProps } from './CoverageWash';

export function CoverageWash(_props: CoverageWashProps) {
  return null;
}

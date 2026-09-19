/**
 * `npm run rating:fit` — fits the commercial rating table from the snapshot and
 * writes the frozen `rating/commercial.json`. Body owned by Run 1 unit E15.
 *
 * This is the ONLY writer of that file. The engine never calls it; it runs once,
 * by hand, and its output is committed.
 */
export async function main(_argv: readonly string[]): Promise<number> {
  throw new Error('NOT_IMPLEMENTED:E15');
}

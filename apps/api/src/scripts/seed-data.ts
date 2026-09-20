/**
 * Seed material: one sweep's observations and one deliberately messy broker
 * reply, so the demo works with no camera and no wifi. Unit A10.
 *
 * The sweep is a bedroom, 15 frames at 24-degree steps. It is built so the
 * engine has something real to do:
 *  - `portable_heater` at 48 deg and `curtain` at 60 deg, both `near`: 12 deg
 *    apart, inside PAIR_ANGLE_DEG (20), so `heaterNearCombustible` fires.
 *  - `bedding` at 168 deg is far from the heater: no second pair.
 *  - `smoke_detector` and `candle` sit under 0.6, so they go back to the user to
 *    confirm (PRD 9.3 step 7).
 *  - No two same-label observations fall within DEDUPE_ANGLE_DEG (15).
 * Every value is fixed; nothing here reads a clock or a random source.
 */
import type { Observation } from '@retrofit/engine';

const SEEDED_OBSERVATIONS: readonly Observation[] = Object.freeze([
  {
    id: 'seed-obs-01',
    label: 'power_bar',
    category: 'electrical',
    bearingDeg: 36,
    distanceBand: 'near',
    confidence: 0.66,
    frameIndex: 1,
    box2d: [780, 300, 900, 520],
    ceilingVisible: false,
    notes: 'six-outlet power bar on the floor, every socket in use',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-02',
    label: 'extension_cord',
    category: 'electrical',
    bearingDeg: 40,
    distanceBand: 'near',
    confidence: 0.71,
    frameIndex: 2,
    box2d: [820, 120, 960, 610],
    ceilingVisible: false,
    notes: 'extension cord running from the power bar to the heater',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-03',
    label: 'portable_heater',
    category: 'heat_source',
    bearingDeg: 48,
    distanceBand: 'near',
    confidence: 0.88,
    frameIndex: 2,
    box2d: [620, 140, 880, 360],
    ceilingVisible: false,
    notes: 'free-standing electric heater on the floor, switched on',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-04',
    label: 'curtain',
    category: 'combustible',
    bearingDeg: 60,
    distanceBand: 'near',
    confidence: 0.83,
    frameIndex: 2,
    box2d: [120, 180, 720, 340],
    ceilingVisible: false,
    notes: 'floor-length fabric curtain hanging beside the heater',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-05',
    label: 'window_ac_unit',
    category: 'appliance',
    bearingDeg: 96,
    distanceBand: 'mid',
    confidence: 0.79,
    frameIndex: 4,
    box2d: [300, 420, 470, 640],
    ceilingVisible: true,
    notes: 'window-mounted air conditioner',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-06',
    label: 'bedding',
    category: 'combustible',
    bearingDeg: 168,
    distanceBand: 'mid',
    confidence: 0.9,
    frameIndex: 7,
    box2d: [520, 80, 900, 900],
    ceilingVisible: true,
    notes: 'double bed with duvet and pillows',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-07',
    label: 'smoke_detector',
    category: 'protection',
    bearingDeg: 200,
    distanceBand: 'far',
    confidence: 0.52,
    frameIndex: 8,
    box2d: [40, 460, 120, 560],
    ceilingVisible: true,
    notes: 'ceiling-mounted disc, indicator light not visible; seen in one of two runs',
    runsSeen: 1,
  },
  {
    id: 'seed-obs-08',
    label: 'laptop',
    category: 'valuables',
    bearingDeg: 216,
    distanceBand: 'mid',
    confidence: 0.77,
    frameIndex: 9,
    box2d: [480, 380, 610, 600],
    ceilingVisible: false,
    notes: 'laptop open on the desk',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-09',
    label: 'bike',
    category: 'other',
    bearingDeg: 288,
    distanceBand: 'far',
    confidence: 0.84,
    frameIndex: 12,
    box2d: [360, 200, 880, 760],
    ceilingVisible: true,
    notes: 'road bike leaning against the wall by the door',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-10',
    label: 'outlet',
    category: 'electrical',
    bearingDeg: 312,
    distanceBand: 'near',
    confidence: 0.62,
    frameIndex: 13,
    box2d: [700, 460, 780, 520],
    ceilingVisible: false,
    notes: 'wall outlet with a scorch mark above the left socket',
    runsSeen: 2,
  },
  {
    id: 'seed-obs-11',
    label: 'candle',
    category: 'heat_source',
    bearingDeg: 330,
    distanceBand: 'mid',
    confidence: 0.58,
    frameIndex: 14,
    box2d: [540, 620, 600, 660],
    ceilingVisible: false,
    notes: 'jar candle on the dresser, unlit; seen in one of two runs',
    runsSeen: 1,
  },
] satisfies Observation[]);

export function seededObservations(): readonly Observation[] {
  return SEEDED_OBSERVATIONS;
}

/**
 * Vague, partial and partly self-contradicting, on purpose. It answers the
 * canned request (year built for Building C) twice with two different years,
 * hedges the construction mix, gives one loss with an amount and one without,
 * restates TIV with two numbers, and never answers the sprinkler question
 * cleanly. The extractor must quote, not invent.
 */
const SEEDED_BROKER_REPLY = [
  'hi - sorry for the slow reply, been chasing the insured all week.',
  '',
  're your questions on the Hollis Street schedule:',
  '',
  '- bldg C: owner says it went up in the late 70s, 1978 he thinks. but the 2019 appraisal',
  '  we have on file says 1981?? not sure which is right, I would go with the appraisal.',
  '- roof on C was redone in 2015 i believe, full tear-off.',
  '- construction: mostly joisted masonry, maybe 60/40 with the frame addition on the back.',
  '  could be closer to half and half honestly, the addition is bigger than it looks.',
  '- sprinklers: the warehouse side is sprinklered. office side - will have to check.',
  '- losses last 5 yrs: one water damage claim in 2021, paid about $42,000. there was also',
  '  a small kitchen fire in the break room, cant remember the amount but it was under 10k.',
  '- TIV hasnt changed, still around $62M. actually the updated SOV they just sent has it',
  '  at $64.5M, so use that one.',
  '',
  'let me know if you need anything else, loss runs to follow once carrier sends them.',
  '',
  'thanks',
  'Dana',
].join('\n');

export function seededBrokerReply(): string {
  return SEEDED_BROKER_REPLY;
}

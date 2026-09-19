/**
 * Ballpark replacement prices for the live sweep price chips: the number the
 * phone shows the instant an item is recognised, before any online lookup.
 *
 * Typical mid-range new retail in the US, in whole dollars. A lookup that finds
 * a sourced price for the exact model replaces it; nothing else does.
 */

export const PRICE_TABLE = {
  sofa: { name: 'Sofa', typical: 1200 },
  sectional: { name: 'Sectional sofa', typical: 2200 },
  armchair: { name: 'Armchair', typical: 500 },
  coffee_table: { name: 'Coffee table', typical: 250 },
  dining_table: { name: 'Dining table', typical: 700 },
  dining_chair: { name: 'Dining chair', typical: 120 },
  desk: { name: 'Desk', typical: 300 },
  office_chair: { name: 'Office chair', typical: 250 },
  bed_frame: { name: 'Bed frame', typical: 600 },
  mattress: { name: 'Mattress', typical: 1000 },
  dresser: { name: 'Dresser', typical: 600 },
  nightstand: { name: 'Nightstand', typical: 150 },
  bookshelf: { name: 'Bookshelf', typical: 180 },
  tv_stand: { name: 'TV stand', typical: 250 },
  rug: { name: 'Rug', typical: 250 },
  lamp: { name: 'Lamp', typical: 80 },
  mirror: { name: 'Mirror', typical: 120 },
  artwork: { name: 'Framed art', typical: 150 },
  tv: { name: 'TV', typical: 600 },
  monitor: { name: 'Computer monitor', typical: 250 },
  laptop: { name: 'Laptop', typical: 1100 },
  desktop_computer: { name: 'Desktop computer', typical: 1200 },
  game_console: { name: 'Game console', typical: 500 },
  speaker: { name: 'Speaker', typical: 200 },
  camera: { name: 'Camera', typical: 800 },
  refrigerator: { name: 'Refrigerator', typical: 1800 },
  stove: { name: 'Stove / range', typical: 1100 },
  microwave: { name: 'Microwave', typical: 200 },
  dishwasher: { name: 'Dishwasher', typical: 800 },
  washer: { name: 'Washing machine', typical: 900 },
  dryer: { name: 'Dryer', typical: 850 },
  coffee_maker: { name: 'Coffee maker', typical: 120 },
  blender: { name: 'Blender', typical: 90 },
  toaster: { name: 'Toaster', typical: 50 },
  air_fryer: { name: 'Air fryer', typical: 110 },
  vacuum: { name: 'Vacuum', typical: 300 },
  window_ac_unit: { name: 'Window AC unit', typical: 400 },
  portable_heater: { name: 'Space heater', typical: 70 },
  fan: { name: 'Fan', typical: 60 },
  bike: { name: 'Bike', typical: 700 },
  instrument: { name: 'Musical instrument', typical: 600 },
  other: { name: 'Other item', typical: 100 },
} as const satisfies Record<string, { readonly name: string; readonly typical: number }>;

export type PriceLabel = keyof typeof PRICE_TABLE;

export const PRICE_LABELS = Object.keys(PRICE_TABLE) as readonly PriceLabel[];

export function isPriceLabel(value: string): value is PriceLabel {
  return Object.hasOwn(PRICE_TABLE, value);
}

export function tablePrice(label: PriceLabel): number {
  return PRICE_TABLE[label].typical;
}

// The spec's starting values (docs/specs/ai-development-overview.md, Starting values).
// Distances are layout units before the Map scales to fit.

export const HOUR = 3_600_000;

export const TIME_PULL = 0.14;
/** A collapsed parent's time pull, as a fraction of a leaf's. */
export const PARENT_TIME_PULL = 0.6;
export const TIME_CONSTANT = 8 * HOUR;
export const EQUALIZED = 0.6;
export const QUIET_AFTER = 12 * HOUR;
/** A quiet board's edge sits this far past its last activity. */
export const QUIET_PAD = HOUR;

export const FAMILY_STRENGTH = 0.7;
export const CROSS_LINK_GAP = 70;
export const CROSS_LINK_STRENGTH = 0.05;
export const CHAIN_GAP = 16;
export const CHAIN_STRENGTH = 0.7;
export const CHAIN_ROW_STRENGTH = 0.6;
export const RELATED_CHAINS_STRENGTH = 0.25;
export const RELATED_CHAINS_GAP = 10;
export const WORK_GAP = 30;
export const WORK_STRENGTH = 0.9;
export const MACHINE_GAP = 26;
export const MACHINE_STRENGTH = 1;

export const ORDER_GAP = 10;
/** Pooled done items are spread this far apart so their order stays strict. */
export const ORDER_EPSILON = 0.05;

export const REPULSION = 40;
export const REPULSION_RANGE = 260;
export const COLLISION_PAD = 4;
export const COLLISION_STRENGTH = 0.7;
export const SEPARATION_FACTOR = 2.5;
export const SEPARATION_RANGE = 60;
export const MIDLINE_STRENGTH = 0.03;

/** Fractions of the time scale's unit width past now. */
export const RESERVED_STRIP = 0.6;
export const COMPUTER_X = 0.5;
export const SESSION_X = 0.25;
export const COMPUTER_PULL = 0.6;
export const COMPUTER_ROW_PULL = 0.3;
export const COMPUTER_ROW_GAP = 150;
/** Computers also sit at least this far past the rightmost item target. */
export const COMPUTER_CLEARANCE = 60;
export const SESSION_PULL = 0.25;
export const SESSION_MIDLINE = 0.01;
/** A session stays in its computer's cluster this long after its last write. */
export const SESSION_LIVE = HOUR;

export const VELOCITY_DECAY = 0.4;
export const COLD_TICKS = 280;
export const LOCAL_TICKS = 140;
export const LOCAL_ALPHA = 0.25;
/** The width fit's second pass, from the first one's positions stretched to the fitted width. */
export const REFIT_TICKS = 140;
export const REFIT_ALPHA = 0.25;
/** Alpha falls to this fraction of its start over a run's ticks. */
export const ALPHA_FLOOR = 0.001;

export const LEAF_RADIUS = 5.5;
export const IN_FLIGHT_RADIUS = 8.5;
export const PARENT_RADIUS_BASE = 6;
export const PARENT_RADIUS_GROWTH = 2.3;
export const IN_FLIGHT_PARENT_SCALE = 1.15;
export const SESSION_RADIUS = 8;
export const COMPUTER_RADIUS = 14;

/**
 * Width fit. The first pass's unit width is FIT_UNIT per unit of canvas aspect for a
 * board of up to FIT_DOTS dots, widening with the square root of the count past that;
 * the second may stray from it by FIT_MIN to FIT_MAX, and runs only when the fit is
 * off by more than FIT_TOLERANCE. The prototype's trial was 120 at an aspect of about
 * 2.5, which nearly always refitted to about 190.
 */
export const FIT_UNIT = 68;
export const FIT_DOTS = 150;
export const FIT_MIN = 0.5;
export const FIT_MAX = 3;
export const FIT_TOLERANCE = 0.1;
/** The settled Map is never shorter than this either side of the midline. */
export const MIN_HALF_HEIGHT = 170;

/** Initial heights are hashed into a band this tall. */
export const ITEM_SPREAD = 360;
export const SESSION_SPREAD = 200;

export const UP_NEXT_COUNT = 3;

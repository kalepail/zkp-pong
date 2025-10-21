// Game configuration constants
// These are hardcoded in both frontend and prover - must match exactly!
// NOTE: SEED is NOT included here - it's logged per-game for unique physics

/** Game board width (pixels) */
export const WIDTH = 800

/** Game board height (pixels) */
export const HEIGHT = 480

/** Paddle height (pixels) */
export const PADDLE_HEIGHT = 80

/** Paddle width (pixels) */
export const PADDLE_WIDTH = 10

/** Paddle margin from edge (pixels) */
export const PADDLE_MARGIN = 16

/** Ball radius (pixels) */
export const BALL_RADIUS = 6

/** Maximum paddle speed (pixels/second) */
export const PADDLE_MAX_SPEED = 200

/** Initial serve speed (pixels/second) */
export const SERVE_SPEED = 500

/** Speed increment per bounce (pixels/second) */
export const SPEED_INCREMENT = 50

/** Maximum bounce angle off paddle (degrees) */
export const MAX_BOUNCE_ANGLE_DEG = 60

/** Maximum serve angle (degrees) */
export const SERVE_MAX_ANGLE_DEG = 20

/** Points needed to win the game */
export const POINTS_TO_WIN = 3

/** Micro jitter applied to bounces (milli-degrees) */
export const MICRO_JITTER_MILLI_DEG = 800

/** AI offset max (permille of paddle half + ball radius) */
export const AI_OFFSET_MAX_PERMILLE = 600

/** Initial serve direction: 1 = right, -1 = left */
export const INITIAL_SERVE_DIRECTION = 1

/** Maximum number of events allowed in a game log (~5000 volleys max) */
export const MAX_EVENTS = 10000

// Game configuration constants
// These are hardcoded in both frontend and prover - must match exactly!
// Physics is now fully deterministic based on event count - no seed needed

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

/** Points needed to win the game */
export const POINTS_TO_WIN = 3

/** Serve angle calculation - range of possible angles */
export const ANGLE_RANGE = MAX_BOUNCE_ANGLE_DEG * 2 + 1 // 121 values (-60 to +60)

/** Serve angle calculation - multiplier for deterministic variation */
export const SERVE_ANGLE_MULTIPLIER = 37 // Coprime with 121 for good distribution

/** Initial serve direction: 1 = right, -1 = left */
export const INITIAL_SERVE_DIRECTION = 1

/** Maximum number of events allowed in a game log (~5000 volleys max) */
export const MAX_EVENTS = 10000

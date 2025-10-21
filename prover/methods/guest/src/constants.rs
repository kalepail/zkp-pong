// Game configuration constants
// These are hardcoded in both frontend and prover - must match exactly!
// NOTE: SEED is NOT included here - it's logged per-game for unique physics

/// Game board width (pixels)
pub const WIDTH: i32 = 800;

/// Game board height (pixels)
pub const HEIGHT: i32 = 480;

/// Paddle height (pixels)
pub const PADDLE_HEIGHT: i32 = 80;

/// Paddle width (pixels)
pub const PADDLE_WIDTH: i32 = 10;

/// Paddle margin from edge (pixels)
pub const PADDLE_MARGIN: i32 = 16;

/// Ball radius (pixels)
pub const BALL_RADIUS: i32 = 6;

/// Maximum paddle speed (pixels/second)
pub const PADDLE_MAX_SPEED: i32 = 200;

/// Initial serve speed (pixels/second)
pub const SERVE_SPEED: i32 = 500;

/// Speed increment per bounce (pixels/second)
pub const SPEED_INCREMENT: i32 = 50;

/// Maximum bounce angle off paddle (degrees)
pub const MAX_BOUNCE_ANGLE_DEG: i32 = 60;

/// Maximum serve angle (degrees)
pub const SERVE_MAX_ANGLE_DEG: i32 = 20;

/// Points needed to win the game
pub const POINTS_TO_WIN: u32 = 3;

/// Micro jitter applied to bounces (milli-degrees)
pub const MICRO_JITTER_MILLI_DEG: i32 = 800;

/// AI offset max (permille of paddle half + ball radius)
pub const AI_OFFSET_MAX_PERMILLE: i32 = 600;

/// Initial serve direction: 1 = right, -1 = left
pub const INITIAL_SERVE_DIRECTION: i32 = 1;

/// Maximum number of events allowed in a game log (~5000 volleys max)
pub const MAX_EVENTS: u32 = 10000;

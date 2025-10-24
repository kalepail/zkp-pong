// Game configuration constants
// These are hardcoded in both frontend and prover - must match exactly!
// Physics is now fully deterministic based on event count - no seed needed

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

/// Points needed to win the game
pub const POINTS_TO_WIN: u32 = 3;

/// Serve angle calculation - range of possible angles
pub const ANGLE_RANGE: i32 = MAX_BOUNCE_ANGLE_DEG * 2 + 1; // 121 values (-60 to +60)

/// Serve angle calculation - multiplier for deterministic variation
pub const SERVE_ANGLE_MULTIPLIER: i32 = 37; // Coprime with 121 for good distribution

/// Initial serve direction: 1 = right, -1 = left
pub const INITIAL_SERVE_DIRECTION: i32 = 1;

/// Maximum number of events allowed in a game log (~5000 volleys max)
pub const MAX_EVENTS: u32 = 10000;

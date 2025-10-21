use crate::fixed::*;

// Simple LCG matching TS engine
// NOTE: Seed 0 is automatically converted to 1 to match JavaScript implementation
// This ensures the RNG never starts in a degenerate state
pub struct LcgRng { state: u32 }
impl LcgRng {
    pub fn new(seed: u32) -> Self {
        Self { state: if seed == 0 { 1 } else { seed } }
    }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
        self.state
    }
}

// Uniform range in fixed: [min, max]
#[inline(always)]
pub fn range_fixed(rng: &mut LcgRng, min_i: I, max_i: I) -> I {
    // Production assertion: validate range in all builds
    assert!(max_i >= min_i, "range_fixed: invalid range (min > max)");

    let u = rng.next_u32() as u128; // 0..2^32-1
    let span = (max_i - min_i) as i128 as u128;
    let scaled = (span * u) >> 32; // divide by 2^32
    min_i + (scaled as i128)
}

// CORDIC sin/cos in Q32.32 with ITER=32 (integer-only tables)
const ITER: usize = 32;
const ATAN_Q32: [I; ITER] = [
    3373259426, 1991351318, 1052175346, 534100635, 268086748, 134174063, 67103403,
    33553749, 16777131, 8388597, 4194303, 2097152, 1048576, 524288, 262144, 131072,
    65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2,
];
const K_Q32: I = 2608131496;

#[inline(always)]
pub fn cordic_sin_cos(angle: I) -> (I, I) {
    // Validate input angle is reasonable (±4π is more than sufficient for game physics)
    const MAX_ANGLE: I = PI_Q32 * 8;
    assert!(
        angle.abs() < MAX_ANGLE,
        "CORDIC: angle out of valid range (|angle| must be < 8π)"
    );

    let atan = ATAN_Q32;
    let mut x = K_Q32;
    let mut y: I = 0;
    let mut z = angle;
    for i in 0..ITER {
        let di: I = if z >= 0 { 1 } else { -1 };
        let shift = i as i32;
        let x_shift = x >> shift;
        let y_shift = y >> shift;

        // Use checked multiplication for CORDIC iterations
        // Mathematically, these multiplications cannot overflow with valid inputs
        // (di is ±1, shifts reduce magnitude, K_Q32 and ATAN values are small)
        // Defensive checks included for robustness and to catch potential bugs
        let x_term = di.checked_mul(y_shift)
            .expect("CORDIC x iteration overflow");
        let y_term = di.checked_mul(x_shift)
            .expect("CORDIC y iteration overflow");
        let z_term = di.checked_mul(atan[i])
            .expect("CORDIC z iteration overflow");

        x = x - x_term;
        y = y + y_term;
        z = z - z_term;
    }
    (y, x)
}

#[derive(Clone, Copy)]
pub struct FixState {
    pub t0: I,
    pub x: I,
    pub y: I,
    pub vx: I,
    pub vy: I,
    pub speed: I,
    pub left_y: I,
    pub right_y: I,
    pub dir: i32, // -1 or +1
}

#[inline(always)]
pub fn serve(
    receiver_dir: i32,
    t0: I,
    width: I,
    height: I,
    serve_speed: I,
    serve_max_angle: I,
    rng: &mut LcgRng,
) -> FixState {
    let angle = range_fixed(rng, -serve_max_angle, serve_max_angle);
    let (sinv, cosv) = cordic_sin_cos(angle);
    let vx = i_mul(serve_speed, i_mul(cosv, to_fixed_int(receiver_dir as i128)));
    let vy = i_mul(serve_speed, sinv);
    FixState {
        t0,
        x: i_div(width, to_fixed_int(2)),
        y: i_div(height, to_fixed_int(2)),
        vx,
        vy,
        speed: serve_speed,
        left_y: i_div(height, to_fixed_int(2)),
        right_y: i_div(height, to_fixed_int(2)),
        dir: receiver_dir,
    }
}

#[inline(always)]
pub fn bounce(
    s: &FixState,
    paddle_y: I,
    half: I,
    ball_radius: I,
    max_bounce_angle: I,
    micro_jitter: I,
    speed_increment: I,
    rng: &mut LcgRng,
) -> (I, I, I, i32) {
    let limit = half + ball_radius;

    // Guard against division by zero (should be prevented by config validation)
    if limit <= 0 {
        panic!("Invalid paddle/ball dimensions: limit is zero or negative");
    }

    let mut offset = s.y - paddle_y;
    if offset < -limit { offset = -limit; }
    if offset > limit { offset = limit; }

    let norm = i_div(offset, limit);
    let mut angle = i_max(-max_bounce_angle, i_min(max_bounce_angle, i_mul(norm, max_bounce_angle)));

    let jitter = range_fixed(rng, -micro_jitter, micro_jitter);
    angle = i_max(-max_bounce_angle, i_min(max_bounce_angle, angle + jitter));

    let new_speed = s.speed + speed_increment;
    let new_dir = if s.dir < 0 { 1 } else { -1 };

    let (sinv, cosv) = cordic_sin_cos(angle);
    let vx = i_mul(new_speed, i_mul(cosv, to_fixed_int(new_dir as i128)));
    let vy = i_mul(new_speed, sinv);

    (vx, vy, new_speed, new_dir)
}

use crate::fixed::*;

// CORDIC sin/cos with ITER=8 (optimized for performance)
// 8 iterations provides ~0.23° accuracy, sufficient for game physics
// Constants in Q16.16 format for i64 fixed-point
const ITER: usize = 8;
const ATAN_Q16: [I; ITER] = [
    51472,   // atan(2^0)  = 45°     in Q16.16
    30386,   // atan(2^-1) = 26.565° in Q16.16
    16055,   // atan(2^-2) = 14.036° in Q16.16
    8150,    // atan(2^-3) = 7.125°  in Q16.16
    4091,    // atan(2^-4) = 3.576°  in Q16.16
    2047,    // atan(2^-5) = 1.790°  in Q16.16
    1024,    // atan(2^-6) = 0.895°  in Q16.16
    512,     // atan(2^-7) = 0.448°  in Q16.16
];
const K_Q16: I = 39797;  // CORDIC gain ~0.6073 in Q16.16

#[inline(always)]
pub fn cordic_sin_cos(angle: I) -> (I, I) {
    // Validate input angle is reasonable (±4π is more than sufficient for game physics)
    const MAX_ANGLE: I = PI_Q16 * 8;
    assert!(
        angle.abs() < MAX_ANGLE,
        "CORDIC: angle out of valid range (|angle| must be < 8π)"
    );

    let atan = ATAN_Q16;
    let mut x = K_Q16;
    let mut y: I = 0;
    let mut z = angle;
    for i in 0..ITER {
        let di: I = if z >= 0 { 1 } else { -1 };
        let shift = i as i32;
        let x_shift = x >> shift;
        let y_shift = y >> shift;

        // CORDIC rotation step
        // These multiplications cannot overflow: di is ±1, values are small after shifts
        // Overflow protection provided by Cargo.toml: overflow-checks = true
        let x_term = di * y_shift;
        let y_term = di * x_shift;
        let z_term = di * atan[i];

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
    max_bounce_angle_deg: i32,
    angle_range: i32,
    serve_angle_multiplier: i32,
    volley_count: u32,
    game_id: u32,
) -> FixState {
    // Calculate deterministic serve angle mixing volley count + game_id
    // This prevents all games from having identical serve patterns while remaining deterministic
    // SECURITY: Use game_id to provide per-game entropy, preventing predictability

    // Mix game_id with volley count for serve angle entropy
    let entropy_mix = (volley_count as i32).wrapping_add(game_id as i32);

    // SECURITY: Prevent overflow in angle calculation with wrapping arithmetic
    let volley_i32 = (entropy_mix.wrapping_mul(serve_angle_multiplier)).rem_euclid(angle_range);
    let angle_raw = volley_i32 - max_bounce_angle_deg;
    let angle = deg_to_rad_fixed(angle_raw);
    let (sinv, cosv) = cordic_sin_cos(angle);
    let vx = i_mul(serve_speed, i_mul(cosv, to_fixed_int(receiver_dir as i64)));
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
    speed_increment: I,
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
    let angle = i_max(-max_bounce_angle, i_min(max_bounce_angle, i_mul(norm, max_bounce_angle)));

    let new_speed = s.speed + speed_increment;
    let new_dir = if s.dir < 0 { 1 } else { -1 };

    let (sinv, cosv) = cordic_sin_cos(angle);
    let vx = i_mul(new_speed, i_mul(cosv, to_fixed_int(new_dir as i64)));
    let vy = i_mul(new_speed, sinv);

    (vx, vy, new_speed, new_dir)
}

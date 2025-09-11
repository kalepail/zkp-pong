use crate::fixed::*;

// Simple LCG matching TS engine
pub struct LcgRng { state: u32 }
impl LcgRng {
    pub fn new(seed: u32) -> Self { Self { state: if seed == 0 { 1 } else { seed } } }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223);
        self.state
    }
}

// Uniform range in fixed: [min, max]
pub fn range_fixed(rng: &mut LcgRng, min_i: I, max_i: I) -> I {
    let u = rng.next_u32() as u128; // 0..2^32-1
    let span = i_sub(max_i, min_i) as i128 as u128;
    let scaled = (span * u) >> 32; // divide by 2^32
    i_add(min_i, scaled as i128)
}

// CORDIC sin/cos in Q32.32 with ITER=32
const ITER: usize = 32;

fn atan_table() -> [I; ITER] {
    let mut t = [0i128; ITER];
    for i in 0..ITER {
        let ang = (2f64).powi(-(i as i32));
        let v = ang.atan();
        t[i] = (v * (1u128 << FRAC_BITS as u32) as f64).round() as i128;
    }
    t
}

fn k_gain() -> I {
    let mut k = 1.0f64;
    for i in 0..ITER { k *= 1.0 / (1.0 + (2f64).powi(-2 * i as i32)).sqrt(); }
    (k * (1u128 << FRAC_BITS as u32) as f64).round() as i128
}

pub fn cordic_sin_cos(angle: I) -> (I, I) {
    // Precompute tables on first call
    static mut ATAN: Option<[I; ITER]> = None;
    static mut K: Option<I> = None;
    unsafe {
        if ATAN.is_none() { ATAN = Some(atan_table()); }
        if K.is_none() { K = Some(k_gain()); }
        let atan = ATAN.unwrap();
        let mut x = K.unwrap();
        let mut y: I = 0;
        let mut z = angle;
        for i in 0..ITER {
            let di: I = if z >= 0 { 1 } else { -1 };
            let shift = i as i32;
            let x_shift = x >> shift;
            let y_shift = y >> shift;
            let x_new = i_sub(x, (di as i128 * y_shift as i128) as i128);
            let y_new = i_add(y, (di as i128 * x_shift as i128) as i128);
            x = x_new;
            y = y_new;
            z = i_sub(z, (di as i128 * atan[i] as i128) as i128);
        }
        (y, x)
    }
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

pub fn serve(
    receiver_dir: i32,
    t_start_secs: i64,
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
        t0: to_fixed_int(t_start_secs as i128),
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

pub fn bounce(
    s: &FixState,
    paddle_y: I,
    paddle_height: I,
    ball_radius: I,
    max_bounce_angle: I,
    micro_jitter: I,
    speed_increment: I,
    rng: &mut LcgRng,
) -> (I, I, I, i32) {
    let half = i_div(paddle_height, to_fixed_int(2));
    let limit = i_add(half, ball_radius);
    let mut offset = i_sub(s.y, paddle_y);
    if offset < i_sub(0, limit) { offset = i_sub(0, limit); }
    if offset > limit { offset = limit; }
    let norm = i_div(offset, limit);
    let mut angle = i_max(i_sub(0, max_bounce_angle), i_min(max_bounce_angle, i_mul(norm, max_bounce_angle)));
    let jitter = range_fixed(rng, -micro_jitter, micro_jitter);
    angle = i_max(i_sub(0, max_bounce_angle), i_min(max_bounce_angle, i_add(angle, jitter)));
    let new_speed = i_add(s.speed, speed_increment);
    let new_dir = if s.dir < 0 { 1 } else { -1 };
    let (sinv, cosv) = cordic_sin_cos(angle);
    let vx = i_mul(new_speed, i_mul(cosv, to_fixed_int(new_dir as i128)));
    let vy = i_mul(new_speed, sinv);
    (vx, vy, new_speed, new_dir)
}

// from_fixed available in fixed.rs

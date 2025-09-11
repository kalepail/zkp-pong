// Q32.32 fixed-point arithmetic using i128

pub type I = i128;

pub const FRAC_BITS: i32 = 32;
pub const ONE: I = 1i128 << FRAC_BITS;

#[inline]
pub fn to_fixed_int(n: I) -> I { n << FRAC_BITS }

#[inline]
pub fn from_fixed(x: I) -> i64 { (x >> FRAC_BITS) as i64 }

#[inline]
pub fn i_add(a: I, b: I) -> I { a.wrapping_add(b) }
#[inline]
pub fn i_sub(a: I, b: I) -> I { a.wrapping_sub(b) }
#[inline]
pub fn i_abs(a: I) -> I { if a < 0 { -a } else { a } }
#[inline]
pub fn i_min(a: I, b: I) -> I { if a < b { a } else { b } }
#[inline]
pub fn i_max(a: I, b: I) -> I { if a > b { a } else { b } }

#[inline]
pub fn i_mul(a: I, b: I) -> I { ((a as i128 * b as i128) >> FRAC_BITS) as I }

#[inline]
pub fn i_div(a: I, b: I) -> I { ((a as i128) << FRAC_BITS) / b as i128 }

// Reflection on [min_y, max_y]
pub fn reflect1d(y0: I, vy: I, dt: I, min_y: I, max_y: I) -> I {
    let span = i_sub(max_y, min_y);
    if span <= 0 { return y0; }
    let period = span << 1; // 2*span
    let mut y = i_sub(i_add(y0, i_mul(vy, dt)), min_y);
    // proper modulo for negatives
    y = ((y % period) + period) % period;
    if y > span { return i_sub(max_y, i_sub(y, span)); }
    i_add(min_y, y)
}

pub fn clamp_paddle_y(y: I, half: I, height: I) -> I {
    i_max(half, i_min(i_sub(height, half), y))
}

// Angles in radians in Q32.32
pub fn deg_to_rad_fixed(d: i32) -> I {
    let rad = (d as f64) * core::f64::consts::PI / 180.0;
    (rad * (1u128 << FRAC_BITS as u32) as f64).round() as i128
}

pub fn deg_milli_to_rad_fixed(md: i32) -> I {
    let rad = (md as f64) / 1000.0 * (core::f64::consts::PI / 180.0);
    (rad * (1u128 << FRAC_BITS as u32) as f64).round() as i128
}

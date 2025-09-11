// Q32.32 fixed-point arithmetic using i128

pub type I = i128;

pub const FRAC_BITS: i32 = 32;

#[inline(always)]
pub fn to_fixed_int(n: I) -> I { n << FRAC_BITS }

#[inline(always)]
pub fn i_add(a: I, b: I) -> I { a.wrapping_add(b) }
#[inline(always)]
pub fn i_sub(a: I, b: I) -> I { a.wrapping_sub(b) }
#[inline(always)]
pub fn i_abs(a: I) -> I { if a < 0 { -a } else { a } }
#[inline(always)]
pub fn i_min(a: I, b: I) -> I { if a < b { a } else { b } }
#[inline(always)]
pub fn i_max(a: I, b: I) -> I { if a > b { a } else { b } }

#[inline(always)]
pub fn i_mul(a: I, b: I) -> I { ((a as i128 * b as i128) >> FRAC_BITS) as I }

#[inline(always)]
pub fn i_div(a: I, b: I) -> I { ((a as i128) << FRAC_BITS) / b as i128 }

// Reflection on [min_y, max_y]
#[inline(always)]
pub fn reflect1d(y0: I, vy: I, dt: I, min_y: I, max_y: I) -> I {
    let span = i_sub(max_y, min_y);
    if span <= 0 { return y0; }
    let period = span << 1; // 2*span
    let mut y = i_sub(i_add(y0, i_mul(vy, dt)), min_y);
    // proper modulo for negatives with single remainder
    y = y % period;
    if y < 0 { y = i_add(y, period); }
    if y > span { return i_sub(max_y, i_sub(y, span)); }
    i_add(min_y, y)
}

pub fn clamp_paddle_y(y: I, half: I, height: I) -> I {
    i_max(half, i_min(i_sub(height, half), y))
}

// PI constant in Q32.32 (rounded)
pub const PI_Q32: I = 13493037705i128;

// Angles in radians in Q32.32 using integer-only math
#[inline(always)]
pub fn deg_to_rad_fixed(d: i32) -> I {
    // rad = deg * PI / 180
    let deg_fixed = to_fixed_int(d as i128);
    let num = i_mul(deg_fixed, PI_Q32);
    // divide by 180 (as fixed-int)
    i_div(num, to_fixed_int(180))
}

#[inline(always)]
pub fn deg_milli_to_rad_fixed(md: i32) -> I {
    // md is thousandths of a degree: rad = (md/1000) * PI / 180
    // Combine: rad = md * PI / (180000)
    let md_fixed = to_fixed_int(md as i128);
    let num = i_mul(md_fixed, PI_Q32);
    i_div(num, to_fixed_int(180000))
}

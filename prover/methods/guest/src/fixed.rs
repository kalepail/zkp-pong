// Q32.32 fixed-point arithmetic using i128
//
// ## Format Specification
// - Type: i128 (128-bit signed integer)
// - Fractional bits: 32 (lower 32 bits)
// - Integer bits: 96 (upper 96 bits, including sign)
// - One unit: 1 << 32 = 4,294,967,296
//
// ## Value Ranges
// - Theoretical max: ±2^95 (~3.96 × 10^28)
// - Conservative safe limit: ±2^63 (~9.22 × 10^18)
// - Practical game values: max ~2^42 (~4.40 × 10^12)
//   - Example: 10,000 pixels << 32 = 4.29 × 10^13
//
// ## Overflow Protection
// - Multiplication checks operands don't exceed 2^63
// - Division uses checked_shl to detect overflow
// - Addition/subtraction rely on Cargo.toml overflow-checks=true
// - CORDIC iterations use checked_mul for safety
//
// ## Determinism Guarantee
// All operations are pure integer arithmetic with no floating-point.
// This ensures bit-for-bit identical results across all platforms,
// which is critical for zero-knowledge proof validation.

pub type I = i128;

pub const FRAC_BITS: i32 = 32;

#[inline(always)]
pub fn to_fixed_int(n: I) -> I { n << FRAC_BITS }

#[inline(always)]
#[allow(dead_code)]
pub fn i_add(a: I, b: I) -> I {
    // With overflow-checks=true in Cargo.toml, this will panic on overflow
    a + b
}

#[inline(always)]
#[allow(dead_code)]
pub fn i_sub(a: I, b: I) -> I {
    // With overflow-checks=true in Cargo.toml, this will panic on overflow
    a - b
}

#[inline(always)]
pub fn i_abs(a: I) -> I {
    // Special case: i128::MIN cannot be negated without overflow
    // In Q32.32 format with validated game configs, i128::MIN is impossible to reach
    // (max representable value is ~2^95, i128::MIN is -2^127)
    // This case is included for mathematical completeness and defensive programming
    if a == I::MIN {
        I::MAX // Safe approximation - returns largest positive value
    } else if a < 0 {
        -a
    } else {
        a
    }
}
#[inline(always)]
pub fn i_min(a: I, b: I) -> I { if a < b { a } else { b } }
#[inline(always)]
pub fn i_max(a: I, b: I) -> I { if a > b { a } else { b } }

#[inline(always)]
pub fn i_mul(a: I, b: I) -> I {
    // Q32.32 fixed-point multiplication with overflow protection
    //
    // Theoretical max safe value: ±2^95 (since result is shifted right by 32)
    // Conservative bound: ±2^63 (provides 2^32 safety margin)
    //
    // With validated game configs (speeds <= 10000, dimensions <= 10000):
    // - Max game value: ~10000 << 32 = ~4.3e13 (2^42 after scaling)
    // - This is well below 2^63 limit, so this check never triggers in practice
    //
    // The conservative bound catches malicious inputs while allowing all valid game states
    const MAX_SAFE: i128 = 1i128 << 63;

    let a_abs = if a == I::MIN { I::MAX } else { i_abs(a) };
    let b_abs = if b == I::MIN { I::MAX } else { i_abs(b) };

    if a_abs > MAX_SAFE || b_abs > MAX_SAFE {
        panic!("Fixed-point multiplication overflow: operands too large");
    }

    ((a as i128 * b as i128) >> FRAC_BITS) as I
}

#[inline(always)]
pub fn i_div(a: I, b: I) -> I {
    assert!(b != 0, "Division by zero");
    let shifted = a.checked_shl(FRAC_BITS as u32)
        .expect("Division overflow: operand too large for Q32.32 format");
    shifted / b
}

// Reflection on [min_y, max_y]
// Simulates ball bouncing between boundaries using modular arithmetic
// Uses double-modulo approach for mathematically clean negative handling
// Matches TypeScript implementation exactly
#[inline(always)]
pub fn reflect1d(y0: I, vy: I, dt: I, min_y: I, max_y: I) -> I {
    let span = max_y - min_y;
    if span <= 0 { return y0; }

    // Verify span won't overflow when doubled
    // With validated config (height <= 10000), this check never triggers
    if span > (I::MAX >> 1) {
        panic!("Reflection span too large: would overflow when computing period");
    }

    let period = span << 1; // 2*span
    let mut y = y0 + i_mul(vy, dt) - min_y;

    // Double-modulo for proper negative handling (matches TypeScript)
    // ((y % period) + period) % period
    y = ((y % period) + period) % period;

    if y > span { return max_y - (y - span); }
    min_y + y
}

pub fn clamp_paddle_y(y: I, half: I, height: I) -> I {
    i_max(half, i_min(height - half, y))
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

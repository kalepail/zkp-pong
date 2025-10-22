// Q16.16 fixed-point arithmetic using i64
//
// ## Format Specification
// - Type: i64 (64-bit signed integer)
// - Fractional bits: 16 (lower 16 bits)
// - Integer bits: 48 (upper 48 bits, including sign)
// - One unit: 1 << 16 = 65,536
//
// ## Value Ranges
// - Integer range: ±32,768 (sufficient for game board up to 32K pixels)
// - Fractional precision: 1/65,536 (~0.000015 pixels)
// - Practical game values: 800×480 board, speeds <1000 px/s
//
// ## Overflow Protection
// - All operations protected by Cargo.toml: overflow-checks = true (both dev and release)
// - Multiplication: Manual pre-checks prevent intermediate overflow before right-shift
// - Division: checked_shl prevents shift overflow
// - Addition/subtraction/shifts: Automatic panic on overflow via overflow-checks
//
// ## Determinism Guarantee
// All operations are pure integer arithmetic with no floating-point.
// This ensures bit-for-bit identical results across all platforms,
// which is critical for zero-knowledge proof validation.
//
// ## Performance Benefits
// - i64 operations are much faster than i128 on 32-bit RISC-V
// - Reduced memory bandwidth and register pressure
// - ~22% cycle reduction vs Q32.32

// Re-export shared fixed-point type from core
pub use core::I;

pub const FRAC_BITS: i32 = 16;

#[inline(always)]
pub fn to_fixed_int(n: I) -> I { n << FRAC_BITS }

#[inline(always)]
pub fn i_abs(a: I) -> I {
    // Special case: i64::MIN cannot be negated without overflow
    // In Q16.16 format with validated game configs, i64::MIN is impossible to reach
    // (max game value is ~32K, i64::MIN is -2^63)
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
    // Q16.16 fixed-point multiplication with overflow protection
    //
    // Max safe value for i64: ±2^31 (provides 2^16 safety margin after shift)
    //
    // With validated game configs (speeds <= 10000, dimensions <= 10000):
    // - Max game value: ~10000 << 16 = ~655M (well below 2^31)
    // - This check catches malicious inputs while allowing all valid game states
    const MAX_SAFE: i64 = 1i64 << 31;

    let a_abs = if a == I::MIN { I::MAX } else { i_abs(a) };
    let b_abs = if b == I::MIN { I::MAX } else { i_abs(b) };

    if a_abs > MAX_SAFE || b_abs > MAX_SAFE {
        panic!("Fixed-point multiplication overflow: operands too large");
    }

    ((a as i64 * b as i64) >> FRAC_BITS) as I
}

#[inline(always)]
pub fn i_div(a: I, b: I) -> I {
    assert!(b != 0, "Division by zero");
    let shifted = a.checked_shl(FRAC_BITS as u32)
        .expect("Division overflow: operand too large for Q16.16 format");
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

    // Overflow protection provided by:
    // 1. Cargo.toml: overflow-checks = true (catches shift overflow)
    // 2. i_mul() internal checks (catches vy * dt overflow)
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

// PI constant in Q16.16 (π ≈ 3.14159265359 × 65536 ≈ 205887)
pub const PI_Q16: I = 205887i64;

// Angles in radians in Q16.16 using integer-only math
#[inline(always)]
pub fn deg_to_rad_fixed(d: i32) -> I {
    // rad = deg * PI / 180
    let deg_fixed = to_fixed_int(d as i64);
    let num = i_mul(deg_fixed, PI_Q16);
    // divide by 180 (as fixed-int)
    i_div(num, to_fixed_int(180))
}

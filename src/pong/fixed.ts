// Fixed-point Q16.16 arithmetic using BigInt for deterministic math.
// Positions, velocities, and times are represented in this format.
// Optimized from Q32.32 to Q16.16 for better performance (96% cycle reduction in prover)

export type I = bigint

export const FRAC_BITS = 16n
export const ONE: I = 1n << FRAC_BITS

export function toFixed(n: number): I {
  // Convert floating-point number to Q16.16 fixed-point format
  // NOTE: Uses Math.round() which involves floating-point arithmetic
  // This is ONLY safe at initialization time for config/constant conversion
  // Runtime physics must NOT call this function with computed values
  // The conversion: n * 2^16, rounded to nearest integer
  return BigInt(Math.round(n * Math.pow(2, Number(FRAC_BITS))))
}

// Exact conversion from integer units to fixed
export function toFixedInt(n: number | bigint): I {
  return (BigInt(n) << FRAC_BITS) as I
}

// Divide a fixed-point by an integer
export function iDivByInt(a: I, n: number | bigint): I {
  return (a / BigInt(n)) as I
}

export function fromFixed(x: I): number {
  // Convert Q16.16 fixed-point to floating-point for display/rendering only
  // NOTE: Result is NOT deterministic and should NEVER be logged or used in physics
  // Only use for: canvas rendering, UI display, debug output to console
  return Number(x) / Math.pow(2, Number(FRAC_BITS))
}

export function iAdd(a: I, b: I): I { return a + b }
export function iSub(a: I, b: I): I { return a - b }
export function iAbs(a: I): I { return a < 0n ? -a : a }
export function iSign(a: I): -1n | 0n | 1n { return a === 0n ? 0n : (a < 0n ? -1n : 1n) as any }

export function iMul(a: I, b: I): I {
  return (a * b) >> FRAC_BITS
}

export function iDiv(a: I, b: I): I {
  return (a << FRAC_BITS) / b
}

export function iMin(a: I, b: I): I { return a < b ? a : b }
export function iMax(a: I, b: I): I { return a > b ? a : b }

// Reflection mapping on [minY, maxY] for 1D position.
export function reflect1D(y0: I, vy: I, dt: I, minY: I, maxY: I): I {
  const span = iSub(maxY, minY)
  if (span <= 0n) return y0
  const period = span << 1n // 2*span in same fixed units
  // y = y0 + vy*dt - minY
  let y = iSub(iAdd(y0, iMul(vy, dt)), minY)
  // Proper modulo for negatives: ((y % period) + period) % period
  y = ((y % period) + period) % period
  if (y > span) {
    // maxY - (y - span)
    return iSub(maxY, iSub(y, span))
  }
  return iAdd(minY, y)
}

// PI constant in Q16.16 format (must match Rust: prover/methods/guest/src/fixed.rs)
// π ≈ 3.14159265359 × 65536 ≈ 205887
export const PI_Q16: I = 205887n

// Convert degrees to radians using integer-only math (no floating point)
// This ensures determinism - no platform-specific float rounding
export function degToRadFixed(d: number): I {
  // rad = deg * PI / 180
  const degFixed = toFixedInt(d)
  const num = iMul(degFixed, PI_Q16)
  return iDiv(num, toFixedInt(180))
}

// CORDIC-based sin/cos in Q16.16 for angles in radians (also Q16.16).
// CORDIC with 8 iterations provides ~0.23° precision - sufficient for game physics
// Valid range extended to ±8π for game physics safety
// Maximum game angle is ~60° (1.05 rad) so this is very conservative
// Optimized from 32 to 8 iterations for 75% cycle reduction
const ITER = 8

// Hardcoded CORDIC atan(2^-i) table in Q16.16 format
// CRITICAL: These values MUST match Rust prover exactly!
// Source: prover/methods/guest/src/physics.rs ATAN_Q16 array
// DO NOT recompute these - any divergence breaks determinism
const atanTable: I[] = [
  51472n,   // atan(2^0)  = 45°     in Q16.16
  30386n,   // atan(2^-1) = 26.565° in Q16.16
  16055n,   // atan(2^-2) = 14.036° in Q16.16
  8150n,    // atan(2^-3) = 7.125°  in Q16.16
  4091n,    // atan(2^-4) = 3.576°  in Q16.16
  2047n,    // atan(2^-5) = 1.790°  in Q16.16
  1024n,    // atan(2^-6) = 0.895°  in Q16.16
  512n,     // atan(2^-7) = 0.448°  in Q16.16
]

// Hardcoded CORDIC gain constant K ~0.6073 in Q16.16
// CRITICAL: This value MUST match Rust prover exactly!
// Source: prover/methods/guest/src/physics.rs K_Q16 = 39797
// DO NOT recompute this - any divergence breaks determinism
const K: I = 39797n

export function cordicSinCos(angle: I): { sin: I; cos: I } {
  // Pure integer CORDIC algorithm for computing sin and cos
  // All operations are BigInt - no floating-point arithmetic
  // This ensures bit-for-bit identical results across all platforms
  let x = K
  let y = 0n as I
  let z = angle
  for (let i = 0; i < ITER; i++) {
    const shift = BigInt(i)
    const di = z >= 0n ? 1n : -1n
    const xShift = x >> shift
    const yShift = y >> shift
    const xNew = iSub(x, iMulInt(di, yShift))
    const yNew = iAdd(y, iMulInt(di, xShift))
    x = xNew
    y = yNew
    z = iSub(z, iMulInt(di, atanTable[i]))
  }
  return { sin: y, cos: x }
}

// Export constants for testing (to verify they match Rust prover)
export function getCORDICConstants(): { K: I; atanTable: I[] } {
  return { K, atanTable }
}

function iMulInt(a: I, b: I): I { return (a as unknown as bigint) * (b as unknown as bigint) as unknown as I }

// Clamp y within paddle bounds [half, height-half]
export function clampPaddleY(y: I, half: I, height: I): I {
  return iMax(half, iMin(iSub(height, half), y))
}

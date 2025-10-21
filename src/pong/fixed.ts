// Fixed-point Q32.32 arithmetic using BigInt for deterministic math.
// Positions, velocities, and times are represented in this format.

export type I = bigint

export const FRAC_BITS = 32n
export const ONE: I = 1n << FRAC_BITS

export function toFixed(n: number): I {
  // Convert floating-point number to Q32.32 fixed-point format
  // NOTE: Uses Math.round() which involves floating-point arithmetic
  // This is ONLY safe at initialization time for config/constant conversion
  // Runtime physics must NOT call this function with computed values
  // The conversion: n * 2^32, rounded to nearest integer
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

// Build a fixed-point from permille integer (0..1000)
export function fixedFromPermille(p: number): I {
  return ((BigInt(p) << FRAC_BITS) / 1000n) as I
}

export function fromFixed(x: I): number {
  // Convert Q32.32 fixed-point to floating-point for display/rendering only
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

// PI constant in Q32.32 format (must match Rust: prover/methods/guest/src/fixed.rs)
export const PI_Q32: I = 13493037705n

// Convert degrees to radians using integer-only math (no floating point)
// This ensures determinism - no platform-specific float rounding
export function degToRadFixed(d: number): I {
  // rad = deg * PI / 180
  const degFixed = toFixedInt(d)
  const num = iMul(degFixed, PI_Q32)
  return iDiv(num, toFixedInt(180))
}

// Convert milli-degrees to radians using integer-only math
// Milli-degrees are thousandths of a degree (e.g., 800 = 0.8°)
export function degMilliToRadFixed(md: number): I {
  // rad = (md/1000) * PI / 180 = md * PI / 180000
  const mdFixed = toFixedInt(md)
  const num = iMul(mdFixed, PI_Q32)
  return iDiv(num, toFixedInt(180000))
}

// CORDIC-based sin/cos in Q32.32 for angles in radians (also Q32.32).
// CORDIC with 32 iterations provides ~10^-10 precision for |angle| < π
// Valid range extended to ±8π for game physics safety
// Maximum game angle is ~60° (1.05 rad) so this is very conservative
const ITER = 32

// Hardcoded CORDIC atan(2^-i) table in Q32.32 format
// CRITICAL: These values MUST match Rust prover exactly!
// Source: prover/methods/guest/src/physics.rs ATAN_Q32 array
// DO NOT recompute these - any divergence breaks determinism
const atanTable: I[] = [
  3373259426n, 1991351318n, 1052175346n, 534100635n, 268086748n, 134174063n, 67103403n,
  33553749n, 16777131n, 8388597n, 4194303n, 2097152n, 1048576n, 524288n, 262144n, 131072n,
  65536n, 32768n, 16384n, 8192n, 4096n, 2048n, 1024n, 512n, 256n, 128n, 64n, 32n, 16n, 8n, 4n, 2n,
]

// Hardcoded CORDIC gain constant K = product of 1/sqrt(1+2^-2i) for i=0..31
// CRITICAL: This value MUST match Rust prover exactly!
// Source: prover/methods/guest/src/physics.rs K_Q32 = 2608131496
// DO NOT recompute this - any divergence breaks determinism
const K: I = 2608131496n

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

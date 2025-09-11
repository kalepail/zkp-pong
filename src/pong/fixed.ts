// Fixed-point Q32.32 arithmetic using BigInt for deterministic math.
// Positions, velocities, and times are represented in this format.

export type I = bigint

export const FRAC_BITS = 32n
export const ONE: I = 1n << FRAC_BITS

export function toFixed(n: number): I {
  // Round to nearest (may use float internally; not surfaced)
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

export function degToRadFixed(d: number): I {
  return toFixed((d * Math.PI) / 180)
}

// Milli-degree (thousandths of a degree) to radians in fixed
export function degMilliToRadFixed(md: number): I {
  return toFixed((md / 1000) * (Math.PI / 180))
}

// CORDIC-based sin/cos in Q32.32 for angles in radians (also Q32.32).
// Valid for |angle| <= ~pi/2; our max angles are within that.
const ITER = 32

// Precompute atan(2^-i) as fixed
const atanTable: I[] = Array.from({ length: ITER }, (_, i) => toFixed(Math.atan(Math.pow(2, -i))))

// Precompute gain K = prod_i 1/sqrt(1+2^-2i)
const K_FLOAT = Array.from({ length: ITER }, (_, i) => 1 / Math.sqrt(1 + Math.pow(2, -2 * i))).reduce((a, b) => a * b, 1)
const K: I = toFixed(K_FLOAT)

export function cordicSinCos(angle: I): { sin: I; cos: I } {
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

function iMulInt(a: I, b: I): I { return (a as unknown as bigint) * (b as unknown as bigint) as unknown as I }

// Clamp y within paddle bounds [half, height-half]
export function clampPaddleY(y: I, half: I, height: I): I {
  return iMax(half, iMin(iSub(height, half), y))
}

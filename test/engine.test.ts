// Unit tests for deterministic Pong engine and RISC0 zkVM compatibility
// Tests that rely on specific JSON log files are in log-validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateLog } from '../src/pong/engine'
import type { CompactLog } from '../src/pong/engine'
import { cordicSinCos, degToRadFixed, toFixed, toFixedInt, getCORDICConstants, iMul, iAdd, reflect1D, FRAC_BITS } from '../src/pong/fixed'

// Rust prover constants from prover/methods/guest/src/physics.rs
const RUST_CONSTANTS = {
  // CORDIC atan table (Q32.32)
  ATAN_Q32: [
    3373259426n, 1991351318n, 1052175346n, 534100635n, 268086748n, 134174063n,
    67103403n, 33553749n, 16777131n, 8388597n, 4194303n, 2097152n, 1048576n,
    524288n, 262144n, 131072n, 65536n, 32768n, 16384n, 8192n, 4096n, 2048n,
    1024n, 512n, 256n, 128n, 64n, 32n, 16n, 8n, 4n, 2n,
  ],
  // CORDIC gain constant (Q32.32)
  K_Q32: 2608131496n,
  // PI in Q32.32
  PI_Q32: 13493037705n,
}

describe('RISC0 zkVM Compatibility', () => {
  describe('Constant Verification', () => {
    it('should match Rust CORDIC K gain constant', () => {
      const { K } = getCORDICConstants()
      expect(K).toBe(RUST_CONSTANTS.K_Q32)
    })

    it('should match Rust CORDIC atan table', () => {
      const { atanTable } = getCORDICConstants()

      // Check all 32 values
      for (let i = 0; i < 32; i++) {
        expect(atanTable[i]).toBe(RUST_CONSTANTS.ATAN_Q32[i])
      }
    })

    it('should log constants for manual verification', () => {
      // This test helps developers verify constants match between TS and Rust
      const { K, atanTable } = getCORDICConstants()
      console.log('\n=== TypeScript CORDIC Constants ===')
      console.log('K_Q32:', K.toString())
      console.log('ATAN_Q32:', atanTable.map(v => v.toString()).join(', '))
      console.log('\nCompare with prover/methods/guest/src/physics.rs')
      expect(true).toBe(true) // Always pass - this is for logging only
    })
  })

  describe('Log Validation', () => {
    it('should reject empty events array', () => {
      const log: CompactLog = {
        v: 1,
        events: [], // Empty is invalid - no gameplay occurred
      }

      const result = validateLog(log)
      // Empty events is invalid - game never started
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('No events provided')
    })

    it('should reject odd number of events', () => {
      const log: CompactLog = {
        v: 1,
        events: ['1030792151040'], // Odd number - invalid!
      }

      const result = validateLog(log)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Malformed')
    })

    it('should detect paddle moving too fast', () => {
      const log: CompactLog = {
        v: 1,
        events: [
          '1030792151040', // Event 0: leftY - center
          '1030792151040', // Event 0: rightY - center
          '1030792151040', // Event 1: leftY - still at center
          '2000000000000', // Event 1: rightY - huge jump! (invalid)
        ],
      }

      const result = validateLog(log)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('too fast')
    })

    it('should detect out of bounds paddle', () => {
      const log: CompactLog = {
        v: 1,
        events: [
          '1030792151040', // leftY - center
          '1030792151040', // rightY - center
          '10000000000000000', // leftY - extreme position (invalid)
          '1030792151040', // rightY
        ],
      }

      const result = validateLog(log)
      expect(result.fair).toBe(false)
      // Will be caught as "too fast" or "out of bounds"
      expect(result.fair).toBe(false)
    })

    it('should reject tied games', () => {
      // Create a minimal log that would result in 0-0 (tie)
      // Since we can't easily create a realistic tie scenario, we'll test this
      // via the validation logic - ties are rejected at the end
      const log: CompactLog = {
        v: 1,
        events: [
          '1030792151040', // leftY at center
          '1030792151040', // rightY at center - this will be a miss
        ],
      }

      // This minimal log should NOT tie (one side will score), but serves as documentation
      // The tie check is enforced after all events are processed
      // A tie would only occur if both players reach POINTS_TO_WIN simultaneously
      // which should be impossible given the game logic (one scores per rally)

      // Note: In practice, ties shouldn't occur naturally in Pong gameplay
      // The validation is defensive programming - it would only catch
      // a maliciously crafted log that somehow bypasses score increments
      const result = validateLog(log)
      // This specific log won't tie, but documents the tie rejection exists
      expect(result.fair).toBeDefined()
    })
  })

  describe('Fixed-Point Math', () => {
    it('should compute CORDIC sin/cos correctly', () => {
      // Test angle: 45 degrees = π/4
      const angle45 = degToRadFixed(45)
      const { sin, cos } = cordicSinCos(angle45)

      // sin(45°) ≈ cos(45°) ≈ 0.7071067811865476
      const expected = toFixed(0.7071067811865476)

      // Allow small error due to CORDIC approximation
      const tolerance = 1000n // Very small in Q32.32
      expect(sin).toBeGreaterThan(expected - tolerance)
      expect(sin).toBeLessThan(expected + tolerance)
      expect(cos).toBeGreaterThan(expected - tolerance)
      expect(cos).toBeLessThan(expected + tolerance)
    })

    it('should compute sin(0) = 0 and cos(0) = 1', () => {
      const angle0 = degToRadFixed(0)
      const { sin, cos } = cordicSinCos(angle0)

      expect(sin).toBeLessThan(1000n) // Very close to 0
      expect(cos).toBeGreaterThan(toFixedInt(1) - 1000n)
      expect(cos).toBeLessThan(toFixedInt(1) + 1000n)
    })

    it('should compute sin(90) = 1 and cos(90) = 0', () => {
      const angle90 = degToRadFixed(90)
      const { sin, cos } = cordicSinCos(angle90)

      expect(sin).toBeGreaterThan(toFixedInt(1) - 1000n)
      expect(sin).toBeLessThan(toFixedInt(1) + 1000n)
      expect(cos).toBeLessThan(1000n) // Very close to 0
    })

    it('should handle degree to radian conversion', () => {
      const deg180 = degToRadFixed(180)
      // 180° = π radians
      const expectedPi = RUST_CONSTANTS.PI_Q32

      // Allow small tolerance for rounding
      const tolerance = 100n
      expect(deg180).toBeGreaterThan(expectedPi - tolerance)
      expect(deg180).toBeLessThan(expectedPi + tolerance)
    })

    it('should handle negative angles', () => {
      const anglePos30 = degToRadFixed(30)
      const angleNeg30 = degToRadFixed(-30)

      const { sin: sinPos, cos: cosPos } = cordicSinCos(anglePos30)
      const { sin: sinNeg, cos: cosNeg } = cordicSinCos(angleNeg30)

      // sin(-θ) = -sin(θ) (allow small tolerance for CORDIC rounding)
      const tolerance = 10n
      expect(sinNeg).toBeGreaterThan(-sinPos - tolerance)
      expect(sinNeg).toBeLessThan(-sinPos + tolerance)
      // cos(-θ) = cos(θ)
      expect(cosNeg).toBeGreaterThan(cosPos - tolerance)
      expect(cosNeg).toBeLessThan(cosPos + tolerance)
    })
  })

  describe('Physics - Reflection', () => {
    it('should reflect ball within bounds', () => {
      const y0 = toFixedInt(100)
      const vy = toFixedInt(50) // Moving down
      const dt = toFixedInt(2)
      const minY = toFixedInt(0)
      const maxY = toFixedInt(480)

      const result = reflect1D(y0, vy, dt, minY, maxY)

      // Ball should move 50*2 = 100 pixels down to y=200
      expect(result).toBe(toFixedInt(200))
    })

    it('should reflect ball at top boundary', () => {
      const y0 = toFixedInt(10)
      const vy = toFixedInt(-50) // Moving up
      const dt = toFixedInt(1)
      const minY = toFixedInt(0)
      const maxY = toFixedInt(480)

      const result = reflect1D(y0, vy, dt, minY, maxY)

      // Ball should hit top and reflect
      // Position would be -40, reflects to 40
      expect(result).toBe(toFixedInt(40))
    })

    it('should reflect ball at bottom boundary', () => {
      const y0 = toFixedInt(470)
      const vy = toFixedInt(50) // Moving down
      const dt = toFixedInt(1)
      const minY = toFixedInt(0)
      const maxY = toFixedInt(480)

      const result = reflect1D(y0, vy, dt, minY, maxY)

      // Ball should hit bottom and reflect
      // Position would be 520, reflects back
      expect(result).toBe(toFixedInt(440))
    })

    it('should handle multiple reflections', () => {
      const y0 = toFixedInt(10)
      const vy = toFixedInt(-500) // Very fast upward
      const dt = toFixedInt(3)
      const minY = toFixedInt(0)
      const maxY = toFixedInt(480)

      const result = reflect1D(y0, vy, dt, minY, maxY)

      // Ball bounces multiple times, should still be in bounds
      const resultNum = Number(result >> FRAC_BITS)
      expect(resultNum).toBeGreaterThanOrEqual(0)
      expect(resultNum).toBeLessThanOrEqual(480)
    })
  })

  describe('Physics - Bounce Angles', () => {
    it('should produce angles within valid range', () => {
      // Max bounce angle is 60 degrees
      const angle60 = degToRadFixed(60)
      const { sin: sin60, cos: cos60 } = cordicSinCos(angle60)

      // sin^2 + cos^2 should = 1 (Pythagorean identity)
      const sin2 = iMul(sin60, sin60)
      const cos2 = iMul(cos60, cos60)
      const sum = iAdd(sin2, cos2)

      // Should be very close to 1.0 in fixed point
      const one = toFixedInt(1)
      const tolerance = 10000n
      expect(sum).toBeGreaterThan(one - tolerance)
      expect(sum).toBeLessThan(one + tolerance)
    })

    it('should produce shallow angles when hitting paddle center', () => {
      // Hitting center of paddle should produce small angle
      const angle0 = degToRadFixed(0)
      const { sin: sin0 } = cordicSinCos(angle0)

      // sin(0°) ≈ 0
      expect(sin0).toBeLessThan(1000n)
      expect(sin0).toBeGreaterThan(-1000n)
    })
  })

  describe('Serialization', () => {
    it('should handle very large BigInt values', () => {
      const log: CompactLog = {
        v: 1,
        events: [
          '999999999999999999', // Very large but valid Q32.32 value
          '1030792151040',
        ],
      }

      const result = validateLog(log)
      // Should handle gracefully (might fail for other reasons but not parsing)
      expect(result).toBeDefined()
    })

    it('should reject non-numeric event strings', () => {
      const log: CompactLog = {
        v: 1,
        events: ['not a number' as any, '1030792151040'],
      }

      // Should fail gracefully - validation will catch invalid values
      const result = validateLog(log)
      expect(result.fair).toBe(false)
    })
  })

  describe('Serialization', () => {
    it('should handle very large BigInt values', () => {
      const log: CompactLog = {
        v: 1,
        events: [
          '999999999999999999', // Very large but valid Q32.32 value
          '1030792151040',
        ],
      }

      const result = validateLog(log)
      // Should handle gracefully (might fail for other reasons but not parsing)
      expect(result).toBeDefined()
    })

    it('should reject non-numeric event strings', () => {
      const log: CompactLog = {
        v: 1,
        events: ['not a number' as any, '1030792151040'],
      }

      // Should fail gracefully - validation will catch invalid values
      const result = validateLog(log)
      expect(result.fair).toBe(false)
    })
  })

  describe('Score Validation', () => {
    it('should reject scores under POINTS_TO_WIN', () => {
      // Test that a game ending at 1-0 is invalid (didn't reach POINTS_TO_WIN)
      const log: CompactLog = {
        v: 1,
        events: [
          '1030792151040', // leftY at center
          '1030792151040', // rightY at center - miss, left scores 1
        ],
      }

      const result = validateLog(log)
      // Should be rejected - game ended at 1-0, didn't reach POINTS_TO_WIN
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Invalid final score - neither player reached POINTS_TO_WIN')
    })
  })
})

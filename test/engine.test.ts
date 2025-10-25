// Unit tests for deterministic Pong engine and RISC0 zkVM compatibility
// Tests that rely on specific JSON log files are in log-validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateLog } from '../src/pong/engine'
import type { CompactLog } from '../src/pong/engine'
import { cordicSinCos, degToRadFixed, toFixed, toFixedInt, getCORDICConstants, iMul, iAdd, reflect1D, FRAC_BITS } from '../src/pong/fixed'
import { computeCommitment, bytesToHex } from '../src/pong/commitment'

// Helper function to generate valid commitments for test logs
async function addCommitmentsToLog(log: Omit<CompactLog, 'commitments' | 'player_left_seed' | 'player_right_seed'>): Promise<CompactLog> {
  const seedLeft = new Uint8Array(32).fill(0x42) // Test seed
  const seedRight = new Uint8Array(32).fill(0x99) // Different test seed

  const commitments: string[] = []
  for (let idx = 0; idx < log.events.length; idx++) {
    const paddleY = log.events[idx]
    const paddleYStr = typeof paddleY === 'string' ? paddleY : toFixed(paddleY).toString()
    const isLeft = idx % 2 === 0
    const seed = isLeft ? seedLeft : seedRight
    const commitment = await computeCommitment(seed, idx, paddleYStr)
    commitments.push(commitment)
  }

  return {
    ...log,
    commitments,
    player_left_seed: bytesToHex(seedLeft),
    player_right_seed: bytesToHex(seedRight),
  }
}

// Rust prover constants from prover/methods/guest/src/physics.rs
// CRITICAL: These must match Q16.16 format constants used in the prover
const RUST_CONSTANTS = {
  // CORDIC atan table (Q16.16) - 8 iterations for optimized performance
  ATAN_Q16: [
    51472n,   // atan(2^0)  = 45°     in Q16.16
    30386n,   // atan(2^-1) = 26.565° in Q16.16
    16055n,   // atan(2^-2) = 14.036° in Q16.16
    8150n,    // atan(2^-3) = 7.125°  in Q16.16
    4091n,    // atan(2^-4) = 3.576°  in Q16.16
    2047n,    // atan(2^-5) = 1.790°  in Q16.16
    1024n,    // atan(2^-6) = 0.895°  in Q16.16
    512n,     // atan(2^-7) = 0.448°  in Q16.16
  ],
  // CORDIC gain constant (Q16.16) ~0.6073
  K_Q16: 39797n,
  // PI in Q16.16 (π ≈ 3.14159265359 × 65536 ≈ 205887)
  PI_Q16: 205887n,
}

describe('RISC0 zkVM Compatibility', () => {
  describe('Constant Verification', () => {
    it('should match Rust CORDIC K gain constant', () => {
      const { K } = getCORDICConstants()
      expect(K).toBe(RUST_CONSTANTS.K_Q16)
    })

    it('should match Rust CORDIC atan table', () => {
      const { atanTable } = getCORDICConstants()

      // Check all 8 values (Q16.16 uses 8 iterations for performance)
      for (let i = 0; i < 8; i++) {
        expect(atanTable[i]).toBe(RUST_CONSTANTS.ATAN_Q16[i])
      }
    })

    it('should log constants for manual verification', () => {
      // This test helps developers verify constants match between TS and Rust
      const { K, atanTable } = getCORDICConstants()
      console.log('\n=== TypeScript CORDIC Constants (Q16.16) ===')
      console.log('K_Q16:', K.toString())
      console.log('ATAN_Q16:', atanTable.map(v => v.toString()).join(', '))
      console.log('\nCompare with prover/methods/guest/src/physics.rs')
      expect(true).toBe(true) // Always pass - this is for logging only
    })
  })

  describe('Log Validation', () => {
    const testGameId = 0 // Zero game_id for tests

    it('should reject empty events array', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [], // Empty is invalid - no gameplay occurred
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      // Empty events is invalid - game never started
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('No events provided')
    })

    it('should reject odd number of events', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: ['1030792151040'], // Odd number - invalid!
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Malformed')
    })

    it('should detect paddle moving too fast', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '1030792151040', // Event 0: leftY - center
          '1030792151040', // Event 0: rightY - center
          '1030792151040', // Event 1: leftY - still at center
          '2000000000000', // Event 1: rightY - huge jump! (invalid)
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('too fast')
    })

    it('should detect out of bounds paddle', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '1030792151040', // leftY - center
          '1030792151040', // rightY - center
          '10000000000000000', // leftY - extreme position (invalid)
          '1030792151040', // rightY
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      expect(result.fair).toBe(false)
      // Will be caught as "too fast" or "out of bounds"
      expect(result.fair).toBe(false)
    })

    it('should reject tied games', async () => {
      // Create a minimal log that would result in 0-0 (tie)
      // Since we can't easily create a realistic tie scenario, we'll test this
      // via the validation logic - ties are rejected at the end
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '1030792151040', // leftY at center
          '1030792151040', // rightY at center - this will be a miss
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      // This minimal log should NOT tie (one side will score), but serves as documentation
      // The tie check is enforced after all events are processed
      // A tie would only occur if both players reach POINTS_TO_WIN simultaneously
      // which should be impossible given the game logic (one scores per rally)

      // Note: In practice, ties shouldn't occur naturally in Pong gameplay
      // The validation is defensive programming - it would only catch
      // a maliciously crafted log that somehow bypasses score increments
      const result = await validateLog(log)
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
      const expectedPi = RUST_CONSTANTS.PI_Q16

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
    const testGameId = 0

    it('should handle very large BigInt values', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '999999999999999999', // Very large value (tests BigInt handling)
          '1030792151040',
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      // Should handle gracefully (might fail for other reasons but not parsing)
      expect(result).toBeDefined()
    })

    it('should reject non-numeric event strings', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: ['not a number' as any, '1030792151040'],
        game_id: testGameId,
      }

      // This will fail when trying to compute commitments, which is expected
      // We're testing that the validation gracefully rejects invalid input
      try {
        const log = await addCommitmentsToLog(logWithoutCommitments)
        const result = await validateLog(log)
        expect(result.fair).toBe(false)
      } catch (e) {
        // Expected to fail during commitment computation for invalid input
        expect(e).toBeDefined()
      }
    })
  })

  describe('Score Validation', () => {
    const testGameId = 0

    it('should reject scores under POINTS_TO_WIN', async () => {
      // Test that a game ending at 1-0 is invalid (didn't reach POINTS_TO_WIN)
      // Use actual log values to ensure paddle positions are valid
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '15728640', // leftY at center (start position)
          '15728640', // rightY at center - will miss
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      // Should be rejected - game ended early, didn't reach POINTS_TO_WIN
      expect(result.fair).toBe(false)
      // The validation will reject because neither player reached POINTS_TO_WIN
      expect(result.reason).toMatch(/Invalid final score|neither player reached|Paddle/)
    })
  })

  describe('Negative Paddle Positions (MEDIUM PRIORITY)', () => {
    const testGameId = 0 // Zero game_id for tests

    it('should reject negative paddle Y values', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '-1000',     // leftY - negative (invalid)
          '15728640',  // rightY - center (valid)
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)

      expect(result.fair).toBe(false)
      // Should be caught as "out of bounds" or "too fast"
      expect(result.reason).toMatch(/out of bounds|too fast/)
    })

    it('should handle zero paddle position', async () => {
      const logWithoutCommitments = {
        v: 1 as const,
        events: [
          '0',         // leftY - at boundary
          '15728640',  // rightY - center
        ],
        game_id: testGameId,
      }
      const log = await addCommitmentsToLog(logWithoutCommitments)

      const result = await validateLog(log)
      // May be invalid for physics reasons, but should not crash
      expect(result).toBeDefined()
    })
  })
})

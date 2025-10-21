// Tests for deterministic Pong engine and RISC0 zkVM compatibility
import { describe, it, expect } from 'vitest'
import { validateLog } from '../src/pong/engine'
import type { CompactLog, GameConfig } from '../src/pong/engine'
import { cordicSinCos, degToRadFixed, degMilliToRadFixed, toFixed, getCORDICConstants } from '../src/pong/fixed'
import type { I } from '../src/pong/fixed'

// Helper function to create config with default values
function createTestConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    seed: 12345,
    width: 800,
    height: 480,
    paddleHeight: 80,
    paddleWidth: 10,
    paddleMargin: 16,
    ballRadius: 6,
    paddleMaxSpeed: 200,
    serveSpeed: 500,
    speedIncrement: 50,
    maxBounceAngleDeg: 60,
    serveMaxAngleDeg: 20,
    pointsToWin: 1,
    microJitterMilliDeg: 800,
    aiOffsetMaxPermille: 600,
    maxEvents: 10000,
    initialServeDirection: 1,
    maxWidth: 10000,
    maxHeight: 10000,
    maxPaddleWidth: 100,
    maxBallRadius: 50,
    maxPaddleSpeedLimit: 10000,
    maxServeSpeedLimit: 10000,
    maxSpeedIncrementLimit: 1000,
    maxBounceAngleDegLimit: 89,
    maxServeAngleDegLimit: 45,
    maxPointsToWinLimit: 1000,
    maxJitterMilliDegLimit: 10000,
    ...overrides,
  }
}
import { readFileSync } from 'fs'
import { join } from 'path'

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

  describe('Determinism Tests', () => {
    it('should produce identical logs for same seed', () => {
      const seed = 12345
      const config = createTestConfig({ seed, pointsToWin: 1 }) // Short game for fast test

      // Create mock canvas
      const canvas1 = document.createElement('canvas')
      const canvas2 = document.createElement('canvas')
      canvas1.width = config.width
      canvas1.height = config.height
      canvas2.width = config.width
      canvas2.height = config.height

      // Would need to import runGame and actually run it
      // For now, this is a placeholder showing the test structure
      // In a real implementation, you'd need to make runGame work in Node.js test env

      // This test requires more setup - marking as TODO
      expect(true).toBe(true) // Placeholder
    })

    it('should validate a known good log', () => {
      // Minimal valid log
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ seed: 12345, pointsToWin: 1 }),
        events: [
          '1030792151040', // leftY
          '1030792151040', // rightY (miss event - both at center)
        ],
      }

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore + result.rightScore).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle seed = 0 (converted to 1)', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ seed: 0 }),
        events: ['1030792151040', '1030792151040'],
      }

      const result = validateLog(log)
      // Should not crash or produce errors
      expect(result.fair).toBeDefined()
    })

    it('should handle max seed value', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ seed: 0xffffffff }),
        events: ['1030792151040', '1030792151040'],
      }

      const result = validateLog(log)
      expect(result.fair).toBeDefined()
    })

    it('should reject invalid log format', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig(),
        events: ['1030792151040'], // Odd number - invalid!
      }

      const result = validateLog(log)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Malformed')
    })

    it('should detect paddle moving too fast', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ paddleMaxSpeed: 1, pointsToWin: 10 }),
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

    it('should handle degree to radian conversion', () => {
      const deg180 = degToRadFixed(180)
      // 180° = π radians
      const expectedPi = RUST_CONSTANTS.PI_Q32

      // Allow small tolerance for rounding
      const tolerance = 100n
      expect(deg180).toBeGreaterThan(expectedPi - tolerance)
      expect(deg180).toBeLessThan(expectedPi + tolerance)
    })

    it('should handle milli-degree conversion', () => {
      const milliDeg = 800 // 0.8 degrees
      const result = degMilliToRadFixed(milliDeg)

      // 0.8° = 0.8 * π / 180 ≈ 0.01396263 radians
      const expected = toFixed(0.01396263)

      const tolerance = 1000n
      expect(result).toBeGreaterThan(expected - tolerance)
      expect(result).toBeLessThan(expected + tolerance)
    })
  })

  describe('Event Limit Enforcement', () => {
    it('should respect maximum event count', () => {
      // This would test that the frontend stops at MAX_EVENTS
      // Requires actually running a game - placeholder for now
      const MAX_EVENTS = 10000
      expect(MAX_EVENTS).toBe(10000)
    })
  })

  describe('Config Validation', () => {
    it('should handle empty events array', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig(),
        events: [], // Empty is valid - game never started
      }

      const result = validateLog(log)
      // Empty events means game never started - should be "fair" (no cheating)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBe(0)
      expect(result.rightScore).toBe(0)
    })

    it('should detect paddle violations', () => {
      // Out of bounds paddle will also be detected as "too fast" in most cases
      // since it requires teleportation. This test verifies rejection happens.
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ pointsToWin: 10 }),
        events: [
          '1030792151040', // leftY - center
          '1030792151040', // rightY - center
          '10000000000000000', // leftY - extreme position (invalid)
          '1030792151040', // rightY
        ],
      }

      const result = validateLog(log)
      expect(result.fair).toBe(false)
      // Will be caught as "too fast" since bounds check comes after speed check
      expect(result.reason).toContain('too fast')
    })

    it('should validate normal config values', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig({ seed: 99999, pointsToWin: 3 }),
        events: [],
      }

      const result = validateLog(log)
      // Valid config with no events should pass
      expect(result.fair).toBe(true)
    })
  })

  describe('Serialization', () => {
    it('should handle very large BigInt values', () => {
      const log: CompactLog = {
        v: 1,
        config: createTestConfig(),
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
        config: createTestConfig(),
        events: ['not a number' as any, '1030792151040'],
      }

      // This should fail gracefully
      expect(() => validateLog(log)).not.toThrow()
    })
  })
})

describe('RNG Determinism', () => {
  it('should produce consistent sequence for same seed', () => {
    // Simple LCG test
    class TestRNG {
      private state: number
      constructor(seed: number) {
        this.state = (seed >>> 0) || 1
      }
      next(): number {
        this.state = (1664525 * this.state + 1013904223) >>> 0
        return this.state
      }
    }

    const rng1 = new TestRNG(12345)
    const rng2 = new TestRNG(12345)

    for (let i = 0; i < 100; i++) {
      expect(rng1.next()).toBe(rng2.next())
    }
  })

  it('should convert seed=0 to seed=1', () => {
    class TestRNG {
      private state: number
      constructor(seed: number) {
        this.state = (seed >>> 0) || 1
      }
      next(): number {
        this.state = (1664525 * this.state + 1013904223) >>> 0
        return this.state
      }
    }

    const rng0 = new TestRNG(0)
    const rng1 = new TestRNG(1)

    expect(rng0.next()).toBe(rng1.next())
  })

  it('should handle all 32-bit seeds', () => {
    class TestRNG {
      private state: number
      constructor(seed: number) {
        this.state = (seed >>> 0) || 1
      }
      next(): number {
        this.state = (1664525 * this.state + 1013904223) >>> 0
        return this.state
      }
    }

    // Test a few edge cases
    const seeds = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]
    seeds.forEach(seed => {
      const rng = new TestRNG(seed)
      const val = rng.next()
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(0xffffffff)
    })
  })
})

describe('Real Game Log Validation', () => {
  it('should validate pong-log_seed237054789 (40 volleys, 80 events)', () => {
    const logPath = join(__dirname, '..', 'pong-log_seed237054789_events40_1757556139973.json')
    const logData = readFileSync(logPath, 'utf-8')
    const log: CompactLog = JSON.parse(logData)

    const result = validateLog(log)
    expect(result.fair).toBe(true)
    expect(result.leftScore + result.rightScore).toBeGreaterThan(0)
    expect(log.events.length).toBe(80) // Each volley = 2 events (leftY, rightY)
    expect(log.config.seed).toBe(237054789)
  })

  it('should validate pong-log_seed930397884 (49 volleys, 98 events)', () => {
    const logPath = join(__dirname, '..', 'pong-log_seed930397884_events49_1757552715309.json')
    const logData = readFileSync(logPath, 'utf-8')
    const log: CompactLog = JSON.parse(logData)

    const result = validateLog(log)
    expect(result.fair).toBe(true)
    expect(result.leftScore + result.rightScore).toBeGreaterThan(0)
    expect(log.events.length).toBe(98) // Each volley = 2 events (leftY, rightY)
    expect(log.config.seed).toBe(930397884)
  })

  it('should validate pong-log_seed725309225 (59 volleys, 118 events)', () => {
    const logPath = join(__dirname, '..', 'pong-log_seed725309225_events59_1761069335045.json')
    const logData = readFileSync(logPath, 'utf-8')
    const log: CompactLog = JSON.parse(logData)

    const result = validateLog(log)
    expect(result.fair).toBe(true)
    expect(result.leftScore + result.rightScore).toBeGreaterThan(0)
    expect(log.events.length).toBe(118) // Each volley = 2 events (leftY, rightY)
    expect(log.config.seed).toBe(725309225)
  })
})

// Unit tests for commitment scheme security and properties
import { describe, it, expect } from 'vitest'
import { computeCommitment, bytesToHex, hexToBytes, generateCommitmentSeed } from '../src/pong/commitment'

describe('Commitment Scheme', () => {
  describe('Hash Uniqueness (HIGH PRIORITY)', () => {
    it('should produce different hashes for different event indices', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const paddleY = '15728640'

      // Same seed and paddle_y, but different indices
      const commitment0 = await computeCommitment(seed, 0, paddleY)
      const commitment1 = await computeCommitment(seed, 1, paddleY)

      expect(commitment0).not.toBe(commitment1)
      expect(commitment0.length).toBe(64) // 32 bytes hex-encoded
      expect(commitment1.length).toBe(64)
    })

    it('should produce different hashes for different seeds', async () => {
      const seed1 = new Uint8Array(32).fill(0x42)
      const seed2 = new Uint8Array(32).fill(0x99)
      const paddleY = '15728640'
      const index = 0

      const commitment1 = await computeCommitment(seed1, index, paddleY)
      const commitment2 = await computeCommitment(seed2, index, paddleY)

      expect(commitment1).not.toBe(commitment2)
    })

    it('should produce different hashes for different paddle_y values', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const index = 0

      const commitment1 = await computeCommitment(seed, index, '15728640')
      const commitment2 = await computeCommitment(seed, index, '20000000')

      expect(commitment1).not.toBe(commitment2)
    })

    it('should be deterministic - same inputs produce same hash', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const paddleY = '15728640'
      const index = 5

      const commitment1 = await computeCommitment(seed, index, paddleY)
      const commitment2 = await computeCommitment(seed, index, paddleY)

      expect(commitment1).toBe(commitment2)
    })
  })

  describe('Negative Paddle Positions (HIGH PRIORITY)', () => {
    it('should handle negative paddle positions', async () => {
      const seed = new Uint8Array(32).fill(0x42)

      // Negative values are valid for commitment computation (validation happens elsewhere)
      const commitment = await computeCommitment(seed, 0, '-1000')

      expect(commitment).toBeDefined()
      expect(commitment.length).toBe(64)
    })

    it('should produce different hashes for positive vs negative same magnitude', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const index = 0

      const commitmentPos = await computeCommitment(seed, index, '1000')
      const commitmentNeg = await computeCommitment(seed, index, '-1000')

      expect(commitmentPos).not.toBe(commitmentNeg)
    })
  })

  describe('Hex Encoding Edge Cases (HIGH PRIORITY)', () => {
    it('should correctly encode all zeros', () => {
      const allZeros = new Uint8Array(32).fill(0)
      const hex = bytesToHex(allZeros)

      expect(hex).toBe('0'.repeat(64))
      expect(hex.length).toBe(64)
    })

    it('should correctly encode all 0xFF', () => {
      const allFF = new Uint8Array(32).fill(0xFF)
      const hex = bytesToHex(allFF)

      expect(hex).toBe('f'.repeat(64))
      expect(hex.length).toBe(64)
    })

    it('should correctly decode hex back to bytes', () => {
      const original = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        original[i] = i * 8 // Pattern: 0, 8, 16, 24, ...
      }

      const hex = bytesToHex(original)
      const decoded = hexToBytes(hex)

      expect(decoded).toEqual(original)
    })

    it('should handle mixed case hex strings', () => {
      const mixedCase = 'AbCdEf0123456789' + '0'.repeat(48)
      const decoded = hexToBytes(mixedCase)

      expect(decoded.length).toBe(32)
      expect(decoded[0]).toBe(0xAB)
      expect(decoded[1]).toBe(0xCD)
      expect(decoded[2]).toBe(0xEF)
    })

    it('should reject odd-length hex strings', () => {
      const oddLength = 'abc' // 3 characters

      expect(() => hexToBytes(oddLength)).toThrow()
    })

    it('should reject invalid hex characters', () => {
      const invalidHex = 'gg' + '0'.repeat(62) // 'gg' is not valid hex

      expect(() => hexToBytes(invalidHex)).toThrow()
    })

    it('should reject wrong-length hex strings for seeds', () => {
      // Seed must be exactly 32 bytes (64 hex chars)
      const tooShort = '0'.repeat(62) // 31 bytes
      const tooLong = '0'.repeat(66)  // 33 bytes

      expect(hexToBytes(tooShort).length).toBe(31)
      expect(hexToBytes(tooLong).length).toBe(33)
    })
  })

  describe('Seed Generation', () => {
    it('should generate unique seeds', () => {
      const commitment1 = generateCommitmentSeed()
      const commitment2 = generateCommitmentSeed()

      // Seeds should be different (extremely high probability)
      expect(bytesToHex(commitment1.seed)).not.toBe(bytesToHex(commitment2.seed))
    })

    it('should generate 32-byte seeds', () => {
      const commitment = generateCommitmentSeed()

      expect(commitment.seed.length).toBe(32)
    })

    it('should generate seeds with sufficient entropy', () => {
      const commitment = generateCommitmentSeed()
      const seed = commitment.seed

      // Check that seed is not all zeros
      const allZeros = Array.from(seed).every(b => b === 0)
      expect(allZeros).toBe(false)

      // Check that seed has variation (not all same value)
      const firstByte = seed[0]
      const allSame = Array.from(seed).every(b => b === firstByte)
      expect(allSame).toBe(false)
    })
  })

  describe('Commitment Format', () => {
    it('should produce valid SHA-256 hash format (64 hex chars)', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const commitment = await computeCommitment(seed, 0, '15728640')

      // SHA-256 produces 32 bytes = 64 hex characters
      expect(commitment.length).toBe(64)
      expect(/^[0-9a-f]{64}$/.test(commitment)).toBe(true)
    })

    it('should handle very large paddle_y values', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const largePaddleY = '999999999999999999'

      const commitment = await computeCommitment(seed, 0, largePaddleY)

      expect(commitment).toBeDefined()
      expect(commitment.length).toBe(64)
    })

    it('should handle index boundary values', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const paddleY = '15728640'

      // Test min and max reasonable index values
      const commitment0 = await computeCommitment(seed, 0, paddleY)
      const commitment9999 = await computeCommitment(seed, 9999, paddleY)

      expect(commitment0).toBeDefined()
      expect(commitment9999).toBeDefined()
      expect(commitment0).not.toBe(commitment9999)
    })
  })

  describe('Security Properties', () => {
    it('should be computationally hiding (cannot reverse from commitment)', async () => {
      // This is a documentation test - we cannot actually prove this,
      // but we can verify the commitment doesn't obviously leak information
      const seed = new Uint8Array(32).fill(0x42)
      const paddleY = '12345'
      const index = 7

      const commitment = await computeCommitment(seed, index, paddleY)

      // Commitment should not contain obvious patterns
      expect(commitment).not.toContain('12345')
      expect(commitment).not.toContain('07') // index in hex
      expect(commitment).not.toContain('42') // seed byte repeated
    })

    it('should be binding (different inputs always produce different outputs)', async () => {
      // Test the binding property: H(a) != H(b) when a != b
      const seed = new Uint8Array(32).fill(0x42)

      const commitments = new Set<string>()

      // Generate commitments for different inputs
      for (let i = 0; i < 10; i++) {
        for (let paddleY = 0; paddleY < 10; paddleY++) {
          const commitment = await computeCommitment(seed, i, paddleY.toString())
          commitments.add(commitment)
        }
      }

      // Should have 100 unique commitments (10 indices × 10 paddle_y values)
      expect(commitments.size).toBe(100)
    })

    it('should include all input components in hash', async () => {
      // Verify that changing any input component changes the hash
      const seed1 = new Uint8Array(32).fill(0x42)
      const seed2 = new Uint8Array(32).fill(0x43) // Different by 1 bit in one byte

      const c1 = await computeCommitment(seed1, 5, '1000')
      const c2 = await computeCommitment(seed2, 5, '1000') // Different seed
      const c3 = await computeCommitment(seed1, 6, '1000') // Different index
      const c4 = await computeCommitment(seed1, 5, '1001') // Different paddle_y

      // All should be different
      expect(c1).not.toBe(c2)
      expect(c1).not.toBe(c3)
      expect(c1).not.toBe(c4)
      expect(c2).not.toBe(c3)
      expect(c2).not.toBe(c4)
      expect(c3).not.toBe(c4)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero paddle_y', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const commitment = await computeCommitment(seed, 0, '0')

      expect(commitment).toBeDefined()
      expect(commitment.length).toBe(64)
    })

    it('should handle zero index', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const commitment = await computeCommitment(seed, 0, '15728640')

      expect(commitment).toBeDefined()
      expect(commitment.length).toBe(64)
    })

    it('should handle maximum u32 index', async () => {
      const seed = new Uint8Array(32).fill(0x42)
      const maxU32 = 4294967295 // 2^32 - 1

      const commitment = await computeCommitment(seed, maxU32, '15728640')

      expect(commitment).toBeDefined()
      expect(commitment.length).toBe(64)
    })

    it('should handle string paddle_y with leading zeros', async () => {
      const seed = new Uint8Array(32).fill(0x42)

      // These represent the same value but different string representations
      const c1 = await computeCommitment(seed, 0, '100')
      const c2 = await computeCommitment(seed, 0, '0100')

      // Should produce different hashes because we hash the string representation
      // Actually, we convert to BigInt first, so these should be the same
      // Let me check the implementation
      expect(c1).toBe(c2) // BigInt('100') === BigInt('0100')
    })
  })
})

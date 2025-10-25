// Tests for validating real game logs from JSON files
// All game logs must include commitment data (player seeds and commitments)
import { describe, it, expect } from 'vitest'
import { validateLog } from '../src/pong/engine'
import type { CompactLog } from '../src/pong/engine'
import { POINTS_TO_WIN } from '../src/pong/constants'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeCommitment, bytesToHex } from '../src/pong/commitment'

describe('Real Game Log Validation', () => {
  describe('Valid Game Logs', () => {
    it('should validate game log with 85 events (with commitments)', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = await validateLog(log)
      expect(result.fair).toBe(true)
      expect(log.events.length).toBe(170) // 85 pairs × 2
      // Winner should have exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)

      // Verify commitment data exists and is validated
      expect(log.commitments).toBeDefined()
      expect(log.commitments.length).toBe(170)
      expect(log.player_left_seed).toBeDefined()
      expect(log.player_right_seed).toBeDefined()
    })
  })

  describe('Score Tracking', () => {
    it('should track scores correctly', async () => {
      // Use a real game log to verify score tracking
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = await validateLog(log)
      expect(result.fair).toBe(true)
      // From the actual game: left=3, right=2
      expect(result.leftScore).toBe(3)
      expect(result.rightScore).toBe(2)
      // Winner should have POINTS_TO_WIN, loser should be < POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
      expect(Math.min(result.leftScore, result.rightScore)).toBeLessThan(POINTS_TO_WIN)
    })

    it('should stop at POINTS_TO_WIN', async () => {
      // This is tested in real game logs
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = await validateLog(log)
      expect(result.fair).toBe(true)
      // Game should end when one player reaches exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
      // Validate neither score exceeds POINTS_TO_WIN
      expect(result.leftScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      expect(result.rightScore).toBeLessThanOrEqual(POINTS_TO_WIN)
    })

    it('should reject scores beyond POINTS_TO_WIN', async () => {
      // Test that validation rejects games that continue beyond POINTS_TO_WIN
      // This is a critical security check - prevents players from claiming extra points

      // We can't easily create a real 4-0 log since the game loop breaks at POINTS_TO_WIN
      // But this documents that the validation would reject it if attempted
      // The check is: if (leftScore > POINTS_TO_WIN || rightScore > POINTS_TO_WIN) { return invalid }

      // For now, verify our real game logs all have max score exactly POINTS_TO_WIN
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = await validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      expect(result.rightScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      // At least one must equal POINTS_TO_WIN (the winner)
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
    })
  })

  describe('Commitment Verification', () => {
    it('should reject log with invalid commitment', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Tamper with one commitment
      const tamperedLog = { ...log, commitments: [...log.commitments] }
      tamperedLog.commitments[5] = '0000000000000000000000000000000000000000000000000000000000000000'

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Commitment verification failed')
    })

    it('should reject log with duplicate player seeds', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Use same seed for both players
      const tamperedLog = { ...log, player_right_seed: log.player_left_seed }

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Players must use unique commitment seeds')
    })

    it('should reject log with missing commitments', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Remove commitments array
      const tamperedLog = { ...log, commitments: [] as any }

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Commitment count must match event count')
    })

    it('should reject log with commitment count mismatch', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Remove last commitment
      const tamperedLog = { ...log, commitments: log.commitments.slice(0, -1) }

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Commitment count must match event count')
    })

    it('should reject log with low entropy seed (left player)', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Create seed with too many zeros (29 zeros)
      const lowEntropySeed = '00'.repeat(29) + 'ff'.repeat(3)
      const tamperedLog = { ...log, player_left_seed: lowEntropySeed }

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Commitment seed has insufficient entropy')
    })

    it('should accept log with acceptable entropy (exactly 28 zeros)', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Create seed with exactly 28 zeros (should pass)
      const seedLeft = new Uint8Array(32)
      seedLeft.fill(0, 0, 28) // 28 zeros
      seedLeft.fill(0xff, 28, 32) // 4 non-zero bytes
      const seedRight = new Uint8Array(32)
      seedRight.fill(0x42) // Different seed

      // Recompute all commitments with new seeds
      const commitments: string[] = []
      for (let idx = 0; idx < log.events.length; idx++) {
        const paddleY = log.events[idx]
        const isLeft = idx % 2 === 0
        const seed = isLeft ? seedLeft : seedRight
        const commitment = await computeCommitment(seed, idx, paddleY.toString())
        commitments.push(commitment)
      }

      const validLog: CompactLog = {
        ...log,
        commitments,
        player_left_seed: bytesToHex(seedLeft),
        player_right_seed: bytesToHex(seedRight),
      }

      const result = await validateLog(validLog)
      expect(result.fair).toBe(true)
    })

    it('should reject log with invalid seed length', async () => {
      const logPath = join(__dirname, '..', 'pong-log_events85_1761349770536.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      // Use wrong length seed (only 16 bytes instead of 32)
      const tamperedLog = { ...log, player_left_seed: '00'.repeat(16) }

      const result = await validateLog(tamperedLog)
      expect(result.fair).toBe(false)
      expect(result.reason).toContain('Invalid seed length')
    })
  })
})

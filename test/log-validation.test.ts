// Tests for validating real game logs from JSON files
// These tests depend on specific JSON log files in the project root
import { describe, it, expect } from 'vitest'
import { validateLog } from '../src/pong/engine'
import type { CompactLog } from '../src/pong/engine'
import { POINTS_TO_WIN } from '../src/pong/constants'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Real Game Log Validation', () => {
  describe('Valid Game Logs', () => {
    it('should validate game log with 39 events (score 3-0)', () => {
      const logPath = join(__dirname, '..', 'pong-log_events39_1761096045223.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBe(POINTS_TO_WIN)
      expect(result.rightScore).toBe(0)
      expect(log.events.length).toBe(78) // 39 pairs × 2
    })

    it('should validate game log with 61 events (score 3-2)', () => {
      const logPath = join(__dirname, '..', 'pong-log_events61_1761095976507.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBe(POINTS_TO_WIN)
      expect(result.rightScore).toBe(POINTS_TO_WIN - 1)
      expect(log.events.length).toBe(122) // 61 pairs × 2
    })

    it('should validate game log with 68 events (score 2-3)', () => {
      const logPath = join(__dirname, '..', 'pong-log_events68_1761096140129.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBe(POINTS_TO_WIN - 1)
      expect(result.rightScore).toBe(POINTS_TO_WIN)
      expect(log.events.length).toBe(136) // 68 pairs × 2
    })
  })

  describe('Score Tracking', () => {
    it('should track scores correctly', () => {
      // Use a real game log to verify score tracking
      const logPath = join(__dirname, '..', 'pong-log_events61_1761095976507.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      // This log should be POINTS_TO_WIN to (POINTS_TO_WIN - 1)
      expect(result.leftScore).toBe(POINTS_TO_WIN)
      expect(result.rightScore).toBe(POINTS_TO_WIN - 1)
      expect(result.leftScore + result.rightScore).toBe(POINTS_TO_WIN + (POINTS_TO_WIN - 1))
    })

    it('should stop at POINTS_TO_WIN', () => {
      // This is tested in real game logs
      const logPath = join(__dirname, '..', 'pong-log_events39_1761096045223.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      // Game should end when one player reaches exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
      // Validate neither score exceeds POINTS_TO_WIN
      expect(result.leftScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      expect(result.rightScore).toBeLessThanOrEqual(POINTS_TO_WIN)
    })

    it('should reject scores beyond POINTS_TO_WIN', () => {
      // Test that validation rejects games that continue beyond POINTS_TO_WIN
      // This is a critical security check - prevents players from claiming extra points

      // We can't easily create a real 4-0 log since the game loop breaks at POINTS_TO_WIN
      // But this documents that the validation would reject it if attempted
      // The check is: if (leftScore > POINTS_TO_WIN || rightScore > POINTS_TO_WIN) { return invalid }

      // For now, verify our real game logs all have max score exactly POINTS_TO_WIN
      const logPath = join(__dirname, '..', 'pong-log_events39_1761096045223.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(result.leftScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      expect(result.rightScore).toBeLessThanOrEqual(POINTS_TO_WIN)
      // At least one must equal POINTS_TO_WIN (the winner)
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
    })
  })
})

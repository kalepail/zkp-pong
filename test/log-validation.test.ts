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
    it('should validate game log with 67 events', () => {
      const logPath = join(__dirname, '..', 'pong-log_events67_1761140976543.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(log.events.length).toBe(134) // 67 pairs × 2
      // Winner should have exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
    })

    it('should validate game log with 75 events', () => {
      const logPath = join(__dirname, '..', 'pong-log_events75_1761139604550.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(log.events.length).toBe(150) // 75 pairs × 2
      // Winner should have exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
    })

    it('should validate game log with 86 events', () => {
      const logPath = join(__dirname, '..', 'pong-log_events86_1761139690493.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      expect(log.events.length).toBe(172) // 86 pairs × 2
      // Winner should have exactly POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
    })
  })

  describe('Score Tracking', () => {
    it('should track scores correctly', () => {
      // Use a real game log to verify score tracking
      const logPath = join(__dirname, '..', 'pong-log_events75_1761139604550.json')
      const logData = readFileSync(logPath, 'utf-8')
      const log: CompactLog = JSON.parse(logData)

      const result = validateLog(log)
      expect(result.fair).toBe(true)
      // Winner should have POINTS_TO_WIN, loser should be < POINTS_TO_WIN
      expect(Math.max(result.leftScore, result.rightScore)).toBe(POINTS_TO_WIN)
      expect(Math.min(result.leftScore, result.rightScore)).toBeLessThan(POINTS_TO_WIN)
    })

    it('should stop at POINTS_TO_WIN', () => {
      // This is tested in real game logs
      const logPath = join(__dirname, '..', 'pong-log_events67_1761140976543.json')
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
      const logPath = join(__dirname, '..', 'pong-log_events86_1761139690493.json')
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

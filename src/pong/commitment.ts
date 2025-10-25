// SHA-256 commitment utilities for Pong game events

/**
 * Player's commitment seed (32 random bytes)
 */
export interface PlayerCommitment {
  seed: Uint8Array // 32 bytes of randomness
}

/**
 * Generate a new random seed for commitment scheme
 */
export function generateCommitmentSeed(): PlayerCommitment {
  return {
    seed: crypto.getRandomValues(new Uint8Array(32)),
  }
}

/**
 * Compute SHA-256 commitment for a paddle position
 * Format: SHA256(seed || event_index || paddle_y)
 *
 * @param seed - Player's 32-byte random seed
 * @param eventIndex - Index of this event in the game (0, 1, 2, ...)
 * @param paddleY - Paddle Y position as Q16.16 fixed-point string
 * @returns Hex-encoded SHA-256 commitment (32 bytes / 64 hex chars)
 */
export async function computeCommitment(
  seed: Uint8Array,
  eventIndex: number,
  paddleY: string
): Promise<string> {
  // Build message: seed (32 bytes) || event_index (4 bytes LE) || paddle_y (8 bytes LE)
  const buffer = new ArrayBuffer(32 + 4 + 8)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Copy seed (32 bytes)
  bytes.set(seed, 0)

  // event_index as little-endian u32 (4 bytes)
  view.setUint32(32, eventIndex, true)

  // paddle_y as little-endian i64 (8 bytes)
  const paddleYInt = BigInt(paddleY)
  view.setBigInt64(36, paddleYInt, true)

  // Compute SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = new Uint8Array(hashBuffer)

  // Convert to hex string
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert hex string to bytes
 * @throws Error if hex string is invalid (odd length or contains non-hex characters)
 */
export function hexToBytes(hex: string): Uint8Array {
  // Validate hex string
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string: odd length (${hex.length})`)
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string: contains non-hexadecimal characters')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

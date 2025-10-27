# Desync Fix: Using Exchanged Paddle Positions for Hit Detection

## The Problem

Players were desyncing on hit/miss detection, causing one player to think an event was a hit while the other thought it was a miss. This led to:
- Different final scores
- Timeouts waiting for paddle positions
- Games getting stuck at "waiting for merged log"

## Root Cause

The issue was that **hit detection was using local paddle predictions instead of the exchanged paddle positions**.

**UPDATE**: After implementing the initial fix, a critical bug was introduced where Q16.16 fixed-point values (stored as strings like "15728640") were being parsed as regular floats instead of being converted properly from fixed-point format. This caused every paddle to appear far off-screen, making all hits register as misses.

### What Was Happening

1. **Both players compute paddle positions** using local AI motion models:
   ```typescript
   const leftYAtHitI = paddleYAtFixed(leftM, tHitI)  // Local prediction
   const rightYAtHitI = paddleYAtFixed(rightM, tHitI)  // Local prediction
   ```

2. **AI uses randomness** for targeting:
   ```typescript
   const randomOffset = Math.random() * paddleHeightPixels - (paddleHeightPixels / 2)
   ```

3. **Predictions diverge** over time due to different `Math.random()` calls

4. **Players exchange paddle positions** ✅
   ```typescript
   sendPaddlePosition(myPaddleY)
   opponentPaddleY = await waitForOpponentPaddle()
   ```

5. **But hit detection used local predictions!** ❌
   ```typescript
   const hit = movingLeft
     ? Math.abs(leftYAtHit - yAtHit) <= half + BALL_RADIUS  // leftYAtHit from LOCAL
     : Math.abs(rightYAtHit - yAtHit) <= half + BALL_RADIUS  // rightYAtHit from LOCAL
   ```

6. **Result:** Players disagree on hit/miss → desync!

### Example Desync

**Event 52:**
```
Left player:  hit = true   (using local leftYAtHit = 15728640)
Right player: hit = false  (using local rightYAtHit = 6777440)
```

Even though they exchanged these positions, they didn't USE them for hit detection!

## The Fix

Use the **exchanged paddle positions** for hit detection, not local predictions.

### Before (Desyncs)

```typescript
// Compute local predictions
const leftYAtHitI = paddleYAtFixed(leftM, tHitI)
const rightYAtHitI = paddleYAtFixed(rightM, tHitI)
const leftYAtHit = fromFixed(leftYAtHitI)
const rightYAtHit = fromFixed(rightYAtHitI)

// Send and receive
sendPaddlePosition(myPaddleY)
opponentPaddleY = await waitForOpponentPaddle()

// Use LOCAL predictions for hit detection ❌
const hit = movingLeft
  ? Math.abs(leftYAtHit - yAtHit) <= half + BALL_RADIUS
  : Math.abs(rightYAtHit - yAtHit) <= half + BALL_RADIUS
```

### After (Synchronized)

```typescript
// Compute local predictions (only for commitment)
const leftYAtHitI = paddleYAtFixed(leftM, tHitI)
const rightYAtHitI = paddleYAtFixed(rightM, tHitI)
const myPaddleY = role === 'left' ? leftYAtHitI : rightYAtHitI

// Send and receive
sendPaddlePosition(myPaddleY.toString())
opponentPaddleY = await waitForOpponentPaddle()

// Get exchanged positions as Q16.16 fixed-point values ✅
const finalLeftYI = role === 'left' ? myPaddleY : (BigInt(opponentPaddleY) as I)
const finalRightYI = role === 'right' ? myPaddleY : (BigInt(opponentPaddleY) as I)

// Convert from fixed-point to float for hit detection ✅
const finalLeftYNum = fromFixed(finalLeftYI)
const finalRightYNum = fromFixed(finalRightYI)

const finalHit = movingLeft
  ? Math.abs(finalLeftYNum - yAtHit) <= half + BALL_RADIUS
  : Math.abs(finalRightYNum - yAtHit) <= half + BALL_RADIUS
```

## Critical Implementation Detail: Fixed-Point Conversion

**IMPORTANT**: Exchanged paddle positions are stored as Q16.16 fixed-point integers in string format (e.g., "15728640" represents 240.0 pixels).

**Wrong (causes all hits to be misses)**:
```typescript
const finalLeftYNum = parseFloat(finalLeftY)  // ❌ Gives 15728640, not 240!
```

**Correct**:
```typescript
const finalLeftYI = BigInt(opponentPaddleY) as I  // Parse as bigint
const finalLeftYNum = fromFixed(finalLeftYI)      // Convert Q16.16 → float (240.0)
```

The `fromFixed()` function divides by 2^16 to convert from fixed-point to floating-point.

## Why This Works

1. **Both players exchange paddle positions** via WebSocket (as Q16.16 strings)
2. **Both players convert from fixed-point properly** using `fromFixed()`
3. **Both players use the SAME values** for hit detection
4. **No desync possible** - hit detection is deterministic from exchanged data
5. **AI randomness doesn't matter** - only affects local predictions, not the exchanged values

## Benefits

✅ **Perfect synchronization**: Both players always agree on hit/miss
✅ **Server-verified**: Server stores the same paddle positions
✅ **No race conditions**: Game ends at the same event for both players
✅ **Deterministic replay**: Log can be replayed with same results

## Testing

Before fix:
```
Left:  Event 52 hit=true  → continues playing
Right: Event 52 hit=false → game ends
Result: Timeout, stuck at "waiting for merged log"
```

After fix:
```
Left:  Event 52 hit=false → game ends
Right: Event 52 hit=false → game ends
Result: Both receive merged log ✅
```

## Related Files

- `src/pong/engine-p2p.ts`: Updated hit detection logic
- Server: Already using exchanged values (no change needed)

## Key Insight

**The exchanged paddle positions are the single source of truth.**

Local AI predictions are useful for:
- Computing what value to send (before exchange)
- Smooth animation between events

But for **game-critical decisions** (hit/miss, score changes), we MUST use the exchanged values, not local predictions.

## Additional Fix: Deterministic AI Targeting

**Problem**: AI paddle targeting used `Math.random()` for offsets, causing each player to predict different opponent paddle positions. This created visual "jumping" when exchanged positions arrived.

**Solution**: Use seeded RNG with proper entropy mixing so both players predict identical paddle movements:

```typescript
// OLD - non-deterministic
const randomOffset = Math.random() * paddleHeightPixels - (paddleHeightPixels / 2)

// NEW - deterministic hash function for better distribution
let hash = ((eventIndex * 1664525 + gameId * 1013904223) | 0) >>> 0
hash = hash ^ (hash >>> 16)
hash = (hash * 0x85ebca6b) | 0
hash = hash ^ (hash >>> 13)

const offsetRange = paddleHeightPixels // 80 pixels
const offsetRaw = ((hash >>> 0) % offsetRange) | 0
const randomOffset = offsetRaw - (paddleHeightPixels / 2) // Range: [-40, +40]
```

The hash function uses:
- **LCG constants** (1664525, 1013904223) for initial mixing
- **XOR-shift operations** to distribute bits evenly
- **Multiplier** (0x85ebca6b) for additional mixing
- Result: uniform distribution across [-40, +40] range

This ensures:
- ✅ Both players predict **identical** opponent paddle positions
- ✅ Smooth gameplay without visual jumps
- ✅ **Uniform distribution** - no bias toward top/bottom of paddle
- ✅ Predictions are still "random enough" for interesting gameplay
- ✅ Fully deterministic and reproducible given `game_id`

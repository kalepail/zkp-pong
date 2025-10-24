# Pong-a-bing-bong Project Instructions

## Project Overview

This is a deterministic, event-driven Pong engine designed for reproducible gameplay, compact logging, and zero-knowledge proof validation via RISC Zero zkVM.

**Architecture:** TypeScript frontend generates game logs → Rust RISC Zero prover validates logs → zkVM proof of fairness

**Package Manager:** This project uses `pnpm`. Always use `pnpm` commands:
```bash
pnpm install
pnpm test
pnpm dev
pnpm build
```

## Directory Structure

- `src/` - TypeScript frontend game engine
  - `src/pong/engine.ts` - Core game logic and validation
  - `src/pong/fixed.ts` - Fixed-point math utilities
  - `src/pong/constants.ts` - Game configuration (MUST match prover)
- `test/` - TypeScript test suite
- `prover/` - Rust RISC Zero prover workspace
  - `prover/core/` - Shared no_std types
  - `prover/host/` - Host program (proof generation)
  - `prover/methods/guest/` - Guest code (zkVM validation)

## Critical Rules

### 1. Constants Synchronization

**CRITICAL**: Constants in `src/pong/constants.ts` must match `prover/methods/guest/src/constants.rs` exactly. Any change to one requires updating the other:

- Dimensions: WIDTH, HEIGHT, PADDLE_HEIGHT, PADDLE_WIDTH, PADDLE_MARGIN, BALL_RADIUS
- Speeds: SERVE_SPEED, PADDLE_MAX_SPEED, SPEED_INCREMENT
- Angles: MAX_BOUNCE_ANGLE_DEG, ANGLE_RANGE, SERVE_ANGLE_MULTIPLIER
- Game rules: POINTS_TO_WIN, INITIAL_SERVE_DIRECTION, MAX_EVENTS

### 2. Integer Math Policy

- **ALL physics must use fixed-point integer math** (Q16.16 via BigInt)
- Never persist or log floating-point values
- Console/debug output must print integer fixed-point values as strings
- Rendering may use floats for canvas, but never for game logic
- Fixed-point operations must be bit-identical between TypeScript and Rust

### 3. Deterministic Serve Angles

**IMPORTANT**: The serve angle calculation was recently fixed to prevent invalid angles.

Current correct implementation:
```typescript
const entropyMix = (volleyCount + gameId) | 0
const angleRaw = ((((entropyMix * SERVE_ANGLE_MULTIPLIER) | 0) % ANGLE_RANGE) + ANGLE_RANGE) % ANGLE_RANGE - MAX_BOUNCE_ANGLE_DEG
```

Key points:
- Uses Euclidean modulo `((x % n) + n) % n` to ensure positive remainder
- JavaScript's `%` can return negative values, which causes invalid angles
- Must match Rust's `rem_euclid()` behavior exactly
- Ensures all angles stay within -60° to +60° range

### 4. Game Log Format

Logs are compact JSON with three fields:
```json
{
  "v": 1,
  "game_id": 2656024802,
  "events": ["15728640", "15728640", ...]
}
```

- `v`: Version (always 1)
- `game_id`: Unique u32 identifier (used for serve angle entropy)
- `events`: Flat array of Q16.16 paddle positions as strings [leftY, rightY, leftY, rightY, ...]

### 5. Testing

Run tests frequently:
```bash
pnpm test
```

Tests cover:
- Game engine and physics (`test/engine.test.ts`)
- Log validation (`test/log-validation.test.ts`)
- Real game logs with new test JSON files
- Determinism and edge cases

## Working with the Prover

When working on prover code, always use `RISC0_DEV_MODE=1`:
```bash
cd prover
env RISC0_DEV_MODE=1 cargo test
env RISC0_DEV_MODE=1 cargo run -- ../pong-log.json
```

See `prover/.claude/instructions.md` for detailed prover-specific guidelines.

## Physics Implementation

- **Analytical motion**: Ball moves between discrete paddle-plane events
- **No frame loops**: Y-axis bounces use reflection mapping, not per-frame checks
- **Event-driven**: Simulation only advances at paddle collision times
- **Deterministic**: Same inputs always produce same outputs (no randomness)

## Common Workflows

### Testing a Change

1. Make changes to TypeScript or Rust
2. If constants changed, update both `src/pong/constants.ts` and `prover/methods/guest/src/constants.rs`
3. Run TypeScript tests: `pnpm test`
4. Run prover tests: `cd prover && env RISC0_DEV_MODE=1 cargo test`
5. Verify both pass before committing

### Generating Test Logs

1. Run the game in browser
2. Complete a full game (one player reaches POINTS_TO_WIN)
3. Export log JSON
4. Place in project root with naming: `pong-log_events{N}_{timestamp}.json`
5. Update test files to reference new logs if needed

## Recent Changes

### Serve Angle Fix (Oct 2025)

Fixed critical bug where ~50% of serves generated invalid angles outside -60° to +60° range due to JavaScript modulo handling negative numbers incorrectly. All serve angle calculations now use Euclidean modulo. See `SERVE_ANGLE_FIX.md` for details.

## Documentation

- `AGENTS.md` - Complete project guidelines and architecture
- `SERVE_ANGLE_FIX.md` - Details on the serve angle bug fix
- `AUDIT.md` - Security audit findings
- `prover/.claude/instructions.md` - Prover-specific instructions

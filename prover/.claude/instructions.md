# RISC Zero Prover Instructions

## CRITICAL: Always Use RISC0_DEV_MODE=1

When running any `cargo test` or `cargo run` commands in the prover directory, **ALWAYS** prefix them with `RISC0_DEV_MODE=1`:

```bash
# Correct
RISC0_DEV_MODE=1 cargo test
RISC0_DEV_MODE=1 cargo run

# Incorrect (will be extremely slow)
cargo test
cargo run
```

### Why This Matters

- **Without `RISC0_DEV_MODE=1`**: Tests will attempt to generate actual ZK proofs, which can take 10-30 minutes or more per test
- **With `RISC0_DEV_MODE=1`**: Tests run in development mode, completing in seconds

### Example Commands

```bash
# Run all tests
RISC0_DEV_MODE=1 cargo test

# Run specific test
RISC0_DEV_MODE=1 cargo test test_valid_game

# Build and run the prover
RISC0_DEV_MODE=1 cargo run -- input.json

# Check compilation
RISC0_DEV_MODE=1 cargo check
```

**Note:** Development mode proofs are **NOT** secure and should **NEVER** be used in production. They are only for testing and development purposes.

---

## Project Architecture

This prover validates deterministic Pong game logs using RISC Zero zkVM.

**Workspace Structure:**
- `core/` - Shared no_std types (ValidateLogInput/Output, hash computation)
- `host/` - Host program (loads logs, generates proofs)
- `methods/guest/` - Guest code (runs in zkVM, validates physics)

**Flow:** TypeScript frontend generates game logs → Rust prover validates logs → zkVM proof of fairness

## Key Validation Rules

1. **Event Structure**
   - Must be pairs (leftY, rightY)
   - Non-empty, under 10,000 event limit
   - Each event is two Q16.16 fixed-point paddle positions

2. **Physics Validation**
   - Kinematics: ball must reach paddle plane in positive time (dt > 0)
   - Reachability: paddle movement ≤ max_speed * dt between events
   - Bounds: paddles stay within field boundaries
   - Deterministic bounces using event-count-based serve angles

3. **Serve Angle Calculation**
   - **CRITICAL**: Uses Euclidean modulo to prevent invalid angles
   - Formula: `angle = -MAX_BOUNCE_ANGLE + ((((entropy_mix * MULTIPLIER) % RANGE) + RANGE) % RANGE)`
   - Where `entropy_mix = event_count + game_id`
   - Must match TypeScript implementation exactly

4. **Final Score**
   - Exactly one player reaches POINTS_TO_WIN (3)
   - No ties allowed
   - SHA-256 hash with "PONGLOGv1" prefix included in proof

## Constants Synchronization

**CRITICAL**: Constants in `methods/guest/src/constants.rs` must match frontend exactly:
- Dimensions (WIDTH, HEIGHT, PADDLE_HEIGHT, etc.)
- Speeds (SERVE_SPEED, PADDLE_MAX_SPEED, SPEED_INCREMENT)
- Angles (MAX_BOUNCE_ANGLE_DEG, ANGLE_RANGE, SERVE_ANGLE_MULTIPLIER)
- Game rules (POINTS_TO_WIN, MAX_EVENTS)

Any changes to frontend constants require matching updates in prover.

## Integer Math Policy

- All physics uses Q16.16 fixed-point integer math
- Never use floating-point in validation logic
- Fixed-point must be bit-identical between TypeScript and Rust
- Use `wrapping_mul()` and `rem_euclid()` for overflow safety

## Testing

Run tests with:
```bash
RISC0_DEV_MODE=1 cargo test
```

Tests validate:
- Real game logs from JSON files
- Paddle reachability constraints
- Score tracking and final score validation
- Edge cases (extreme values, boundary conditions)
- Determinism (identical physics produces consistent results)

# RISC Zero Prover - Agent Guidelines

This directory contains the RISC Zero zkVM prover for validating Pong game logs.

## CRITICAL: Always Use RISC0_DEV_MODE=1

**MANDATORY**: When running any `cargo test`, `cargo run`, `cargo build`, or `cargo check` commands in this directory, **ALWAYS** prefix them with `RISC0_DEV_MODE=1`:

```bash
# CORRECT - Fast development mode
RISC0_DEV_MODE=1 cargo test
RISC0_DEV_MODE=1 cargo run -- ../pong-log.json
RISC0_DEV_MODE=1 cargo build
RISC0_DEV_MODE=1 cargo check

# INCORRECT - Will take 10-30+ minutes per test
cargo test
cargo run
```

**Why this matters:**
- Without the flag: Generates actual ZK proofs (10-30 minutes per test)
- With the flag: Uses development mode (completes in seconds)
- Dev mode proofs are NOT secure - only for testing/development

## Workspace Structure

```
prover/
├── core/          # Shared no_std types (ValidateLogInput/Output)
├── host/          # Host program (loads logs, generates proofs)
│   ├── src/       # Main prover binary
│   └── tests/     # Integration and log validation tests
├── methods/       # Guest code that runs in zkVM
│   └── guest/
│       ├── src/
│       │   ├── main.rs      # zkVM entry point
│       │   ├── physics.rs   # Physics validation
│       │   ├── fixed.rs     # Fixed-point math
│       │   └── constants.rs # Game constants (MUST match frontend)
└── Cargo.toml     # Workspace manifest
```

## Architecture

**Flow:** Host program → Loads game log JSON → Passes to Guest → Guest validates in zkVM → Produces proof

- **Host (host/)**: Runs on your machine, loads data, manages zkVM
- **Guest (methods/guest/)**: Runs inside zkVM, validates game physics deterministically
- **Core (core/)**: Shared types used by both host and guest

## Key Validation Rules

### 1. Event Structure Validation
- Events must be pairs: `[leftY, rightY, leftY, rightY, ...]`
- Non-empty: at least 2 events (1 pair)
- Under limit: maximum 10,000 events (5,000 volleys)
- Each value is a Q16.16 fixed-point paddle position (i64)

### 2. Physics Validation (in zkVM)
```rust
// Kinematics check
let dt = time_to_paddle(state);
assert!(dt > 0, "Ball must reach paddle in positive time");

// Reachability check
let max_movement = paddle_max_speed * dt;
assert!(paddle_movement <= max_movement, "Paddle moved too fast");

// Bounds check
assert!(paddle_y >= min_y && paddle_y <= max_y, "Paddle out of bounds");
```

### 3. Serve Angle Calculation

**CRITICAL**: Must use Euclidean modulo to prevent invalid angles.

```rust
let entropy_mix = (volley_count as i32).wrapping_add(game_id as i32);
let angle_mod = (entropy_mix.wrapping_mul(serve_angle_multiplier)).rem_euclid(angle_range);
let angle_raw = angle_mod - max_bounce_angle_deg;
```

**Why `rem_euclid`?**
- Rust's `%` can return negative values (like JavaScript)
- `rem_euclid` always returns positive remainder
- Ensures angles stay within -60° to +60° range
- Must match TypeScript's `((x % n) + n) % n` exactly

### 4. Final Score Validation
```rust
// Exactly one player must reach POINTS_TO_WIN
assert!(
    (left_score == POINTS_TO_WIN) ^ (right_score == POINTS_TO_WIN),
    "Exactly one player must win"
);

// No ties allowed
assert!(left_score != right_score, "Ties are invalid");

// No going over
assert!(
    left_score <= POINTS_TO_WIN && right_score <= POINTS_TO_WIN,
    "Score cannot exceed POINTS_TO_WIN"
);
```

## Constants Synchronization

**CRITICAL**: Constants in `methods/guest/src/constants.rs` must match frontend (`src/pong/constants.ts`) exactly:

```rust
// Dimensions (pixels)
pub const WIDTH: i32 = 800;
pub const HEIGHT: i32 = 480;
pub const PADDLE_HEIGHT: i32 = 80;
pub const PADDLE_WIDTH: i32 = 10;
pub const PADDLE_MARGIN: i32 = 16;
pub const BALL_RADIUS: i32 = 6;

// Speeds (pixels/second)
pub const PADDLE_MAX_SPEED: i32 = 200;
pub const SERVE_SPEED: i32 = 500;
pub const SPEED_INCREMENT: i32 = 50;

// Angles
pub const MAX_BOUNCE_ANGLE_DEG: i32 = 60;
pub const ANGLE_RANGE: i32 = 121;  // -60 to +60 (inclusive)
pub const SERVE_ANGLE_MULTIPLIER: i32 = 37;  // Coprime with 121

// Game rules
pub const POINTS_TO_WIN: i32 = 3;
pub const MAX_EVENTS: usize = 10000;
```

**Any change to frontend constants requires updating prover constants.**

## Integer Math Policy

All physics uses Q16.16 fixed-point integer math:

```rust
// Q16.16 format: 16 integer bits + 16 fractional bits
pub type I = i64;

// Convert integer to fixed-point
pub fn to_fixed_int(x: i64) -> I {
    x << 16
}

// Fixed-point multiplication
pub fn i_mul(a: I, b: I) -> I {
    ((a as i128 * b as i128) >> 16) as I
}

// Fixed-point division
pub fn i_div(a: I, b: I) -> I {
    (((a as i128) << 16) / (b as i128)) as I
}
```

**Guidelines:**
- Never use `f32` or `f64` in validation logic
- Use `wrapping_mul()` for overflow safety
- Use `rem_euclid()` for modulo operations
- All game values are integers in source (converted to fixed-point at init)

## Testing

### Run All Tests
```bash
RISC0_DEV_MODE=1 cargo test
```

### Run Specific Test Suite
```bash
RISC0_DEV_MODE=1 cargo test --test integration_test
RISC0_DEV_MODE=1 cargo test --test log_validation_test
```

### Run Single Test
```bash
RISC0_DEV_MODE=1 cargo test test_valid_game_19_events
```

### Test Categories

**Integration tests** (`host/tests/integration_test.rs`):
- Edge cases (i64::MAX, overflow scenarios)
- Invalid inputs (empty events, odd counts)
- Paddle constraints (speed, bounds)
- Score validation
- Event limit enforcement
- Hash determinism

**Log validation tests** (`host/tests/log_validation_test.rs`):
- Real game logs from JSON files
- Full end-to-end validation
- Proof generation and verification

## Running the Prover

```bash
# Validate a game log
RISC0_DEV_MODE=1 cargo run -- ../pong-log_events19_1761147203682.json

# Output includes:
# - Validation result (fair/unfair)
# - Final scores
# - SHA-256 commitment hash
# - Proof receipt (in dev mode, not secure)
```

## Common Validation Failures

### "Paddle moved too fast"
- Paddle position changed more than `PADDLE_MAX_SPEED * dt` between events
- Check frontend paddle motion implementation
- Verify `PADDLE_MAX_SPEED` matches between frontend and prover

### "Invalid kinematics"
- Ball cannot reach paddle plane in positive time
- Usually indicates velocity or position calculation error
- Check serve angle or bounce calculations

### "Paddle out of bounds"
- Paddle center outside valid range
- Valid range: `[PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2]`
- Check paddle clamping logic

### "Invalid final score"
- Neither player reached `POINTS_TO_WIN`
- Both players reached `POINTS_TO_WIN` (tie)
- Score exceeded `POINTS_TO_WIN`
- Check game ending logic in frontend

## Development Workflow

1. **Make changes to guest code** (`methods/guest/src/*.rs`)
2. **Run tests**: `RISC0_DEV_MODE=1 cargo test`
3. **If constants changed**: Update frontend to match
4. **Verify both sides**: Run frontend tests too (`cd .. && pnpm test`)
5. **Test with real logs**: Place log JSON in root and run prover

## File Loading

Tests load JSON files from project root using relative paths:

```rust
// From host/tests/log_validation_test.rs
let events = load_and_parse_log("../../pong-log_events19_1761147203682.json");
```

Test JSON files should be in project root, named: `pong-log_events{N}_{timestamp}.json`

## Proof Output

The prover generates a `ValidateLogOutput` containing:

```rust
pub struct ValidateLogOutput {
    pub fair: bool,              // Validation passed
    pub reason: Option<String>,  // Error message if failed
    pub left_score: i32,         // Final left player score
    pub right_score: i32,        // Final right player score
    pub events_len: usize,       // Number of events validated
    pub commitment: [u8; 32],    // SHA-256 hash of log
}
```

The commitment hash includes a "PONGLOGv1" prefix for domain separation.

## Debugging Tips

### Enable verbose output:
```bash
RISC0_DEV_MODE=1 RUST_LOG=info cargo test -- --nocapture
```

### Check zkVM execution:
```bash
RISC0_DEV_MODE=1 RISC0_INFO=1 cargo run -- ../test.json
```

### Verify constant synchronization:
```bash
# Check Rust constants
grep -A1 "pub const" methods/guest/src/constants.rs

# Compare with TypeScript
grep -A1 "export const" ../src/pong/constants.ts
```

## Common Pitfalls

1. **Forgetting RISC0_DEV_MODE=1**: Commands will hang for 10-30 minutes
2. **Constant mismatch**: Frontend and prover must have identical constants
3. **Wrong modulo**: Use `rem_euclid()`, not `%` operator
4. **Float contamination**: Never use floating-point in validation logic
5. **Negative angles**: Serve angle calculation must use Euclidean modulo

## Related Documentation

- `../AGENTS.md` - Full project guidelines
- `../SERVE_ANGLE_FIX.md` - Details on serve angle bug fix
- `.claude/instructions.md` - Detailed prover instructions
- `../README.md` - Project overview

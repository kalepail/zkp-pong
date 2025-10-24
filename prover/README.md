# Pong Prover (RISC Zero)

Zero-knowledge proof generator and verifier for Pong match logs using RISC Zero zkVM.

## Overview

This prover validates Pong match logs inside a RISC Zero zkVM environment, generating cryptographic proofs that a game was played fairly without revealing player strategies. The proof commits to a SHA-256 hash of the log, enabling trustless verification.

## Architecture

```
prover/
├── core/                   # Shared types and utilities (no_std compatible)
│   ├── src/lib.rs         # ValidateLogInput, ValidateLogOutput, hash computation
│   └── Cargo.toml
├── host/                   # Prover host program
│   ├── src/main.rs        # CLI entry point, proof orchestration
│   └── Cargo.toml
├── methods/               # Guest code (runs in zkVM)
│   ├── guest/
│   │   ├── src/
│   │   │   ├── main.rs    # zkVM entry point
│   │   │   ├── physics.rs # Game physics validation
│   │   │   ├── fixed.rs   # Fixed-point math (Q16.16)
│   │   │   ├── constants.rs # Hardcoded game configuration
│   │   │   └── types.rs   # Re-exports from core
│   │   └── Cargo.toml
│   ├── build.rs           # Guest build script (risc0-build)
│   └── Cargo.toml
├── Cargo.toml             # Workspace config
└── rust-toolchain.toml    # Rust version pinning
```

## Requirements

- Rust 1.81+ (specified in `rust-toolchain.toml`)
- RISC Zero toolchain

**Install RISC Zero:**
```bash
curl -L https://risczero.com/install | bash
rzup
```

## Building

**Development build (optimized):**
```bash
cargo build --release
```

**Note:** The workspace is configured with `opt-level = 3` even in dev mode for acceptable proof generation performance.

## Usage

The prover binary has two commands: `prove` and `verify`.

### Prove Command

Generate a cryptographic proof for a game log:

```bash
./target/release/pong-prover prove <log_file> [--format <type>] [output_file]
```

**Example:**
```bash
./target/release/pong-prover prove pong-log.json --format succinct
```

**Output:**
```
🎮 RISC Zero Pong Proof System
======================================================================

📋 Generating proof for game log
  Log file: pong-log.json
  Receipt format: succinct

📦 Loaded 98 events from log
  Game ID: 3829561234

🔐 Generating proof (this may take a while)...
  Proving time: 12.45s

✅ Proof generated successfully!
  Result: FAIR GAME
  Score: 3-0
  Log Hash: 0x7a3f2b1c...
  Events Processed: 98
  Receipt Size: 187342 bytes

💾 Proof saved to: pong-proof_game3829561234_1738234567.json
   Use 'verify pong-proof_game3829561234_1738234567.json' to cryptographically verify this proof
======================================================================
```

**Receipt Format Options:**
- `composite`: Fastest proving, largest size (~MB)
- `succinct`: Balanced, medium size (~200 KB) - **recommended**
- `groth16`: Slowest proving, smallest size (~200-300 bytes)

### Verify Command

Cryptographically verify a proof (very fast, ~0.1s):

```bash
./target/release/pong-prover verify <proof_file>
```

**Example:**
```bash
./target/release/pong-prover verify pong-proof_game3829561234_1738234567.json
```

**Output:**
```
🎮 RISC Zero Pong Proof System
======================================================================

📋 Verifying proof
  Proof file: pong-proof_game3829561234_1738234567.json

📦 Loaded proof
  Game ID: 3829561234
  Receipt format: succinct
  Receipt size: 187342 bytes

🔐 Verifying receipt cryptographically...
  Verification time: 0.08s

✅ Receipt cryptographically verified!

The proof cryptographically attests that:
  1. The game log was correctly validated
  2. The game was FAIR
  3. Final score: 3-0
  4. The computation was executed correctly in the zkVM

🎊 This game result is cryptographically verified!
======================================================================
```

### Development Mode

For faster iteration without actual proof generation:
```bash
RISC0_DEV_MODE=1 ./target/release/pong-prover prove <log.json>
```

This skips cryptographic proof generation but still validates the log logic.

## Testing

Run unit tests for guest code:
```bash
cargo test
```

Run with dev mode for faster execution:
```bash
RISC0_DEV_MODE=1 cargo test
```

## How It Works

### Core Library (`core/src/lib.rs`)

Shared `no_std`-compatible library used by both host and guest:
- `ValidateLogInput`: Input structure containing event array
- `ValidateLogOutput`: Output structure with validation result, scores, and SHA-256 hash
- `CompactLog`: JSON deserialization format with version field
- `compute_log_hash()`: Deterministic SHA-256 hash computation with "PONGLOGv1" prefix

### Host (`host/src/main.rs`)

1. Loads match log JSON from file (with size limit protection)
2. Parses `CompactLog` with version validation
3. Converts event strings to Q16.16 integers (`i64`)
4. Creates `ValidateLogInput` with events array
5. Builds zkVM execution environment
6. Generates proof using RISC Zero prover
7. Verifies proof and decodes public `ValidateLogOutput`
8. Prints result (fair/unfair, score, log hash)

### Guest (`methods/guest/src/main.rs`)

Runs inside RISC Zero zkVM:

1. Reads `ValidateLogInput` from environment
2. Loads hardcoded game constants from `constants.rs`
3. Initializes game state with deterministic serve (based on event count)
4. Replays match using fixed-point physics
5. Checks each event pair for:
   - Kinematics validity (positive time to paddle plane)
   - Paddle reachability (max speed constraints)
   - Paddle bounds (within field)
   - Hit detection (ball-paddle collision)
   - Physics consistency (deterministic bounces)
6. Validates final score (exactly one player reaches `POINTS_TO_WIN`)
7. Computes SHA-256 hash of events with "PONGLOGv1" prefix
8. Commits public output: `ValidateLogOutput`

### Public Output

```rust
struct ValidateLogOutput {
    fair: bool,              // True if all checks passed
    reason: Option<String>,  // Error message if unfair
    left_score: u32,
    right_score: u32,
    events_len: u32,
    log_hash_sha256: [u8; 32] // Binding commitment to input
}
```

## Validation Rules

1. **Event Structure**: Must have pairs of events (leftY, rightY), non-empty, under 10K event limit
2. **Kinematics**: Ball velocity must reach paddle plane in positive time (`dt > 0`)
3. **Reachability**: Paddle movement ≤ `max_speed * dt` between events
4. **Bounds**: Paddles stay within field boundaries
5. **Determinism**: Bounces computed using event-count-based serve angles and fixed-point math
6. **Final Score**: Exactly one player must reach `POINTS_TO_WIN` (3), no ties allowed
7. **Time Safety**: Overflow detection (effectively unlimited with Q16.16 and 10K event limit)
8. **Commitment**: SHA-256 hash with "PONGLOGv1" prefix binds proof to specific events

## Performance

Proof generation time varies by log size:
- ~50 events (short match): 30-60 seconds
- ~100 events (medium match): 60-120 seconds
- Dev mode: <1 second (no proof)

## License

Apache License 2.0

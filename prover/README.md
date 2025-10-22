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

**Generate and verify proof for a match log:**
```bash
cargo run --release -- <path-to-log.json>
```

**Example:**
```bash
cargo run --release -- ../pong-log_events67_1761140976543.json
```

**Output:**
```
Loaded 98 events from ../pong-log_events67_1761140976543.json
Generating proof...
Verifying proof...

Proof verified successfully!
Result: FAIR GAME
Log Hash: 0x7a3f2b1c...
Events Processed: 98
3-0
```

## Development Mode

For faster iteration without actual proof generation:
```bash
RISC0_DEV_MODE=1 cargo run --release -- <log.json>
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

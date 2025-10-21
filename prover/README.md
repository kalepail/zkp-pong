# Pong Prover (RISC Zero)

Zero-knowledge proof generator and verifier for Pong match logs using RISC Zero zkVM.

## Overview

This prover validates Pong match logs inside a RISC Zero zkVM environment, generating cryptographic proofs that a game was played fairly without revealing player strategies. The proof commits to a SHA-256 hash of the log, enabling trustless verification.

## Architecture

```
prover/
├── host/                   # Prover host program
│   ├── src/main.rs        # CLI entry point, proof orchestration
│   └── Cargo.toml
├── methods/               # Guest code (runs in zkVM)
│   ├── guest/
│   │   ├── src/
│   │   │   ├── main.rs    # zkVM entry point
│   │   │   ├── physics.rs # Game physics validation
│   │   │   ├── fixed.rs   # Fixed-point math (Q32.32)
│   │   │   └── types.rs   # Data structures and hashing
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
cargo run --release -- ../pong-log_seed930397884_events49_1757552715309.json
```

**Output:**
```
Loaded 98 events from ../pong-log_seed930397884_events49_1757552715309.json
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

### Host (`host/src/main.rs`)

1. Loads match log JSON from file
2. Parses config and events into `ValidateLogInput`
3. Creates zkVM execution environment with input
4. Generates proof using RISC Zero prover
5. Verifies proof and decodes public output
6. Prints result (fair/unfair, score, log hash)

### Guest (`methods/guest/src/main.rs`)

Runs inside RISC Zero zkVM:

1. Reads `ValidateLogInput` from environment
2. Validates game configuration bounds
3. Initializes deterministic RNG with seed
4. Replays match using fixed-point physics
5. Checks each event for:
   - Paddle reachability (max speed constraints)
   - Paddle bounds (within field)
   - Hit detection (ball-paddle collision)
   - Physics consistency (deterministic bounces)
6. Computes SHA-256 hash of config + events
7. Commits public output: `ValidateLogOutput`

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

1. **Config Validation**: Dimensions, speeds, angles within sane bounds
2. **Kinematics**: Ball velocity must reach paddle plane in positive time
3. **Reachability**: Paddle movement ≤ `max_speed * dt` between events
4. **Bounds**: Paddles stay within field boundaries
5. **Determinism**: Bounces computed using seed-based RNG and fixed-point math
6. **Time Safety**: No overflow detection (protected by 10K event limit)

## Performance

Proof generation time varies by log size:
- ~50 events (short match): 30-60 seconds
- ~100 events (medium match): 60-120 seconds
- Dev mode: <1 second (no proof)

## License

Apache License 2.0

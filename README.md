# Pong-a-bing-bong

Deterministic Pong with zero-knowledge proof validation. Play Pong in your browser, export match logs, and verify fairness using RISC Zero zkVM.

## Overview

This project demonstrates provably fair game mechanics using zero-knowledge proofs. The game runs entirely client-side with deterministic physics based on integer math. Match logs can be cryptographically verified to prove no cheating occurred.

**Key Features:**
- Deterministic Pong engine using fixed-point arithmetic (Q16.16)
- Compact match logging (paddle positions at impact events only)
- Client-side validation and real-time replay
- RISC Zero zkVM prover for trustless verification (CLI + HTTP API)
- Separate prove and verify commands for production workflows

## Project Structure

```
.
├── src/                    # TypeScript frontend
│   ├── main.ts            # UI and game orchestration
│   ├── pong/
│   │   ├── engine.ts      # Game engine, validation, and replay logic
│   │   ├── fixed.ts       # Fixed-point math utilities
│   │   └── constants.ts   # Game configuration constants
├── prover/                # Rust RISC Zero prover (see prover/README.md)
│   ├── core/              # Shared types and hashing logic (no_std compatible)
│   ├── host/              # CLI tool for proving and verification
│   ├── methods/           # Guest code (runs inside zkVM)
│   ├── api-server/        # HTTP API for remote proof generation
│   └── Cargo.toml         # Workspace configuration
├── test/                  # TypeScript test suite
│   ├── engine.test.ts     # Game engine tests
│   └── log-validation.test.ts  # Log validation tests
├── index.html             # Entry point
├── package.json
└── *.json                 # Example match logs
```

## Running the Game

**Requirements:**
- Node.js 18+
- pnpm

**Start development server:**
```bash
pnpm install
pnpm dev
```

Open browser to `http://localhost:5173`

**Build for production:**
```bash
pnpm build
pnpm preview
```

## How It Works

### Game Mechanics

1. **Deterministic Physics**: All calculations use 64-bit fixed-point integers (Q16.16 format) to ensure identical results across platforms
2. **Event-Driven**: Game state only changes at discrete events (paddle impacts or misses)
3. **Compact Logging**: Only paddle Y positions at each event are logged, reducing log size by ~95%
4. **AI Opponents**: Both paddles use deterministic AI with configurable aim offset and jitter

### Match Logs

Logs are compact JSON files containing:
- `v`: Version number (currently 1)
- `game_id`: Unique game identifier (u32) - provides per-game entropy for serve angles and replay protection
- `events`: Flat array of paddle Y positions in Q16.16 fixed-point format `["leftY0", "rightY0", "leftY1", "rightY1", ...]`
  - Each event = 2 entries (leftY, rightY)
  - Values are stored as decimal strings (e.g., "15728640" = 240.0 in Q16.16)
  - Example: 49 events = 98 entries

**Note:** Game configuration (dimensions, speeds, angles) is hardcoded in both frontend and prover for simplicity and consistency. Physics is fully deterministic based on `game_id` and event count.

### Game Controls

- **Start Match**: Begin new game (clears previous log)
- **Validate Log**: Client-side validation of current log
- **Replay Match**: Play back an uploaded log in real-time
- **Download Log**: Save match log as JSON
- **Upload Log**: Load and validate existing match log

## Validation & Proof Generation

**Client-side Validation (TypeScript):**
```typescript
import { validateLog } from './pong/engine'

const result = validateLog(log)
// => { fair: true, leftScore: 3, rightScore: 0 }
```

**Client-side Replay (TypeScript):**
```typescript
import { replayLog } from './pong/engine'

const { cancel, onUpdate } = replayLog(canvas, log)
// Replays the match visually using the same deterministic physics
```

**Zero-knowledge Proofs (Rust):**

Generate and verify cryptographic proofs using the CLI tool:

```bash
# Generate proof
./prover/target/release/pong-prover prove pong-log.json --format succinct

# Verify proof (very fast, ~0.1s)
./prover/target/release/pong-prover verify pong-proof_game<id>_<timestamp>.json
```

**Or use the HTTP API:**
```bash
# Start API server
cd prover && cargo run --release --bin api-server

# Generate proof
curl -X POST http://localhost:8080/api/prove \
  -H "Content-Type: application/json" \
  -d @pong-log.json

# Verify proof
curl -X POST http://localhost:8080/api/verify \
  -H "Content-Type: application/json" \
  -d @proof.json
```

See [prover/README.md](./prover/README.md) for detailed prover documentation.

## Testing

```bash
pnpm test              # Run all 24 tests
pnpm test:watch        # Watch mode
```

Test suite includes:
- Constant verification (TypeScript ↔ Rust alignment)
- Real game log validation (3 actual matches)
- Edge cases and determinism checks

See [TESTING.md](./TESTING.md) for details.

## License

Apache License 2.0

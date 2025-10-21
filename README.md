# Pong-a-bing-bong

Deterministic Pong with zero-knowledge proof validation. Play Pong in your browser, export match logs, and verify fairness using RISC Zero zkVM.

## Overview

This project demonstrates provably fair game mechanics using zero-knowledge proofs. The game runs entirely client-side with deterministic physics based on integer math. Match logs can be cryptographically verified to prove no cheating occurred.

**Key Features:**
- Deterministic Pong engine using fixed-point arithmetic (Q32.32)
- Compact match logging (paddle positions at impact events only)
- Client-side validation and ZK proof generation
- RISC Zero zkVM prover for trustless verification

## Project Structure

```
.
├── src/                    # TypeScript frontend
│   ├── main.ts            # UI and game orchestration
│   ├── pong/
│   │   ├── engine.ts      # Game engine and validation logic
│   │   └── fixed.ts       # Fixed-point math utilities
├── prover/                # Rust RISC Zero prover (see prover/README.md)
├── index.html             # Entry point
├── package.json
└── *.json                 # Example match logs
```

## Running the Game

**Requirements:**
- Node.js 18+
- pnpm (or npm)

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

1. **Deterministic Physics**: All calculations use 64-bit fixed-point integers (Q32.32 format) to ensure identical results across platforms
2. **Event-Driven**: Game state only changes at discrete events (paddle impacts or misses)
3. **Compact Logging**: Only paddle Y positions at each event are logged, reducing log size by ~95%
4. **AI Opponents**: Both paddles use deterministic AI with configurable aim offset and jitter

### Match Logs

Logs are JSON files containing:
- `config`: Game parameters (seed, dimensions, speeds, angles, etc.)
- `events`: Flat array of paddle positions `[leftY0, rightY0, leftY1, rightY1, ...]`

Example: `pong-log_seed930397884_events49_1757552715309.json`

### Game Controls

- **Start Match**: Begin new game with random seed
- **Validate Log**: Client-side validation of current log
- **Download Log**: Save match log as JSON
- **Upload Log**: Load and validate existing match log

## Validation

**Client-side (TypeScript):**
```typescript
import { validateLog } from './pong/engine'

const result = validateLog(log)
// => { fair: true, leftScore: 3, rightScore: 0 }
```

**Zero-knowledge proof (Rust):**
See [prover/README.md](./prover/README.md) for RISC Zero zkVM verification.

## License

Apache License 2.0

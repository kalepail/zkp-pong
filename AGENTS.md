This project includes a deterministic, event-driven Pong engine designed for reproducible gameplay, compact logging, and zero-knowledge proof validation via RISC0 zkVM.

**Architecture:** TypeScript frontend generates game logs → Rust RISC0 prover validates logs → zkVM proof of fairness

**Package Manager:** This project uses `pnpm`. All commands should use `pnpm` (e.g., `pnpm install`, `pnpm test`, `pnpm dev`).

Guidelines within scope of the repo:

- Deterministic physics:
  - Use analytical motion between discrete paddle-plane events.
  - Y bounces use reflection mapping (no per-bounce loops).
  - Event times are derived from x(t) crossing paddle planes; y(t) is computed via reflection.

- Logging contract:
  - Logs are compact JSON with `config` and `events` only.
  - `events` is a single flat array of integer fixed-point values (decimal strings), storing paddle pairs sequentially: `[l0, r0, l1, r1, ...]`.
  - Each event contributes exactly two entries to `events`: leftY, then rightY.
  - No wall-bounce frames or timestamps are persisted; they are implied by physics + config + seed.

- Validation:
  - Re-simulates event times from config and seed.
  - Verifies paddle reachability using `paddleMaxSpeed` and event-to-event `dt`.
  - Recomputes hit/miss, advancing scores and ensuring consistent results.

- Separation of concerns:
  - Rendering reads analytical positions for any `t` and never advances physics directly.
  - Simulation advances only at paddle-plane events; avoid frame-tick integration.

- Performance:
  - Avoid loops over wall bounces; use closed-form reflection.
  - Avoid unnecessary re-renders; render via requestAnimationFrame.

- Configuration:
  - Config fields must be codified into the log for perfect replay: board dimensions, paddle/ball sizes, speeds, speed increment, angle caps, and RNG seed.
  - AI and stability knobs are integer-only:
    - `microJitterMilliDeg` (integer): tiny bounce-angle jitter in thousandths of a degree.
    - `aiOffsetMaxPermille` (integer 0..1000): max off-center aim as a permille of `(paddleHalf + ballRadius)`.
  - All config values are integers; do not introduce fractional fields.

- Integer Math Policy:
  - Physics, simulation, and validation must use fixed-point integer math (Q32.32 via BigInt) for all kinematics and timings.
  - Never persist or log floating-point values. Persisted `events` use integer fixed-point values encoded as decimal strings.
  - Console/debug output must also print integer fixed-point values (decimal strings), not floats.
  - Avoid float-based guard checks (e.g., `isFinite` on numbers) in core logic; use integer-domain checks instead (e.g., `dt > 0n`).
  - Rendering may convert to JS numbers for canvas APIs, but these must never be persisted or shown in logs or validation reasons.

- RNG (Random Number Generator):
  - Use deterministic LCG (Linear Congruential Generator) with parameters: a=1664525, c=1013904223, modulo=2^32
  - Seed handling: `seed === 0` must be converted to `1` to match Rust implementation
  - Separate RNGs for physics (`rngPhysics`) and AI (`rngAI`):
    - `rngPhysics = new RNG(seed)` - affects logged state (serve angles, bounce jitter)
    - `rngAI = new RNG(seed ^ 0x9e3779b9)` - affects AI decisions only (not validated)
  - Only physics RNG affects validation; AI RNG is for gameplay variety only

- RISC0 zkVM Compatibility:
  - Frontend (TypeScript) and prover (Rust) must use identical algorithms
  - CORDIC constants (atan table, K gain) must match exactly between implementations
  - Test constant alignment: TypeScript computed values vs Rust hardcoded values
  - Maximum event limit: 10,000 events (5,000 volleys) enforced in prover
  - Frontend should validate event count before export to prevent prover rejection

- Cross-Platform Determinism:
  - Initialization functions (`toFixed`, `degToRadFixed`) use `Math.round()` and `Math.PI`
  - These only affect constant computation at setup time, not runtime physics
  - Critical: Verify TypeScript constants match Rust constants in tests
  - Runtime physics must be pure BigInt operations with no floating-point contamination

- Timing and Non-Determinism:
  - `performance.now()` and `Date.now()` are OK for rendering/UI but never affect logged state
  - Animation timing determines **when** to call `step()`, not **what** `step()` does
  - `Math.random()` for seed generation is acceptable (seed itself is logged in config)
  - Separation: deterministic game logic vs non-deterministic presentation layer

- Testing Requirements:
  - **Test Suite**: 24 automated tests in `test/engine.test.ts` (run with `pnpm test`)
  - **Constant Verification**: Test that TypeScript CORDIC constants match Rust values
  - **Real Game Logs**: Validate actual gameplay logs to prevent regressions
  - **Round-Trip Validation**: Generate log → validate with prover → compare scores
  - **Determinism Test**: Same seed must produce identical event arrays
  - **Edge Cases**: Test seed=0, seed=0xFFFFFFFF, extreme angles, max points
  - **Event Limit**: Verify frontend respects 10,000 event maximum

- Prover Validation Rules:
  - Config validation: dimensions, speeds, angles within safe bounds
  - Kinematics: ball velocity must reach paddle plane in positive time (dt > 0)
  - Reachability: paddle movement ≤ max_speed * dt between events
  - Bounds: paddles stay within field boundaries
  - Determinism: bounces computed using seed-based RNG and fixed-point math
  - Commitment: SHA-256 hash of config + events included in proof output

When extending the engine or validator, keep physics formulas bit-for-bit identical between gameplay and verification, and adhere to the integer math policy above. Any changes to frontend physics must be mirrored exactly in the Rust prover implementation.

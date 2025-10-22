This project includes a deterministic, event-driven Pong engine designed for reproducible gameplay, compact logging, and zero-knowledge proof validation via RISC Zero zkVM.

**Architecture:** TypeScript frontend generates game logs → Rust RISC Zero prover validates logs → zkVM proof of fairness

**Package Manager:** This project uses `pnpm`. All commands should use `pnpm` (e.g., `pnpm install`, `pnpm test`, `pnpm dev`).

**Workspace Structure:**
- `prover/core/` - Shared no_std types (ValidateLogInput/Output, hash computation)
- `prover/host/` - Host program (loads logs, generates proofs)
- `prover/methods/guest/` - Guest code (runs in zkVM, validates physics)
- Game constants are hardcoded in `prover/methods/guest/src/constants.rs` and must match frontend

Guidelines within scope of the repo:

- Deterministic physics:
  - Use analytical motion between discrete paddle-plane events.
  - Y bounces use reflection mapping (no per-bounce loops).
  - Event times are derived from x(t) crossing paddle planes; y(t) is computed via reflection.

- Logging contract:
  - Logs are compact JSON with `v` (version) and `events` only.
  - `v` must be `1` (current version).
  - `events` is a single flat array of Q16.16 fixed-point values as decimal strings: `["l0", "r0", "l1", "r1", ...]`.
  - Each event contributes exactly two entries to `events`: leftY, then rightY.
  - No wall-bounce frames or timestamps are persisted; they are implied by hardcoded physics constants and event count.
  - Config is NOT persisted in logs - all game parameters are hardcoded in both frontend and prover.

- Validation:
  - Re-simulates event times from hardcoded constants and event count.
  - Verifies paddle reachability using `paddleMaxSpeed` and event-to-event `dt`.
  - Recomputes hit/miss, advancing scores and ensuring consistent results.
  - Validates final score: exactly one player must reach `POINTS_TO_WIN` (3), no ties allowed.

- Separation of concerns:
  - Rendering reads analytical positions for any `t` and never advances physics directly.
  - Simulation advances only at paddle-plane events; avoid frame-tick integration.

- Performance:
  - Avoid loops over wall bounces; use closed-form reflection.
  - Avoid unnecessary re-renders; render via requestAnimationFrame.

- Configuration:
  - Config is hardcoded in both frontend and prover - NOT stored in log files.
  - Constants defined in `prover/methods/guest/src/constants.rs` must match frontend exactly.
  - All config values are integers (dimensions, speeds, angles, points to win).
  - Serve angles are deterministic based on event count (no RNG seed needed):
    - Uses modular arithmetic: `(event_count * SERVE_ANGLE_MULTIPLIER) % ANGLE_RANGE`
    - SERVE_ANGLE_MULTIPLIER (37) is coprime with ANGLE_RANGE (121) for good distribution.

- Integer Math Policy:
  - Physics, simulation, and validation must use fixed-point integer math (Q16.16 via BigInt) for all kinematics and timings.
  - Never persist or log floating-point values. Persisted `events` use integer fixed-point values encoded as decimal strings.
  - Console/debug output must also print integer fixed-point values (decimal strings), not floats.
  - Avoid float-based guard checks (e.g., `isFinite` on numbers) in core logic; use integer-domain checks instead (e.g., `dt > 0n`).
  - Rendering may convert to JS numbers for canvas APIs, but these must never be persisted or shown in logs or validation reasons.

- Deterministic Serve Angles:
  - NO RNG SEED is used anymore - physics is fully deterministic based on event count
  - Serve angle calculation: `angle_deg = -MAX_BOUNCE_ANGLE + ((event_count * SERVE_ANGLE_MULTIPLIER) % ANGLE_RANGE)`
  - This produces deterministic but varied serve angles across volleys
  - Event count provides natural variation without needing a random seed
  - Both frontend and prover use identical formula for consistency

- RISC Zero zkVM Compatibility:
  - Frontend (TypeScript) and prover (Rust) must use identical algorithms
  - Game constants in `prover/methods/guest/src/constants.rs` must match frontend exactly
  - Fixed-point math must be bit-identical between TypeScript and Rust
  - Maximum event limit: 10,000 events (5,000 volleys) enforced in prover
  - Frontend should validate event count before export to prevent prover rejection
  - Core library (`prover/core/`) is no_std compatible for zkVM execution

- Cross-Platform Determinism:
  - Initialization functions (`toFixed`, `degToRadFixed`) use `Math.round()` and `Math.PI`
  - These only affect constant computation at setup time, not runtime physics
  - Critical: Verify TypeScript constants match Rust constants in tests
  - Runtime physics must be pure BigInt operations with no floating-point contamination

- Timing and Non-Determinism:
  - `performance.now()` and `Date.now()` are OK for rendering/UI but never affect logged state
  - Animation timing determines **when** to render, not **what** the physics produces
  - NO random seed generation needed anymore - physics is deterministic from event count
  - Separation: deterministic game logic vs non-deterministic presentation layer

- Testing Requirements:
  - **Test Suite**: Automated tests in `test/` directory (run with `pnpm test`)
    - `test/engine.test.ts` - Game engine and physics tests
    - `test/log-validation.test.ts` - Log validation tests
  - **Constant Verification**: Test that TypeScript constants match Rust hardcoded values
  - **Real Game Logs**: Validate actual gameplay logs to prevent regressions
  - **Round-Trip Validation**: Generate log → validate with prover → compare scores
  - **Determinism Test**: Identical deterministic physics produces consistent results
  - **Edge Cases**: Test extreme angles, max points, boundary conditions
  - **Event Limit**: Verify frontend respects 10,000 event maximum
  - **Version Validation**: Ensure log version field (`v: 1`) is properly validated

- Prover Validation Rules:
  - Event structure: must be pairs (leftY, rightY), non-empty, under 10K limit
  - Kinematics: ball velocity must reach paddle plane in positive time (dt > 0)
  - Reachability: paddle movement ≤ max_speed * dt between events
  - Bounds: paddles stay within field boundaries
  - Determinism: bounces computed using event-count-based serve angles and fixed-point math
  - Final score: exactly one player reaches POINTS_TO_WIN (3), no ties
  - Time safety: overflow detection (effectively unlimited with Q16.16 and event limit)
  - Commitment: SHA-256 hash with "PONGLOGv1" prefix included in proof output

When extending the engine or validator, keep physics formulas bit-for-bit identical between gameplay and verification, and adhere to the integer math policy above. Any changes to frontend physics must be mirrored exactly in the Rust prover implementation. Config changes require updates to both `prover/methods/guest/src/constants.rs` and frontend code.

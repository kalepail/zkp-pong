This project includes a deterministic, event-driven Pong engine designed for reproducible gameplay, compact logging, and offline validation.

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

When extending the engine or validator, keep physics formulas bit-for-bit identical between gameplay and verification, and adhere to the integer math policy above.

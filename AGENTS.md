This project includes a deterministic, event-driven Pong engine designed for reproducible gameplay, compact logging, and offline validation.

Guidelines within scope of the repo:

- Deterministic physics:
  - Use analytical motion between discrete paddle-plane events.
  - Y bounces use reflection mapping (no per-bounce loops).
  - Event times are derived from x(t) crossing paddle planes; y(t) is computed via reflection.

- Logging contract:
  - Logs are compact JSON with `config` and `events` only.
  - Each event logs `[leftY, rightY]` at every paddle hit or miss.
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
  - Also includes AI and stability knobs: `microJitterDeg` for tiny bounce-angle jitter and `aiOffsetMaxFrac` to bias AI aiming off-center. Jitter is applied identically in validation to maintain deterministic kinematics.

When extending the engine or validator, keep physics formulas bit-for-bit identical between gameplay and verification.

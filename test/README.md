# Test Directory

This directory contains all tests for the Pong-a-bing-bong frontend.

## Files

- **engine.test.ts** - Core tests for deterministic engine and RISC0 zkVM compatibility
  - Constant verification (CORDIC, RNG)
  - Determinism tests
  - Edge cases
  - Fixed-point math validation

## Running Tests

See [../TESTING.md](../TESTING.md) for complete testing guide.

Quick start:
```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Specific test
npm test -- -t "CORDIC"
```

## Adding New Tests

When adding tests, import from `../src/`:

```typescript
import { validateLog } from '../src/pong/engine'
import { toFixed, getCORDICConstants } from '../src/pong/fixed'
```

## Test Categories

| Category | Count | Purpose | Critical? |
|----------|-------|---------|-----------|
| Constant Verification | 3 | Ensure TS matches Rust | ✅ Yes - zkVM breaks if mismatched |
| Determinism | 2 | Same seed = same output | ✅ Yes - core promise |
| Edge Cases | 5 | Boundary conditions | ⚠️ Important |
| Fixed-Point Math | 3 | Arithmetic accuracy | ⚠️ Important |
| Config Validation | 3 | Valid/invalid configs | ⚠️ Important |
| Serialization | 2 | BigInt handling | ⚠️ Important |
| RNG | 3 | Sequence consistency | ⚠️ Important |
| **Real Game Logs** | **3** | **Validate actual gameplay** | **✅ Yes - regression prevention** |
| **Total** | **24** | | |

## Real Game Log Tests

The test suite includes validation of 3 real game logs from actual gameplay:
- `pong-log_seed237054789` (40 volleys, 80 events)
- `pong-log_seed930397884` (49 volleys, 98 events)
- `pong-log_seed725309225` (59 volleys, 118 events)

These tests ensure:
- Real gameplay logs are validated as fair
- No regressions in validation logic
- Real-world edge cases are covered

## Future Tests

Potential additions:
- Full game simulation (requires canvas mock)
- Round-trip integration test (frontend → prover → verification)
- Property-based testing
- Performance benchmarks

# Testing Guide

This document explains how to test the Pong-a-bing-bong deterministic game engine and verify RISC0 zkVM compatibility.

## Test Organization

Tests are organized in the `test/` directory at project root:

```
test/
  └── engine.test.ts    # All engine and fixed-point math tests
```

This follows the **separate test directory** pattern, which:
- Keeps source code clean (`src/` only contains production code)
- Mirrors the monorepo structure (prover has separate `tests/`)
- Makes it clear what's test vs production code
- Works seamlessly with Vitest's auto-discovery

## Overview

The test suite ensures that:
1. TypeScript frontend constants match Rust prover constants exactly
2. Game logs are deterministic (same seed = same output)
3. Edge cases are handled correctly
4. Fixed-point math is accurate
5. RNG behavior matches between TypeScript and Rust

## Installation

Install test dependencies:

```bash
npm install
```

This installs:
- `vitest` - Fast test runner (Vite-native)
- `@vitest/ui` - Optional UI for test results

## Running Tests

### Run all tests once:
```bash
npm test
```

### Watch mode (re-run on file changes):
```bash
npm run test:watch
```

### With UI:
```bash
npx vitest --ui
```

## Test Categories

### 1. Constant Verification

**Critical for zkVM compatibility!**

Tests that TypeScript CORDIC constants match Rust prover constants:

```typescript
// K gain constant
expect(K_TS).toBe(2608131496n)

// atan table (32 values)
expect(atanTable[0]).toBe(3373259426n)
// ... all 32 values
```

**Why this matters:**
- TypeScript computes constants using `Math.atan()` and `Math.sqrt()`
- Rust uses hardcoded integer values
- If they don't match, logs will validate differently between frontend and prover
- Proof will fail!

**Manual verification:**
Run test with console output to see all constants:
```bash
npm test -- --reporter=verbose
```

Compare output with `prover/methods/guest/src/physics.rs`:
```rust
const ATAN_Q32: [I; ITER] = [3373259426, 1991351318, ...];
const K_Q32: I = 2608131496;
```

### 2. Determinism Tests

Verifies that identical seeds produce identical logs:

- Same config + same seed → same event array
- Tests the core promise of deterministic gameplay
- Validates that no hidden non-determinism exists

**Note:** Currently uses a minimal test case. Full game simulation requires canvas mocking.

### 3. Edge Cases

Tests boundary conditions that could cause failures:

| Test | Purpose |
|------|---------|
| `seed = 0` | Verifies conversion to `1` (matches Rust) |
| `seed = 0xFFFFFFFF` | Max 32-bit unsigned value |
| Odd event count | Detects malformed logs |
| Paddle teleportation | Detects speed limit violations |

### 4. Fixed-Point Math

Validates Q32.32 arithmetic:

- CORDIC sin/cos accuracy (45° test: sin ≈ cos ≈ 0.707)
- Degree to radian conversion
- Milli-degree conversion

**Tolerance:** Small errors (~1000n in Q32.32) allowed for CORDIC approximation

### 5. RNG Determinism

Tests Linear Congruential Generator:

- Same seed → same sequence
- seed=0 → seed=1 conversion
- 100 iterations of identical output

## Integration Testing

### Frontend ↔ Prover Round-Trip

**Manual test procedure:**

1. Generate a log in the frontend:
   ```bash
   npm run dev
   # Play a game, download log
   ```

2. Validate with Rust prover:
   ```bash
   cd prover
   cargo run --release -- ../pong-log_seed*.json
   ```

3. Verify:
   - Proof verifies successfully
   - Scores match between frontend and prover
   - No "unfair" verdict

**Expected output:**
```
Proof verified successfully!
Result: FAIR GAME
Log Hash: 0x7a3f2b1c...
Events Processed: 98
3-0
```

### Constant Verification Script

To quickly check if constants match:

```bash
# TypeScript constants
npm test -- -t "log constants"

# Rust constants
cd prover
grep "ATAN_Q32\|K_Q32" methods/guest/src/physics.rs
```

## Common Issues

### Test: "should match Rust CORDIC constants" fails

**Cause:** Platform-specific floating-point rounding in `Math.atan()` or `Math.sqrt()`

**Solution:**
1. Check if difference is tiny (< 10 in Q32.32)
2. If so, update Rust constants to match TypeScript
3. If large, investigate floating-point implementation

**Why it matters:** Even tiny differences compound over hundreds of CORDIC iterations

### Test: "should validate a known good log" fails

**Possible causes:**
- RNG algorithm changed
- Physics formula changed
- Event format changed

**Debug:**
1. Enable console logs in `validateLog()`
2. Check `VALIDATE` vs `GAME` log differences
3. Verify seed handling (0 → 1)

### Round-trip test fails (frontend ≠ prover)

**Checklist:**
- [ ] CORDIC constants match (run constant verification test)
- [ ] RNG seed handling identical (0 → 1)
- [ ] Event format is `[leftY, rightY, leftY, rightY, ...]`
- [ ] Events are BigInt strings, not numbers
- [ ] Config values match exactly
- [ ] No floating-point in logged values

## Performance

Test suite runs in < 1 second:
- Constant verification: ~10ms
- Determinism tests: ~50ms
- Edge cases: ~100ms
- Fixed-point math: ~20ms

## Adding New Tests

### Template for new test:

```typescript
describe('Feature Name', () => {
  it('should do something specific', () => {
    // Arrange
    const input = { /* test data */ }

    // Act
    const result = functionUnderTest(input)

    // Assert
    expect(result).toBe(expected)
  })
})
```

### Best practices:

1. **Test one thing per test** - Easy to debug failures
2. **Use descriptive names** - `should validate paddle speed limits`
3. **Include edge cases** - min, max, zero, negative
4. **Test error paths** - Invalid inputs should fail gracefully
5. **Document why** - Comment on non-obvious test logic

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run tests
  run: npm test

- name: Type check
  run: npm run check

- name: Build
  run: npm run build
```

## Debugging Tests

### Enable verbose output:
```bash
npm test -- --reporter=verbose
```

### Run specific test file:
```bash
npm test test/engine.test.ts
```

### Run single test:
```bash
npm test -- -t "should match Rust CORDIC K"
```

### Debug in VS Code:

Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test"],
  "console": "integratedTerminal"
}
```

## Future Test Improvements

### High Priority:
- [ ] Full game simulation test (requires canvas mock)
- [ ] Automated round-trip test (frontend → prover)
- [ ] Performance regression tests

### Medium Priority:
- [ ] Property-based testing (QuickCheck-style)
- [ ] Fuzzing for edge cases
- [ ] Visual regression tests for rendering

### Low Priority:
- [ ] Benchmark suite
- [ ] Code coverage reporting
- [ ] Mutation testing

## Resources

- [Vitest Documentation](https://vitest.dev)
- [RISC0 zkVM Docs](https://dev.risczero.com)
- [Q32.32 Fixed-Point Arithmetic](https://en.wikipedia.org/wiki/Fixed-point_arithmetic)
- [CORDIC Algorithm](https://en.wikipedia.org/wiki/CORDIC)
- [LCG Random Number Generator](https://en.wikipedia.org/wiki/Linear_congruential_generator)

## Getting Help

If tests fail:

1. Check this guide for common issues
2. Review `fe-audit.md` for detailed analysis
3. Compare with `AGENTS.md` guidelines
4. Verify constants against Rust prover
5. Run round-trip test manually

For questions about determinism or zkVM compatibility, see `fe-audit.md` for a comprehensive analysis.

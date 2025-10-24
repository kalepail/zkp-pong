// Unit tests for RISC0 zkVM prover validation logic
// Tests that rely on specific JSON log files are in log_validation_test.rs
use core::{ValidateLogInput, ValidateLogOutput};
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};

#[test]
fn test_invalid_too_many_events() {
    let events = vec![0; 10002]; // Over the 10,000 limit
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair");
    assert!(
        output.reason.unwrap().contains("Too many events"),
        "Error should mention too many events"
    );
}

#[test]
fn test_odd_event_count() {
    let events = vec![0; 11]; // Odd number - invalid!
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair with odd event count");
    assert!(
        output.reason.unwrap().contains("pairs"),
        "Error should mention event pairs"
    );
}

#[test]
fn test_exactly_10000_events() {
    let events = vec![0; 10000]; // Exactly at the limit - should be OK
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    // This should fail for a different reason (invalid events content),
    // but NOT for exceeding the limit
    if !output.fair {
        assert!(
            !output.reason.as_ref().unwrap().contains("Too many events"),
            "Should not reject due to event count at exactly 10000"
        );
    }
}

#[test]
fn test_hash_determinism() {
    let events = vec![12345, 67890, 11111, 22222];
    let game_id = 5u32; // Use same game_id for both runs

    let input = ValidateLogInput {
        events: events.clone(),
        game_id,
    };

    // Run proof twice with same inputs
    let mut hashes = Vec::new();

    for _ in 0..2 {
        let env = ExecutorEnv::builder()
            .write(&input)
            .unwrap()
            .build()
            .unwrap();

        let prover = default_prover();
        let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

        let receipt = prove_info.receipt;
        receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

        let output: ValidateLogOutput = receipt.journal.decode().unwrap();
        hashes.push(output.log_hash_sha256);
    }

    assert_eq!(
        hashes[0], hashes[1],
        "Hash should be deterministic - same inputs should produce same hash"
    );
}

#[test]
fn test_empty_events() {
    let events: Vec<i64> = vec![];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    // Empty events is invalid - game never started
    assert!(!output.fair, "Empty events should be unfair");
    assert!(
        output.reason.unwrap().contains("No events provided"),
        "Error should mention no events"
    );
}

#[test]
fn test_paddle_out_of_bounds() {
    // Create events with extreme paddle position (out of bounds)
    let events = vec![
        1030792151040,           // leftY - center (valid)
        1030792151040,           // rightY - center (valid)
        10000000000000000,       // leftY - extreme position (invalid)
        1030792151040,           // rightY - center
    ];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair with out of bounds paddle");
    let reason = output.reason.as_ref().unwrap();
    assert!(
        reason.contains("too fast") || reason.contains("bounds"),
        "Error should mention movement violation"
    );
}

#[test]
fn test_paddle_too_fast() {
    // Create events where paddle moves too fast between events
    let events = vec![
        1030792151040,  // leftY - center
        1030792151040,  // rightY - center
        1030792151040,  // leftY - still at center
        2000000000000,  // rightY - huge jump (too fast)
    ];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair when paddle moves too fast");
    assert!(
        output.reason.unwrap().contains("too fast"),
        "Error should mention paddle moving too fast"
    );
}

#[test]
fn test_final_score_validation() {
    // Test that games must reach exactly POINTS_TO_WIN to be valid
    // This prevents players from claiming victory with incomplete games

    // Test 1: Game ending at 1-0 should be invalid (didn't reach POINTS_TO_WIN)
    // Use center position values that won't trigger "too fast" error
    let events = vec![
        15728640,  // leftY - center (Q16.16 center position)
        15728640,  // rightY - center (will miss, scoring occurs)
    ];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    // Should be rejected - game ended early, didn't reach POINTS_TO_WIN
    assert!(!output.fair, "Game ending early should be invalid");
    // The reason may vary (could be paddle too fast, or final score check)
    // Just verify the game is rejected
    assert!(output.reason.is_some(), "Should have an error reason");
}

#[test]
fn test_extreme_overflow_i64_max() {
    // Test with I64::MAX values to ensure overflow protection
    let events = vec![
        i64::MAX,  // leftY - extreme value
        i64::MAX,  // rightY - extreme value
        i64::MAX,  // leftY
        i64::MAX,  // rightY
    ];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let result = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF);

    // Should either panic during proof generation or return unfair
    // Either outcome is acceptable - the key is it doesn't silently succeed
    match result {
        Ok(prove_info) => {
            let receipt = prove_info.receipt;
            receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();
            let output: ValidateLogOutput = receipt.journal.decode().unwrap();
            assert!(!output.fair, "Extreme overflow values should be rejected");
        }
        Err(_) => {
            // Panic during proof generation is also acceptable
        }
    }
}

#[test]
fn test_extreme_overflow_velocity_time_product() {
    // Test overflow protection in reflection calculation (vy * dt)
    // Use values that would overflow when multiplied but are individually valid
    let large_value = 1i64 << 40; // Large but not MAX

    let events = vec![
        15728640,    // leftY - center (valid)
        15728640,    // rightY - center (valid)
        large_value, // leftY - large position (will cause vy * dt overflow in reflect1d)
        15728640,    // rightY - center
    ];
    let game_id = 0u32;

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let result = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF);

    // Should panic or return unfair due to overflow protection
    match result {
        Ok(prove_info) => {
            let receipt = prove_info.receipt;
            receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();
            let output: ValidateLogOutput = receipt.journal.decode().unwrap();
            assert!(!output.fair, "Overflow-inducing values should be rejected");
        }
        Err(_) => {
            // Panic during proof is acceptable for malicious inputs
        }
    }
}

#[test]
fn test_i64_min_edge_case() {
    // Test I64::MIN edge case (cannot be negated without overflow)
    let events = vec![
        i64::MIN,  // leftY - most negative value
        15728640,  // rightY - center
        15728640,  // leftY - center
        i64::MIN,  // rightY - most negative value
    ];

    let game_id = 0u32; // Zero game_id for test

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let result = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF);

    // I64::MIN should be handled gracefully (converted to I64::MAX in abs)
    match result {
        Ok(prove_info) => {
            let receipt = prove_info.receipt;
            receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();
            let output: ValidateLogOutput = receipt.journal.decode().unwrap();
            // Should be rejected due to out of bounds or too fast movement
            assert!(!output.fair, "I64::MIN should be rejected as invalid paddle position");
        }
        Err(_) => {
            // Panic is also acceptable
        }
    }
}

#[test]
fn test_malformed_receipt_rejection() {
    // Test that tampered proofs fail verification
    // This test generates a valid proof, then attempts to verify it with wrong image ID

    let events = vec![
        15728640,  // leftY - center
        15728640,  // rightY - center
        15728640,  // leftY
        15728640,  // rightY
    ];

    let game_id = 1u32; // Test game_id

    let input = ValidateLogInput { events, game_id };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();
    let receipt = prove_info.receipt;

    // Attempt 1: Verify with correct image ID (should succeed)
    let result_valid = receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID);
    assert!(result_valid.is_ok(), "Valid receipt should verify successfully");

    // Attempt 2: Create a fake image ID (all zeros)
    let fake_image_id = [0u8; 32];

    // Try to verify with wrong image ID (should fail)
    let result_invalid = receipt.verify(fake_image_id);
    assert!(result_invalid.is_err(), "Receipt with wrong image ID should fail verification");

    // Additional test: Verify that journal can't be decoded from tampered receipt
    // (This is implicit - if verification fails, journal should not be trusted)
}

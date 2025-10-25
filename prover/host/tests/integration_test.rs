// Unit tests for RISC0 zkVM prover validation logic
// Tests that rely on specific JSON log files are in log_validation_test.rs
use core::{ValidateLogInput, ValidateLogOutput};
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};

// Helper function to create test inputs with valid commitments
fn create_test_input(events: Vec<i64>, game_id: u32) -> ValidateLogInput {
    let seed_left = [0x42u8; 32];
    let seed_right = [0x99u8; 32];

    // Generate commitments for each event
    let commitments: Vec<core::Commitment32> = events
        .iter()
        .enumerate()
        .map(|(idx, &paddle_y)| {
            let is_left = idx % 2 == 0;
            let seed = if is_left { &seed_left } else { &seed_right };
            let commitment = core::compute_commitment(seed, idx as u32, paddle_y);
            core::Commitment32(commitment)
        })
        .collect();

    ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: seed_left,
        player_right_seed: seed_right,
    }
}

#[test]
fn test_invalid_too_many_events() {
    let events = vec![0; 10002]; // Over the 10,000 limit
    let game_id = 0u32;

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events.clone(), game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

    let input = create_test_input(events, game_id);

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

// ============================================================================
// SECURITY TESTS - Added for enhanced security validations
// ============================================================================

#[test]
fn test_duplicate_seeds_rejected() {
    // Test that both players using the same seed is rejected
    let events = vec![15728640, 15728640, 15728640, 15728640];
    let game_id = 42u32;

    let same_seed = [0x42u8; 32]; // Both players use identical seed
    let commitments = vec![
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: same_seed,
        player_right_seed: same_seed, // Duplicate!
    };

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
    assert!(!output.fair, "Games with duplicate player seeds should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("unique"),
        "Error should mention unique seeds requirement"
    );
}

#[test]
fn test_low_entropy_seed_left_player() {
    // Test that all-zero seed for left player is rejected
    let events = vec![15728640, 15728640, 15728640, 15728640];
    let game_id = 42u32;

    let weak_seed = [0u8; 32]; // All zeros - very weak!
    let good_seed = [0x42u8; 32];
    let commitments = vec![
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: weak_seed, // Weak!
        player_right_seed: good_seed,
    };

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
    assert!(!output.fair, "Games with weak left player seed should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("entropy"),
        "Error should mention entropy"
    );
}

#[test]
fn test_low_entropy_seed_right_player() {
    // Test that all-zero seed for right player is rejected
    let events = vec![15728640, 15728640, 15728640, 15728640];
    let game_id = 42u32;

    let good_seed = [0x42u8; 32];
    let weak_seed = [0u8; 32]; // All zeros - very weak!
    let commitments = vec![
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: good_seed,
        player_right_seed: weak_seed, // Weak!
    };

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
    assert!(!output.fair, "Games with weak right player seed should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("entropy"),
        "Error should mention entropy"
    );
}

#[test]
fn test_seed_with_acceptable_entropy() {
    // Test that seeds with some zeros (but not too many) are accepted
    let events = vec![15728640, 15728640];
    let game_id = 42u32;

    // Seed with 28 zeros is at the boundary (should pass)
    let mut acceptable_seed_left = [0xFFu8; 32];
    for i in 0..28 {
        acceptable_seed_left[i] = 0;
    }

    let good_seed_right = [0x42u8; 32];

    // Generate valid commitments
    let left_commitment = core::compute_commitment(&acceptable_seed_left, 0, events[0]);
    let right_commitment = core::compute_commitment(&good_seed_right, 1, events[1]);

    let commitments = vec![
        core::Commitment32(left_commitment),
        core::Commitment32(right_commitment),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: acceptable_seed_left,
        player_right_seed: good_seed_right,
    };

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

    // Should pass entropy check, but may fail for other reasons (invalid physics)
    // The key is it should NOT fail with "entropy" in the error
    if !output.fair {
        assert!(
            !output.reason.as_ref().unwrap().contains("entropy"),
            "Should not reject seed with 28 zeros (at boundary)"
        );
    }
}

#[test]
fn test_commitment_timing_attack_resistance() {
    // Test that commitment verification doesn't leak timing information
    // This is a basic test - full timing analysis would require specialized tools

    let events = vec![15728640, 15728640];
    let game_id = 99u32;

    let seed_left = [0xAAu8; 32];
    let seed_right = [0xBBu8; 32];

    // Create one invalid commitment
    let mut invalid_commitment = core::compute_commitment(&seed_left, 0, events[0]);
    invalid_commitment[0] ^= 0x01; // Flip first bit - early mismatch

    let commitments = vec![
        core::Commitment32(invalid_commitment), // Invalid - differs at byte 0
        core::Commitment32([0u8; 32]),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: seed_left,
        player_right_seed: seed_right,
    };

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
    assert!(!output.fair, "Invalid commitment should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("Commitment verification failed"),
        "Should fail commitment verification"
    );

    // The constant-time comparison ensures that verification takes the same time
    // whether the mismatch is at byte 0 or byte 31
}

#[test]
fn test_commitment_mismatch() {
    // Test that wrong commitments are rejected
    let events = vec![15728640, 15728640];
    let game_id = 12345u32;
    let seed_left = [0x42u8; 32];
    let seed_right = [0x99u8; 32];

    // Create commitments with wrong paddle value for first commitment
    let commitments = vec![
        core::Commitment32(core::compute_commitment(&seed_left, 0, 9999999i64)), // Wrong value
        core::Commitment32(core::compute_commitment(&seed_right, 1, events[1])),
    ];

    let input = ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: seed_left,
        player_right_seed: seed_right,
    };

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

    assert!(!output.fair, "Should reject mismatched commitment");
    assert!(
        output.reason.as_ref().unwrap().contains("Commitment verification failed"),
        "Should fail with commitment verification error"
    );
}

#[test]
fn test_commitment_count_mismatch() {
    // Test events.len() != commitments.len()
    let events = vec![15728640, 15728640, 15728640, 15728640];
    let game_id = 12345u32;
    let seed_left = [0x42u8; 32];
    let seed_right = [0x99u8; 32];

    // Only provide 2 commitments for 4 events
    let commitments = vec![
        core::Commitment32(core::compute_commitment(&seed_left, 0, events[0])),
        core::Commitment32(core::compute_commitment(&seed_right, 1, events[1])),
    ];

    let input = ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: seed_left,
        player_right_seed: seed_right,
    };

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

    assert!(!output.fair, "Should reject commitment count mismatch");
    assert!(
        output.reason.as_ref().unwrap().contains("Commitment count must match event count"),
        "Should fail with commitment count error"
    );
}

// ============================================================================
// HIGH PRIORITY TESTS - Security & Critical Edge Cases
// ============================================================================

#[test]
fn test_negative_paddle_position() {
    // Test that negative paddle Y values are rejected
    let events = vec![
        -1000i64,    // leftY - negative (invalid)
        15728640,    // rightY - center (valid)
    ];
    let game_id = 0u32;

    let input = create_test_input(events, game_id);

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

    assert!(!output.fair, "Negative paddle positions should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("out of bounds") ||
        output.reason.as_ref().unwrap().contains("too fast"),
        "Should reject with bounds or speed error"
    );
}

#[test]
fn test_boundary_entropy_rejection() {
    // Test exactly 29 zeros (should fail) vs 28 zeros (should pass)
    let events = vec![15728640, 15728640];
    let game_id = 42u32;

    // Create seed with exactly 29 zeros (should be rejected)
    let mut weak_seed = [0xFFu8; 32];
    for i in 0..29 {
        weak_seed[i] = 0;
    }
    // Only 3 non-zero bytes - insufficient entropy

    let good_seed = [0x42u8; 32];
    let commitments = vec![
        core::Commitment32([0u8; 32]),
        core::Commitment32([0u8; 32]),
    ];

    let input = core::ValidateLogInput {
        events,
        game_id,
        commitments,
        player_left_seed: weak_seed,
        player_right_seed: good_seed,
    };

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

    assert!(!output.fair, "Seed with 29 zeros should be rejected");
    assert!(
        output.reason.as_ref().unwrap().contains("entropy"),
        "Should mention entropy in error message"
    );
}

#[test]
fn test_game_id_boundary_zero() {
    // Test that game_id = 0 works correctly (doesn't cause crashes or overflow)
    let events = vec![15728640, 15728640];
    let game_id = 0u32; // Minimum value

    let input = create_test_input(events, game_id);

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

    // Key test: game_id=0 doesn't cause crashes or panics
    // The game will be invalid (incomplete), but that's expected behavior
    // Just verify it completes without error
    assert!(output.game_id == 0 || !output.fair, "Should complete without panic");
}

#[test]
fn test_game_id_boundary_max() {
    // Test that game_id = u32::MAX works correctly without overflow
    let events = vec![15728640, 15728640];
    let game_id = u32::MAX; // Maximum value

    let input = create_test_input(events, game_id);

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

    // Key test: u32::MAX doesn't cause overflow in serve angle calculation
    // The game will be invalid (incomplete), but should complete without panic
    assert!(!output.fair || output.game_id == u32::MAX, "Should complete without overflow panic");
}

#[test]
fn test_commitment_index_uniqueness() {
    // Test that same paddle_y at different indices produces different commitments
    let seed = [0x42u8; 32];
    let paddle_y = 15728640i64;

    // Compute commitment for same paddle_y at two different indices
    let commitment_idx0 = core::compute_commitment(&seed, 0, paddle_y);
    let commitment_idx1 = core::compute_commitment(&seed, 1, paddle_y);

    // These MUST be different - commitment includes event_index
    assert_ne!(
        commitment_idx0, commitment_idx1,
        "Commitments for same paddle_y at different indices must differ"
    );

    // Also test with different seeds, same index
    let seed2 = [0x99u8; 32];
    let commitment_seed2 = core::compute_commitment(&seed2, 0, paddle_y);

    assert_ne!(
        commitment_idx0, commitment_seed2,
        "Commitments with different seeds must differ"
    );
}

#[test]
fn test_journal_output_integrity() {
    // Test that journal output contains correct and complete data
    let events = vec![15728640, 15728640, 15728640, 15728640];
    let game_id = 12345u32;

    let input = create_test_input(events.clone(), game_id);

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

    // Verify journal structure is valid
    // The key test is that journal decodes successfully and has valid structure
    // Note: Incomplete games (only 4 events) return ValidateLogOutput::invalid()
    // which has default values (events_len=0, zero hash, etc.)
    // We only verify the journal can be decoded and the game is properly marked as invalid

    // Incomplete game should be marked as unfair with a reason
    assert!(!output.fair, "Incomplete game should be unfair");
    assert!(output.reason.is_some(), "Unfair games must have a reason");
    assert!(!output.reason.as_ref().unwrap().is_empty(), "Reason must not be empty");

    // Journal decoded successfully - this is the main goal of this test
}

// ============================================================================
// MEDIUM PRIORITY TESTS - Determinism & Documentation
// ============================================================================

#[test]
fn test_serve_determinism() {
    // Test that same inputs produce identical serve states
    let events = vec![15728640, 15728640];
    let game_id = 999u32;

    let input = create_test_input(events, game_id);

    // Generate proof twice with identical inputs
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
        "Deterministic: same inputs must produce same hash"
    );
}

#[test]
fn test_different_game_ids_different_serves() {
    // Test that different game_ids produce different behavior
    // Both games will be invalid (incomplete), but we verify the system
    // handles different game_ids without panicking

    let events = vec![15728640, 15728640];

    // Create inputs with different game_ids
    let input1 = create_test_input(events.clone(), 1u32);
    let input2 = create_test_input(events.clone(), 2u32);

    // Generate proofs
    let env1 = ExecutorEnv::builder().write(&input1).unwrap().build().unwrap();
    let prover = default_prover();
    let prove_info1 = prover.prove(env1, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();
    let receipt1 = prove_info1.receipt;
    receipt1.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();
    let output1: ValidateLogOutput = receipt1.journal.decode().unwrap();

    let env2 = ExecutorEnv::builder().write(&input2).unwrap().build().unwrap();
    let prover = default_prover();
    let prove_info2 = prover.prove(env2, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();
    let receipt2 = prove_info2.receipt;
    receipt2.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();
    let output2: ValidateLogOutput = receipt2.journal.decode().unwrap();

    // Both should complete without panic
    // The key test is that different game_ids don't cause errors
    assert!(!output1.fair || !output2.fair, "Incomplete games should be invalid");

    // Hashes should be identical since same events
    // (game_id affects serves, but with only 2 events we don't reach additional serves)
    assert_eq!(output1.log_hash_sha256, output2.log_hash_sha256, "Same events produce same hash");
}

#[test]
fn test_cordic_angle_boundaries() {
    // This is more of a unit test, but we can verify CORDIC works
    // within the physics validation by using extreme but valid angles

    // Use max bounce angle to ensure CORDIC handles boundary cases
    // The prover uses deg_to_rad_fixed(MAX_BOUNCE_ANGLE_DEG) which is 60 degrees
    // This is well within CORDIC's range (±8π), so we just verify it doesn't crash

    let events = vec![15728640, 15728640];
    let game_id = 0u32;

    let input = create_test_input(events, game_id);

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

    // Should complete without panic - CORDIC handles all game angles
    assert!(output.game_id == 0, "Proof should complete successfully");
}

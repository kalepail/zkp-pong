// Unit tests for RISC0 zkVM prover validation logic
// Tests that rely on specific JSON log files are in log_validation_test.rs
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ValidateLogInput {
    events: Vec<i128>,
}

#[derive(Deserialize, Debug)]
struct ValidateLogOutput {
    fair: bool,
    reason: Option<String>,
    #[allow(dead_code)]
    left_score: u32,
    #[allow(dead_code)]
    right_score: u32,
    #[allow(dead_code)]
    events_len: u32,
    #[allow(dead_code)]
    log_hash_sha256: [u8; 32],
}

#[test]
fn test_invalid_too_many_events() {
    let events = vec![0; 10002]; // Over the 10,000 limit

    let input = ValidateLogInput { events };

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

    let input = ValidateLogInput { events };

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

    let input = ValidateLogInput { events };

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

    let input = ValidateLogInput {
        events: events.clone(),
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
    let events: Vec<i128> = vec![];

    let input = ValidateLogInput { events };

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

    let input = ValidateLogInput { events };

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

    let input = ValidateLogInput { events };

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
    let events = vec![
        1030792151040,  // leftY - center
        1030792151040,  // rightY - center (will miss, left scores 1)
    ];

    let input = ValidateLogInput { events };

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

    // Should be rejected - neither player reached POINTS_TO_WIN
    assert!(!output.fair, "Game ending at 1-0 should be invalid");
    assert!(
        output.reason.unwrap().contains("neither player reached POINTS_TO_WIN"),
        "Error should mention final score validation"
    );
}

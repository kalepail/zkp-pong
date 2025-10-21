use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CompactLog {
    v: u32,
    seed: u32,
    events: Vec<String>,
}

#[derive(Serialize)]
struct ValidateLogInput {
    seed: u32,
    events: Vec<i128>,
}

#[derive(Deserialize, Debug)]
struct ValidateLogOutput {
    fair: bool,
    reason: Option<String>,
    left_score: u32,
    right_score: u32,
    events_len: u32,
    log_hash_sha256: [u8; 32],
}

fn load_and_parse_log(path: &str) -> (u32, Vec<i128>) {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));

    let log: CompactLog = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path, e));

    assert_eq!(log.v, 1, "Unsupported log version: {}", log.v);

    let events: Vec<i128> = log
        .events
        .iter()
        .map(|s| {
            s.parse::<i128>()
                .unwrap_or_else(|e| panic!("Failed to parse event '{}': {}", s, e))
        })
        .collect();

    (log.seed, events)
}

#[test]
fn test_valid_game_seed930397884() {
    let (seed, events) = load_and_parse_log("../../pong-log_seed930397884_events49_1757552715309.json");

    let input = ValidateLogInput { seed, events };

    // Build ExecutorEnv with input data
    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    // Generate proof
    let prover = default_prover();
    let prove_info = prover
        .prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF)
        .expect("Failed to generate proof");

    let receipt = prove_info.receipt;

    // Verify the receipt
    receipt
        .verify(GUEST_CODE_FOR_ZK_PROOF_ID)
        .expect("Receipt verification failed");

    // Decode and verify output
    let output: ValidateLogOutput = receipt.journal.decode().expect("Failed to decode journal");

    assert!(output.fair, "Game should be fair");
    assert_eq!(output.left_score, 3, "Expected left score 3");
    assert_eq!(output.right_score, 0, "Expected right score 0");
    assert_eq!(output.events_len, 98, "Expected 98 events");
    assert!(output.reason.is_none(), "Should not have error reason");
}

#[test]
fn test_valid_game_seed237054789() {
    let (seed, events) = load_and_parse_log("../../pong-log_seed237054789_events40_1757556139973.json");

    let input = ValidateLogInput { seed, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover
        .prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF)
        .expect("Failed to generate proof");

    let receipt = prove_info.receipt;

    receipt
        .verify(GUEST_CODE_FOR_ZK_PROOF_ID)
        .expect("Receipt verification failed");

    let output: ValidateLogOutput = receipt.journal.decode().expect("Failed to decode journal");

    assert!(output.fair, "Game should be fair");
    assert_eq!(output.left_score, 0, "Expected left score 0");
    assert_eq!(output.right_score, 3, "Expected right score 3");
    assert_eq!(output.events_len, 80, "Expected 80 events");
}

#[test]
fn test_valid_game_seed725309225() {
    let (seed, events) = load_and_parse_log("../../pong-log_seed725309225_events59_1761069335045.json");

    let input = ValidateLogInput { seed, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover
        .prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF)
        .expect("Failed to generate proof");

    let receipt = prove_info.receipt;

    receipt
        .verify(GUEST_CODE_FOR_ZK_PROOF_ID)
        .expect("Receipt verification failed");

    let output: ValidateLogOutput = receipt.journal.decode().expect("Failed to decode journal");

    assert!(output.fair, "Game should be fair");
    assert_eq!(output.left_score, 3, "Expected left score 3");
    assert_eq!(output.right_score, 2, "Expected right score 2");
    assert_eq!(output.events_len, 118, "Expected 118 events");
}

// Config validation tests removed - config is now hardcoded as constants

#[test]
fn test_invalid_too_many_events() {
    let seed = 12345;
    let events = vec![0; 10002]; // Over the 10,000 limit

    let input = ValidateLogInput { seed, events };

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
    let seed = 12345;
    let events = vec![0; 11]; // Odd number - invalid!

    let input = ValidateLogInput { seed, events };

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
    let seed = 12345;
    let events = vec![0; 10000]; // Exactly at the limit - should be OK

    let input = ValidateLogInput { seed, events };

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
    let seed = 42;
    let events = vec![12345, 67890, 11111, 22222];

    let input = ValidateLogInput {
        seed,
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

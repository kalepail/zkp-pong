// Tests for validating real game logs from JSON files
// These tests depend on specific JSON log files in the project root
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};

// Game configuration constants - must match guest code
const POINTS_TO_WIN: u32 = 3;

#[derive(Deserialize)]
struct CompactLog {
    v: u32,
    events: Vec<String>,
}

#[derive(Serialize)]
struct ValidateLogInput {
    events: Vec<i128>,
}

#[derive(Deserialize, Debug)]
struct ValidateLogOutput {
    fair: bool,
    reason: Option<String>,
    left_score: u32,
    right_score: u32,
    events_len: u32,
    #[allow(dead_code)]
    log_hash_sha256: [u8; 32],
}

fn load_and_parse_log(path: &str) -> Vec<i128> {
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

    events
}

#[test]
fn test_valid_game_39_events() {
    let events = load_and_parse_log("../../pong-log_events39_1761096045223.json");

    let input = ValidateLogInput { events };

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
    assert_eq!(output.left_score, POINTS_TO_WIN, "Expected left score to be POINTS_TO_WIN");
    assert_eq!(output.right_score, 0, "Expected right score 0");
    assert_eq!(output.events_len, 78, "Expected 78 events (39 pairs)");
    assert!(output.reason.is_none(), "Should not have error reason");
}

#[test]
fn test_valid_game_61_events() {
    let events = load_and_parse_log("../../pong-log_events61_1761095976507.json");

    let input = ValidateLogInput { events };

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
    assert_eq!(output.left_score, POINTS_TO_WIN, "Expected left score to be POINTS_TO_WIN");
    assert_eq!(output.right_score, POINTS_TO_WIN - 1, "Expected right score to be POINTS_TO_WIN - 1");
    assert_eq!(output.events_len, 122, "Expected 122 events (61 pairs)");
    assert!(output.reason.is_none(), "Should not have error reason");
}

#[test]
fn test_valid_game_68_events() {
    let events = load_and_parse_log("../../pong-log_events68_1761096140129.json");

    let input = ValidateLogInput { events };

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
    assert_eq!(output.left_score, POINTS_TO_WIN - 1, "Expected left score to be POINTS_TO_WIN - 1");
    assert_eq!(output.right_score, POINTS_TO_WIN, "Expected right score to be POINTS_TO_WIN");
    assert_eq!(output.events_len, 136, "Expected 136 events (68 pairs)");
    assert!(output.reason.is_none(), "Should not have error reason");
}

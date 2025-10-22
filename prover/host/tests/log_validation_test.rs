// Tests for validating real game logs from JSON files
// These tests depend on specific JSON log files in the project root
use core::{CompactLog, ValidateLogInput, ValidateLogOutput};
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};

fn load_and_parse_log(path: &str) -> (Vec<i64>, u32) {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));

    let log: CompactLog = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path, e));

    assert_eq!(log.v, 1, "Unsupported log version: {}", log.v);

    let events: Vec<i64> = log
        .events
        .iter()
        .map(|s| {
            s.parse::<i64>()
                .unwrap_or_else(|e| panic!("Failed to parse event '{}': {}", s, e))
        })
        .collect();

    (events, log.game_id)
}

#[test]
fn test_valid_game_19_events() {
    let (events, game_id) = load_and_parse_log("../../pong-log_events19_1761147203682.json");

    let input = ValidateLogInput { events, game_id };

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 38, "Expected 38 events (19 pairs)");
}

#[test]
fn test_valid_game_64_events() {
    let (events, game_id) = load_and_parse_log("../../pong-log_events64_1761147732142.json");

    let input = ValidateLogInput { events, game_id };

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 128, "Expected 128 events (64 pairs)");
}

#[test]
fn test_valid_game_71_events() {
    let (events, game_id) = load_and_parse_log("../../pong-log_events71_1761147635847.json");

    let input = ValidateLogInput { events, game_id };

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 142, "Expected 142 events (71 pairs)");
}

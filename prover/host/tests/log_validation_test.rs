// Tests for validating real game logs from JSON files
// These tests depend on specific JSON log files in the project root
use core::{CompactLog, ValidateLogInput, ValidateLogOutput};
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};

fn load_and_parse_log(path: &str) -> Vec<i64> {
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

    events
}

#[test]
fn test_valid_game_67_events() {
    let events = load_and_parse_log("../../pong-log_events67_1761140976543.json");

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 134, "Expected 134 events (67 pairs)");
}

#[test]
fn test_valid_game_75_events() {
    let events = load_and_parse_log("../../pong-log_events75_1761139604550.json");

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 150, "Expected 150 events (75 pairs)");
}

#[test]
fn test_valid_game_86_events() {
    let events = load_and_parse_log("../../pong-log_events86_1761139690493.json");

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
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 172, "Expected 172 events (86 pairs)");
}

// Tests for validating real game logs from JSON files
// All game logs must include commitment data (player seeds and commitments)
use core::{CompactLog, ValidateLogOutput};

fn load_and_prove_log(path: &str) -> ValidateLogOutput {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));

    let log: CompactLog = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path, e));

    assert_eq!(log.v, 1, "Unsupported log version: {}", log.v);

    // Parse log and create proof using host library
    let proof = host::generate_pong_proof(&log, host::ReceiptKind::Succinct)
        .unwrap_or_else(|e| panic!("Failed to generate proof: {}", e));

    // Verify the proof
    host::verify_pong_proof(&proof)
        .unwrap_or_else(|e| panic!("Failed to verify proof: {}", e));

    // Decode and return output
    proof.receipt.journal.decode().expect("Failed to decode journal output")
}

#[test]
fn test_valid_game_85_events() {
    let output = load_and_prove_log("../../pong-log_events85_1761349770536.json");

    assert!(output.fair, "Game should be fair");
    assert!(output.reason.is_none(), "Should not have error reason");
    assert_eq!(output.events_len, 170, "Expected 170 events (85 pairs)");
    assert_eq!(output.game_id, 1373791838, "Game ID should match");

    // Verify final score (from the log we know it's 3-2)
    assert_eq!(output.left_score, 3, "Left score should be 3");
    assert_eq!(output.right_score, 2, "Right score should be 2");
}

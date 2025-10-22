use core::CompactLog;
use host::{generate_pong_proof, verify_pong_proof, PongProof, ReceiptKind};
use serde::Serialize;
use std::str::FromStr;

/// Production-ready proof output for on-chain verification
#[derive(Serialize)]
struct ProofOutput {
    /// The cryptographic receipt seal (ZK proof) - omitted from JSON, use receipt_size
    #[serde(skip)]
    #[allow(dead_code)]
    receipt_seal: String,
    /// Size of the receipt in bytes
    receipt_size_bytes: usize,
    /// Public journal outputs (hex-encoded)
    journal: String,
    /// Program image ID for verification
    image_id: String,
    /// Game result: left player score
    left_score: u32,
    /// Game result: right player score
    right_score: u32,
    /// SHA-256 hash of game log (hex-encoded)
    log_hash: String,
    /// Number of events processed
    events_len: u32,
    /// Whether the game was fair
    fair: bool,
    /// Error reason if unfair
    reason: Option<String>,
    /// Game ID - for replay protection
    game_id: u32,
    /// Receipt format used
    receipt_kind: String,
}

fn format_proof_output(proof: &PongProof) -> ProofOutput {
    use methods::GUEST_CODE_FOR_ZK_PROOF_ID;

    // Serialize the full receipt to get actual proof size
    let receipt_bytes = bincode::serialize(&proof.receipt).unwrap();
    let receipt_size = receipt_bytes.len();

    ProofOutput {
        receipt_seal: hex::encode(&receipt_bytes), // Kept for access but skipped in JSON
        receipt_size_bytes: receipt_size,
        journal: hex::encode(bincode::serialize(&proof.receipt.journal).unwrap()),
        image_id: {
            // Convert [u32; 8] to bytes
            let mut bytes = Vec::with_capacity(32);
            for word in GUEST_CODE_FOR_ZK_PROOF_ID.iter() {
                bytes.extend_from_slice(&word.to_le_bytes());
            }
            hex::encode(bytes)
        },
        left_score: proof.left_score,
        right_score: proof.right_score,
        log_hash: hex::encode(proof.log_hash),
        events_len: proof.events_len,
        fair: proof.fair,
        reason: proof.reason.clone(),
        game_id: proof.game_id,
        receipt_kind: proof.receipt_kind.to_string(),
    }
}

fn print_usage() {
    eprintln!("Usage: pong-prover <path-to-pong-log.json> [--format <composite|succinct|groth16>]");
    eprintln!();
    eprintln!("Arguments:");
    eprintln!("  <path-to-pong-log.json>  Path to the game log JSON file");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --format <type>          Receipt format (default: succinct)");
    eprintln!("                           - composite: Fastest, largest (~MB)");
    eprintln!("                           - succinct:  Medium speed/size (~200 KB)");
    eprintln!("                           - groth16:   Slowest, smallest (~200-300 bytes)");
    eprintln!();
    eprintln!("Example:");
    eprintln!("  pong-prover pong-log_seed930397884_events49_1757552715309.json");
    eprintln!("  pong-prover pong-log_seed930397884_events49_1757552715309.json --format groth16");
}

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    // Parse command line arguments
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let path = &args[1];
    let mut receipt_kind = ReceiptKind::default();

    // Parse optional --format flag
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--format" | "-f" => {
                if i + 1 >= args.len() {
                    eprintln!("Error: --format requires an argument");
                    print_usage();
                    std::process::exit(1);
                }
                receipt_kind = ReceiptKind::from_str(&args[i + 1]).unwrap_or_else(|e| {
                    eprintln!("Error: {}", e);
                    print_usage();
                    std::process::exit(1);
                });
                i += 2;
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            _ => {
                eprintln!("Error: Unknown argument '{}'", args[i]);
                print_usage();
                std::process::exit(1);
            }
        }
    }

    // Check file size before reading (DoS protection)
    const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
    let metadata = std::fs::metadata(path).unwrap_or_else(|e| {
        eprintln!("Error accessing file '{}': {}", path, e);
        std::process::exit(1);
    });

    if metadata.len() > MAX_LOG_SIZE {
        eprintln!(
            "Log file too large: {} bytes (max {} bytes)",
            metadata.len(),
            MAX_LOG_SIZE
        );
        eprintln!("This may indicate a malformed or malicious file");
        std::process::exit(1);
    }

    let raw = std::fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("Error reading file '{}': {}", path, e);
        std::process::exit(1);
    });

    let log: CompactLog = serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!("Error parsing JSON: {}", e);
        std::process::exit(1);
    });

    eprintln!("Loaded {} events from {}", log.events.len(), path);
    eprintln!("Game ID: {}", log.game_id);
    eprintln!("Receipt format: {}", receipt_kind);
    eprintln!("Generating proof...");

    // Generate proof
    let proof = generate_pong_proof(&log, receipt_kind).unwrap_or_else(|e| {
        eprintln!("Proof generation failed: {}", e);
        std::process::exit(1);
    });

    eprintln!("Verifying proof...");

    // Verify proof
    verify_pong_proof(&proof).unwrap_or_else(|e| {
        eprintln!("Proof verification failed: {}", e);
        std::process::exit(1);
    });

    // Format output
    let proof_output = format_proof_output(&proof);
    let receipt_size = proof_output.receipt_size_bytes;

    if !proof.fair {
        eprintln!("\nProof verified successfully!");
        eprintln!("Result: UNFAIR GAME");
        eprintln!(
            "Reason: {}",
            proof.reason.unwrap_or_else(|| "Unknown".to_string())
        );
        eprintln!("Log Hash: 0x{}", hex::encode(proof.log_hash));
        eprintln!("Receipt Size: {} bytes", receipt_size);
        eprintln!("\n=== PRODUCTION OUTPUT (JSON) ===");
        println!(
            "{}",
            serde_json::to_string_pretty(&proof_output).unwrap()
        );
        std::process::exit(1);
    } else {
        eprintln!("\nProof verified successfully!");
        eprintln!("Result: FAIR GAME");
        eprintln!("Log Hash: 0x{}", hex::encode(proof.log_hash));
        eprintln!("Events Processed: {}", proof.events_len);
        eprintln!("Score: {}-{}", proof.left_score, proof.right_score);
        eprintln!("Receipt Size: {} bytes", receipt_size);
        eprintln!("\n=== PRODUCTION OUTPUT (JSON) ===");
        println!(
            "{}",
            serde_json::to_string_pretty(&proof_output).unwrap()
        );
    }
}

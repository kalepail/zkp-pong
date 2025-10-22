use core::CompactLog;
use host::{generate_pong_proof, verify_pong_proof, PongProof, ReceiptKind};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::str::FromStr;
use std::time::Instant;

/// Saved proof file format
#[derive(Serialize, Deserialize)]
struct SavedProof {
    /// The complete proof with receipt
    proof: PongProof,
    /// Metadata for display
    left_score: u32,
    right_score: u32,
    log_hash: String,
    events_len: u32,
    fair: bool,
    reason: Option<String>,
    game_id: u32,
    receipt_kind: String,
    receipt_size_bytes: usize,
}

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    println!("🎮 RISC Zero Pong Proof System");
    println!("{}", "=".repeat(70));
    println!();

    // Parse CLI arguments
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage(&args[0]);
        std::process::exit(1);
    }

    let command = &args[1];

    match command.as_str() {
        "prove" => {
            if args.len() < 3 {
                eprintln!("Usage: {} prove <log_file> [--format <type>] [output_file]", args[0]);
                std::process::exit(1);
            }

            let log_file = &args[2];

            // Parse optional --format flag
            let mut receipt_kind = ReceiptKind::default();
            let mut output_file_idx = 3;

            if args.len() > 3 && (args[3] == "--format" || args[3] == "-f") {
                if args.len() < 5 {
                    eprintln!("❌ Error: --format requires a value (composite|succinct|groth16)");
                    std::process::exit(1);
                }
                receipt_kind = ReceiptKind::from_str(&args[4]).unwrap_or_else(|e| {
                    eprintln!("❌ Error: {}", e);
                    std::process::exit(1);
                });
                output_file_idx = 5;
            }

            let output_file = args.get(output_file_idx).map(|s| s.as_str());

            prove_command(log_file, receipt_kind, output_file);
        }

        "verify" => {
            if args.len() < 3 {
                eprintln!("Usage: {} verify <proof_file>", args[0]);
                eprintln!("Error: Missing required argument");
                std::process::exit(1);
            }

            let proof_file = &args[2];

            verify_command(proof_file);
        }

        "--help" | "-h" => {
            print_usage(&args[0]);
            std::process::exit(0);
        }

        _ => {
            eprintln!("❌ Unknown command: {}", command);
            print_usage(&args[0]);
            std::process::exit(1);
        }
    }
}

fn print_usage(program: &str) {
    eprintln!("Usage: {} <command> [options]", program);
    eprintln!();
    eprintln!("Commands:");
    eprintln!("  prove <log_file> [--format <type>] [output_file]");
    eprintln!("      Generate a cryptographic proof for a game log");
    eprintln!("      - log_file: JSON file containing the game log");
    eprintln!("      - --format: Optional receipt type (composite|succinct|groth16)");
    eprintln!("                  Default: succinct");
    eprintln!("      - output_file: Optional file to save the proof (JSON)");
    eprintln!("                     Defaults to: pong-proof_game<id>_<timestamp>.json");
    eprintln!();
    eprintln!("  verify <proof_file>");
    eprintln!("      Cryptographically verify a pong proof");
    eprintln!("      - proof_file: JSON file containing the proof");
    eprintln!();
    eprintln!("Receipt Formats:");
    eprintln!("  composite: Fastest proving, largest size (~MB)");
    eprintln!("  succinct:  Balanced, medium size (~200 KB) - recommended");
    eprintln!("  groth16:   Slowest proving, smallest size (~200-300 bytes)");
    eprintln!();
    eprintln!("Example workflow:");
    eprintln!("  1. Generate proof: {} prove pong-log.json --format succinct", program);
    eprintln!("     (saves to pong-proof_game<id>_<timestamp>.json)");
    eprintln!("  2. Verify proof:   {} verify pong-proof_game<id>_<timestamp>.json", program);
}

fn prove_command(log_file: &str, receipt_kind: ReceiptKind, output_file: Option<&str>) {
    println!("📋 Generating proof for game log");
    println!("  Log file: {}", log_file);
    println!("  Receipt format: {}", receipt_kind);
    println!();

    // Check file size before reading (DoS protection)
    const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
    let metadata = fs::metadata(log_file).unwrap_or_else(|e| {
        eprintln!("❌ Error accessing file '{}': {}", log_file, e);
        std::process::exit(1);
    });

    if metadata.len() > MAX_LOG_SIZE {
        eprintln!(
            "❌ Log file too large: {} bytes (max {} bytes)",
            metadata.len(),
            MAX_LOG_SIZE
        );
        eprintln!("   This may indicate a malformed or malicious file");
        std::process::exit(1);
    }

    // Load log file
    let raw = fs::read_to_string(log_file).unwrap_or_else(|e| {
        eprintln!("❌ Error reading file '{}': {}", log_file, e);
        std::process::exit(1);
    });

    let log: CompactLog = serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!("❌ Error parsing JSON: {}", e);
        std::process::exit(1);
    });

    println!("📦 Loaded {} events from log", log.events.len());
    println!("  Game ID: {}", log.game_id);
    println!();

    // Generate proof
    println!("🔐 Generating proof (this may take a while)...");
    let start = Instant::now();

    let proof = generate_pong_proof(&log, receipt_kind).unwrap_or_else(|e| {
        eprintln!();
        eprintln!("❌ Proof generation failed: {}", e);
        std::process::exit(1);
    });

    let duration = start.elapsed();
    println!("  Proving time: {:.2}s", duration.as_secs_f64());
    println!();

    // Prepare saved proof
    let receipt_bytes = bincode::serialize(&proof.receipt).unwrap();
    let saved_proof = SavedProof {
        proof: proof.clone(),
        left_score: proof.left_score,
        right_score: proof.right_score,
        log_hash: hex::encode(proof.log_hash),
        events_len: proof.events_len,
        fair: proof.fair,
        reason: proof.reason.clone(),
        game_id: proof.game_id,
        receipt_kind: proof.receipt_kind.to_string(),
        receipt_size_bytes: receipt_bytes.len(),
    };

    // Determine output filename
    let default_filename = format!("pong-proof_game{}_{}.json", proof.game_id, chrono::Utc::now().timestamp());
    let file_to_save = output_file.unwrap_or(&default_filename);

    // Save proof
    match save_proof(&saved_proof, file_to_save) {
        Ok(_) => {
            println!("✅ Proof generated successfully!");
            println!("  Result: {}", if proof.fair { "FAIR GAME" } else { "UNFAIR GAME" });
            if !proof.fair {
                println!("  Reason: {}", proof.reason.unwrap_or_else(|| "Unknown".to_string()));
            }
            println!("  Score: {}-{}", proof.left_score, proof.right_score);
            println!("  Log Hash: 0x{}", hex::encode(proof.log_hash));
            println!("  Events Processed: {}", proof.events_len);
            println!("  Receipt Size: {} bytes", receipt_bytes.len());
            println!();
            println!("💾 Proof saved to: {}", file_to_save);
            println!("   Use 'verify {}' to cryptographically verify this proof", file_to_save);
            println!("{}", "=".repeat(70));
        }
        Err(e) => {
            eprintln!("❌ Error saving proof: {}", e);
            std::process::exit(1);
        }
    }
}

fn verify_command(proof_file: &str) {
    println!("📋 Verifying proof");
    println!("  Proof file: {}", proof_file);
    println!();

    // Load proof
    let saved_proof = match load_proof(proof_file) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("❌ Error loading proof: {}", e);
            std::process::exit(1);
        }
    };

    println!("📦 Loaded proof");
    println!("  Game ID: {}", saved_proof.game_id);
    println!("  Receipt format: {}", saved_proof.receipt_kind);
    println!("  Receipt size: {} bytes", saved_proof.receipt_size_bytes);
    println!();

    // Cryptographically verify the receipt
    println!("🔐 Verifying receipt cryptographically...");
    let start = Instant::now();

    match verify_pong_proof(&saved_proof.proof) {
        Ok(()) => {
            let duration = start.elapsed();
            println!("  Verification time: {:.2}s", duration.as_secs_f64());
            println!();
            println!("✅ Receipt cryptographically verified!");
            println!();
            println!("The proof cryptographically attests that:");
            println!("  1. The game log was correctly validated");
            println!("  2. The game was {}", if saved_proof.fair { "FAIR" } else { "UNFAIR" });
            if !saved_proof.fair {
                println!("     Reason: {}", saved_proof.reason.unwrap_or_else(|| "Unknown".to_string()));
            }
            println!("  3. Final score: {}-{}", saved_proof.left_score, saved_proof.right_score);
            println!("  4. The computation was executed correctly in the zkVM");
            println!();
            if saved_proof.fair {
                println!("🎊 This game result is cryptographically verified!");
            }
            println!("{}", "=".repeat(70));
        }
        Err(e) => {
            eprintln!();
            eprintln!("❌ Receipt verification failed: {}", e);
            eprintln!();
            eprintln!("The receipt is not cryptographically valid. This could mean:");
            eprintln!("  - The proof was tampered with");
            eprintln!("  - The proof was not generated by the correct program");
            eprintln!("  - The receipt data is corrupted");
            eprintln!("{}", "=".repeat(70));
            std::process::exit(1);
        }
    }
}

fn save_proof(proof: &SavedProof, path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_string_pretty(proof)?;
    fs::write(path, json)?;
    Ok(())
}

fn load_proof(path: &str) -> Result<SavedProof, Box<dyn std::error::Error>> {
    let json = fs::read_to_string(path)?;
    let proof: SavedProof = serde_json::from_str(&json)?;
    Ok(proof)
}

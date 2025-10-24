use core::{CompactLog, Commitment32, ValidateLogInput, ValidateLogOutput};
use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};

/// Receipt type for proof generation
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReceiptKind {
    /// Composite receipt - fastest to generate, largest size (multiple MB)
    Composite,
    /// Succinct receipt - STARK proof, medium size (~200 KB)
    Succinct,
    /// Groth16 receipt - SNARK proof, smallest size (~200-300 bytes)
    Groth16,
}

impl Default for ReceiptKind {
    fn default() -> Self {
        ReceiptKind::Succinct
    }
}

impl std::str::FromStr for ReceiptKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "composite" => Ok(ReceiptKind::Composite),
            "succinct" => Ok(ReceiptKind::Succinct),
            "groth16" => Ok(ReceiptKind::Groth16),
            _ => Err(format!(
                "Invalid receipt kind: '{}'. Must be 'composite', 'succinct', or 'groth16'",
                s
            )),
        }
    }
}

impl std::fmt::Display for ReceiptKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReceiptKind::Composite => write!(f, "composite"),
            ReceiptKind::Succinct => write!(f, "succinct"),
            ReceiptKind::Groth16 => write!(f, "groth16"),
        }
    }
}

impl From<ReceiptKind> for risc0_zkvm::ReceiptKind {
    fn from(kind: ReceiptKind) -> Self {
        match kind {
            ReceiptKind::Composite => risc0_zkvm::ReceiptKind::Composite,
            ReceiptKind::Succinct => risc0_zkvm::ReceiptKind::Succinct,
            ReceiptKind::Groth16 => risc0_zkvm::ReceiptKind::Groth16,
        }
    }
}

/// Output from pong game validation proof
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PongProof {
    /// The cryptographic receipt (ZK proof)
    pub receipt: Receipt,

    /// The type of receipt generated
    pub receipt_kind: ReceiptKind,

    /// Game result: left player score
    pub left_score: u32,

    /// Game result: right player score
    pub right_score: u32,

    /// SHA-256 hash of game log
    pub log_hash: [u8; 32],

    /// Number of events processed
    pub events_len: u32,

    /// Whether the game was fair
    pub fair: bool,

    /// Error reason if unfair
    pub reason: Option<String>,

    /// Game ID - for replay protection
    pub game_id: u32,
}

/// Generate a proof for pong game validation.
///
/// This creates a cryptographic proof that a game log was correctly validated,
/// computing the final score and checking for fairness violations.
///
/// # Arguments
/// * `log` - The compact game log to validate
/// * `receipt_kind` - The type of receipt to generate (Composite, Succinct, or Groth16)
///
/// # Returns
/// * `Ok(PongProof)` - The proof with receipt and game results
/// * `Err` - If proof generation fails
pub fn generate_pong_proof(
    log: &CompactLog,
    receipt_kind: ReceiptKind,
) -> Result<PongProof, Box<dyn std::error::Error>> {
    tracing::info!(
        "Generating pong proof for game {} with receipt kind: {}",
        log.game_id,
        receipt_kind
    );

    if log.v != 1 {
        return Err(format!("Unsupported log version: {}", log.v).into());
    }

    // Parse events as Q16.16 (i64)
    let mut events: Vec<i64> = Vec::with_capacity(log.events.len());
    for s in log.events.iter() {
        let v_q16: i64 = s.parse().map_err(|e| format!("Error parsing event: {}", e))?;
        events.push(v_q16);
    }

    // Parse commitments (hex-encoded SHA-256 hashes)
    let mut commitments: Vec<Commitment32> = Vec::with_capacity(log.commitments.len());
    for comm_hex in log.commitments.iter() {
        let comm_bytes = hex::decode(comm_hex)
            .map_err(|e| format!("Error decoding commitment hex: {}", e))?;
        if comm_bytes.len() != 32 {
            return Err(format!("Invalid commitment length: expected 32 bytes, got {}", comm_bytes.len()).into());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&comm_bytes);
        commitments.push(Commitment32(arr));
    }

    // Parse player seeds (hex-encoded random 32-byte values)
    let left_seed_bytes = hex::decode(&log.player_left_seed)
        .map_err(|e| format!("Error decoding left player seed: {}", e))?;
    if left_seed_bytes.len() != 32 {
        return Err(format!("Invalid left player seed length: expected 32 bytes, got {}", left_seed_bytes.len()).into());
    }
    let mut player_left_seed = [0u8; 32];
    player_left_seed.copy_from_slice(&left_seed_bytes);

    let right_seed_bytes = hex::decode(&log.player_right_seed)
        .map_err(|e| format!("Error decoding right player seed: {}", e))?;
    if right_seed_bytes.len() != 32 {
        return Err(format!("Invalid right player seed length: expected 32 bytes, got {}", right_seed_bytes.len()).into());
    }
    let mut player_right_seed = [0u8; 32];
    player_right_seed.copy_from_slice(&right_seed_bytes);

    let input = ValidateLogInput {
        events,
        game_id: log.game_id,
        commitments,
        player_left_seed,
        player_right_seed,
    };

    // Build execution environment
    let env = ExecutorEnv::builder()
        .write(&input)?
        .build()?;

    // Configure prover options with desired receipt kind
    let opts = match receipt_kind {
        ReceiptKind::Composite => ProverOpts::composite(),
        ReceiptKind::Succinct => ProverOpts::succinct(),
        ReceiptKind::Groth16 => ProverOpts::groth16(),
    };

    // Generate proof
    let prover = default_prover();
    let prove_info = prover
        .prove_with_opts(env, GUEST_CODE_FOR_ZK_PROOF_ELF, &opts)
        .map_err(|e| format!("Failed to generate proof: {}", e))?;

    let receipt = prove_info.receipt;

    // Decode output from journal
    let out: ValidateLogOutput = receipt.journal.decode()?;

    tracing::info!("Proof generated successfully (receipt kind: {})", receipt_kind);

    Ok(PongProof {
        receipt,
        receipt_kind,
        left_score: out.left_score,
        right_score: out.right_score,
        log_hash: out.log_hash_sha256,
        events_len: out.events_len,
        fair: out.fair,
        reason: out.reason,
        game_id: out.game_id,
    })
}

/// Verify a PongProof receipt cryptographically.
///
/// This function verifies that a PongProof's receipt is valid by checking:
/// 1. The receipt is cryptographically valid (signature verification)
/// 2. The receipt was generated by the GUEST_CODE_FOR_ZK_PROOF program (image ID check)
///
/// # Arguments
/// * `proof` - The pong proof to verify
///
/// # Returns
/// * `Ok(())` - If the receipt is valid
/// * `Err` - If verification fails
pub fn verify_pong_proof(proof: &PongProof) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("Verifying pong proof receipt for game {}", proof.game_id);

    // Verify the receipt against the image ID
    proof
        .receipt
        .verify(GUEST_CODE_FOR_ZK_PROOF_ID)
        .map_err(|e| format!("Receipt verification failed: {}", e))?;

    tracing::info!("Receipt verification successful");
    Ok(())
}

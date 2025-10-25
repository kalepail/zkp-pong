#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Fixed-point type: Q16.16 format using i64
pub type I = i64;

/// SHA-256 commitment (32 bytes)
/// Format: SHA256(seed || event_index || paddle_y)
#[derive(Serialize, Deserialize, Clone)]
pub struct Commitment32(pub [u8; 32]);

impl Commitment32 {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// Input structure for log validation (used by guest)
#[derive(Serialize, Deserialize)]
pub struct ValidateLogInput {
    pub events: Vec<I>,
    /// Unique game identifier - used for serve angle entropy and replay protection
    ///
    /// SECURITY REQUIREMENT: This MUST be generated using a cryptographically secure
    /// random number generator (CSRNG) on the client side. Using predictable or
    /// sequential game IDs could enable replay attacks or game outcome prediction.
    ///
    /// Recommended generation (JavaScript):
    /// ```js
    /// const gameId = crypto.getRandomValues(new Uint32Array(1))[0];
    /// ```
    pub game_id: u32,
    /// SHA-256 commitments for each event (one per paddle position)
    /// Each commitment: SHA256(seed || event_index || paddle_y)
    pub commitments: Vec<Commitment32>,
    /// Revealed seed for left player (32 bytes)
    ///
    /// SECURITY REQUIREMENT: Must be generated using crypto.getRandomValues()
    /// or equivalent CSRNG with full 32 bytes of entropy
    pub player_left_seed: [u8; 32],
    /// Revealed seed for right player (32 bytes)
    ///
    /// SECURITY REQUIREMENT: Must be generated using crypto.getRandomValues()
    /// or equivalent CSRNG with full 32 bytes of entropy
    pub player_right_seed: [u8; 32],
}

/// Output structure from log validation (returned by guest)
#[derive(Serialize, Deserialize, Debug)]
pub struct ValidateLogOutput {
    pub fair: bool,
    pub reason: Option<String>,
    pub left_score: u32,
    pub right_score: u32,
    pub events_len: u32,
    pub log_hash_sha256: [u8; 32],
    /// Game ID included in output for replay protection
    pub game_id: u32,
}

impl ValidateLogOutput {
    pub fn ok(left: u32, right: u32, events_len: u32, hash: [u8; 32], game_id: u32) -> Self {
        Self {
            fair: true,
            reason: None,
            left_score: left,
            right_score: right,
            events_len,
            log_hash_sha256: hash,
            game_id,
        }
    }

    pub fn invalid(msg: &str) -> Self {
        Self {
            fair: false,
            reason: Some(msg.into()),
            left_score: 0,
            right_score: 0,
            events_len: 0,
            log_hash_sha256: [0u8; 32],
            game_id: 0,
        }
    }
}

/// Compact log format (used by host for parsing JSON)
#[derive(Deserialize)]
pub struct CompactLog {
    pub v: u32,
    pub events: Vec<String>,
    /// Game ID - used for serve angle entropy and replay protection
    pub game_id: u32,
    /// SHA-256 commitments (hex-encoded) for each event
    pub commitments: Vec<String>,
    /// Revealed seed (hex-encoded) for left player
    pub player_left_seed: String,
    /// Revealed seed (hex-encoded) for right player
    pub player_right_seed: String,
}

/// Compute SHA-256 commitment for a paddle position
/// Format: SHA256(seed || event_index || paddle_y)
/// This creates a binding commitment that proves the player committed to this move
pub fn compute_commitment(seed: &[u8; 32], event_index: u32, paddle_y: I) -> [u8; 32] {
    let mut h = Sha256::new();

    // seed (32 bytes) || event_index (4 bytes LE) || paddle_y (8 bytes LE)
    h.update(seed);
    h.update(&event_index.to_le_bytes());
    h.update(&paddle_y.to_le_bytes());

    let out = h.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

/// Compute SHA-256 hash of game log events
/// This hash binds the proof to specific game events
pub fn compute_log_hash(events: &Vec<I>) -> [u8; 32] {
    let mut h = Sha256::new();

    // Build buffer for batch hashing (more efficient with SHA-256 accelerator)
    // Version prefix: 9 bytes
    // Events: variable length (8 bytes per i64)
    let mut buf = Vec::with_capacity(9 + events.len() * 8);

    // Version prefix
    buf.extend_from_slice(b"PONGLOGv1");

    // Events as little-endian 8 bytes per I (i64)
    for v in events.iter() {
        buf.extend_from_slice(&v.to_le_bytes());
    }

    // Single batch update (optimal for SHA-256 accelerator)
    h.update(&buf);

    let out = h.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

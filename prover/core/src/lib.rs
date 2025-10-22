#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Fixed-point type: Q16.16 format using i64
pub type I = i64;

/// Input structure for log validation (used by guest)
#[derive(Serialize, Deserialize)]
pub struct ValidateLogInput {
    pub events: Vec<I>,
    /// Unique game identifier - used for serve angle entropy
    /// Generated randomly by client at game start
    pub game_id: u32,
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

use serde::{Deserialize, Serialize};
use std::vec::Vec;
use std::string::String;

use crate::fixed::I;

#[derive(Serialize, Deserialize)]
pub struct ValidateLogInput {
    pub seed: u32,
    pub events: Vec<I>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ValidateLogOutput {
    pub fair: bool,
    pub reason: Option<String>,
    pub left_score: u32,
    pub right_score: u32,
    pub events_len: u32,
    pub log_hash_sha256: [u8; 32],
}

impl ValidateLogOutput {
    pub fn ok(left: u32, right: u32, events_len: u32, hash: [u8; 32]) -> Self {
        Self { fair: true, reason: None, left_score: left, right_score: right, events_len, log_hash_sha256: hash }
    }
    pub fn invalid(msg: &str) -> Self {
        Self { fair: false, reason: Some(msg.to_string()), left_score: 0, right_score: 0, events_len: 0, log_hash_sha256: [0u8; 32] }
    }
}

use sha2::{Digest, Sha256};

pub fn compute_log_hash(events: &Vec<I>) -> [u8; 32] {
    let mut h = Sha256::new();

    // Build buffer for batch hashing (more efficient with SHA-256 accelerator)
    // Version prefix: 9 bytes
    // Events: variable length
    let mut buf = Vec::with_capacity(9 + events.len() * 16);

    // Version prefix
    buf.extend_from_slice(b"PONGLOGv1");

    // Events as little-endian 16 bytes per I (i128)
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

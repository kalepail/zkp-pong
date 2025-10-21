#![allow(unused)]
use serde::{Deserialize, Serialize};
use std::vec::Vec;
use std::string::{String, ToString};

use crate::fixed::I;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ConfigInts {
    pub seed: u32,
    pub width: i32,
    pub height: i32,
    pub paddle_height: i32,
    pub paddle_width: i32,
    pub paddle_margin: i32,
    pub ball_radius: i32,
    pub paddle_max_speed: i32,
    pub serve_speed: i32,
    pub speed_increment: i32,
    pub max_bounce_angle_deg: i32,
    pub serve_max_angle_deg: i32,
    pub points_to_win: u32,
    pub micro_jitter_milli_deg: i32,
    pub ai_offset_max_permille: i32,
}

#[derive(Serialize, Deserialize)]
pub struct ValidateLogInput {
    pub config: ConfigInts,
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

pub fn compute_log_hash(cfg: &ConfigInts, events: &Vec<I>) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"PONGLOGv1");
    // Config in canonical order
    h.update(&cfg.seed.to_le_bytes());
    h.update(&cfg.width.to_le_bytes());
    h.update(&cfg.height.to_le_bytes());
    h.update(&cfg.paddle_height.to_le_bytes());
    h.update(&cfg.paddle_width.to_le_bytes());
    h.update(&cfg.paddle_margin.to_le_bytes());
    h.update(&cfg.ball_radius.to_le_bytes());
    h.update(&cfg.paddle_max_speed.to_le_bytes());
    h.update(&cfg.serve_speed.to_le_bytes());
    h.update(&cfg.speed_increment.to_le_bytes());
    h.update(&cfg.max_bounce_angle_deg.to_le_bytes());
    h.update(&cfg.serve_max_angle_deg.to_le_bytes());
    h.update(&cfg.points_to_win.to_le_bytes());
    h.update(&cfg.micro_jitter_milli_deg.to_le_bytes());
    h.update(&cfg.ai_offset_max_permille.to_le_bytes());
    // Events as little-endian 16 bytes per I (i128) - standardized for consistency
    for v in events.iter() {
        h.update(&v.to_le_bytes());
    }
    let out = h.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

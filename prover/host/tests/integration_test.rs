use methods::{GUEST_CODE_FOR_ZK_PROOF_ELF, GUEST_CODE_FOR_ZK_PROOF_ID};
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::{Deserialize, Serialize};

// Match the structures from host/src/main.rs
#[derive(Deserialize)]
struct GameConfig {
    seed: u32,
    width: i32,
    height: i32,
    #[serde(rename = "paddleHeight")]
    paddle_height: i32,
    #[serde(rename = "paddleWidth")]
    paddle_width: i32,
    #[serde(rename = "paddleMargin")]
    paddle_margin: i32,
    #[serde(rename = "ballRadius")]
    ball_radius: i32,
    #[serde(rename = "paddleMaxSpeed")]
    paddle_max_speed: i32,
    #[serde(rename = "serveSpeed")]
    serve_speed: i32,
    #[serde(rename = "speedIncrement")]
    speed_increment: i32,
    #[serde(rename = "maxBounceAngleDeg")]
    max_bounce_angle_deg: i32,
    #[serde(rename = "serveMaxAngleDeg")]
    serve_max_angle_deg: i32,
    #[serde(rename = "pointsToWin")]
    points_to_win: u32,
    #[serde(rename = "microJitterMilliDeg")]
    micro_jitter_milli_deg: i32,
    #[serde(rename = "aiOffsetMaxPermille")]
    ai_offset_max_permille: i32,
}

#[derive(Deserialize)]
struct CompactLog {
    v: u32,
    config: GameConfig,
    events: Vec<String>,
}

#[derive(Serialize, Clone)]
struct ConfigInts {
    seed: u32,
    width: i32,
    height: i32,
    paddle_height: i32,
    paddle_width: i32,
    paddle_margin: i32,
    ball_radius: i32,
    paddle_max_speed: i32,
    serve_speed: i32,
    speed_increment: i32,
    max_bounce_angle_deg: i32,
    serve_max_angle_deg: i32,
    points_to_win: u32,
    micro_jitter_milli_deg: i32,
    ai_offset_max_permille: i32,
}

#[derive(Serialize)]
struct ValidateLogInput {
    config: ConfigInts,
    events: Vec<i128>,
}

#[derive(Deserialize, Debug)]
struct ValidateLogOutput {
    fair: bool,
    reason: Option<String>,
    left_score: u32,
    right_score: u32,
    events_len: u32,
    log_hash_sha256: [u8; 32],
}

fn load_and_parse_log(path: &str) -> (ConfigInts, Vec<i128>) {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {}", path, e));

    let log: CompactLog = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path, e));

    assert_eq!(log.v, 1, "Unsupported log version: {}", log.v);

    let cfg = log.config;
    let cfg_ints = ConfigInts {
        seed: cfg.seed,
        width: cfg.width,
        height: cfg.height,
        paddle_height: cfg.paddle_height,
        paddle_width: cfg.paddle_width,
        paddle_margin: cfg.paddle_margin,
        ball_radius: cfg.ball_radius,
        paddle_max_speed: cfg.paddle_max_speed,
        serve_speed: cfg.serve_speed,
        speed_increment: cfg.speed_increment,
        max_bounce_angle_deg: cfg.max_bounce_angle_deg,
        serve_max_angle_deg: cfg.serve_max_angle_deg,
        points_to_win: cfg.points_to_win,
        micro_jitter_milli_deg: cfg.micro_jitter_milli_deg,
        ai_offset_max_permille: cfg.ai_offset_max_permille,
    };

    let events: Vec<i128> = log
        .events
        .iter()
        .map(|s| {
            s.parse::<i128>()
                .unwrap_or_else(|e| panic!("Failed to parse event '{}': {}", s, e))
        })
        .collect();

    (cfg_ints, events)
}

#[test]
fn test_valid_game_seed930397884() {
    let (config, events) = load_and_parse_log("../../pong-log_seed930397884_events49_1757552715309.json");

    let input = ValidateLogInput { config, events };

    // Build ExecutorEnv with input data
    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    // Generate proof
    let prover = default_prover();
    let prove_info = prover
        .prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF)
        .expect("Failed to generate proof");

    let receipt = prove_info.receipt;

    // Verify the receipt
    receipt
        .verify(GUEST_CODE_FOR_ZK_PROOF_ID)
        .expect("Receipt verification failed");

    // Decode and verify output
    let output: ValidateLogOutput = receipt.journal.decode().expect("Failed to decode journal");

    assert!(output.fair, "Game should be fair");
    assert_eq!(output.left_score, 3, "Expected left score 3");
    assert_eq!(output.right_score, 0, "Expected right score 0");
    assert_eq!(output.events_len, 98, "Expected 98 events");
    assert!(output.reason.is_none(), "Should not have error reason");
}

#[test]
fn test_valid_game_seed237054789() {
    let (config, events) = load_and_parse_log("../../pong-log_seed237054789_events40_1757556139973.json");

    let input = ValidateLogInput { config, events };

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
    assert_eq!(output.left_score, 0, "Expected left score 0");
    assert_eq!(output.right_score, 3, "Expected right score 3");
    assert_eq!(output.events_len, 80, "Expected 80 events");
}

#[test]
fn test_valid_game_seed725309225() {
    let (config, events) = load_and_parse_log("../../pong-log_seed725309225_events59_1761069335045.json");

    let input = ValidateLogInput { config, events };

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
    assert_eq!(output.left_score, 3, "Expected left score 3");
    assert_eq!(output.right_score, 2, "Expected right score 2");
    assert_eq!(output.events_len, 118, "Expected 118 events");
}

#[test]
fn test_invalid_config_negative_width() {
    let config = ConfigInts {
        seed: 12345,
        width: -100, // Invalid!
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 500,
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![0; 10]; // Dummy events

    let input = ValidateLogInput { config, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover
        .prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF)
        .expect("Proof should generate even for invalid config");

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair");
    assert!(output.reason.is_some(), "Should have error reason");
    assert!(
        output.reason.unwrap().contains("Width"),
        "Error should mention width"
    );
}

#[test]
fn test_invalid_config_zero_serve_speed() {
    let config = ConfigInts {
        seed: 12345,
        width: 800,
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 0, // Invalid!
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![0; 10];

    let input = ValidateLogInput { config, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair");
    assert!(
        output.reason.unwrap().contains("speed"),
        "Error should mention speed"
    );
}

#[test]
fn test_invalid_too_many_events() {
    let config = ConfigInts {
        seed: 12345,
        width: 800,
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 500,
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![0; 10002]; // Over the 10,000 limit

    let input = ValidateLogInput { config, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair");
    assert!(
        output.reason.unwrap().contains("Too many events"),
        "Error should mention too many events"
    );
}

#[test]
fn test_odd_event_count() {
    let config = ConfigInts {
        seed: 12345,
        width: 800,
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 500,
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![0; 11]; // Odd number - invalid!

    let input = ValidateLogInput { config, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    assert!(!output.fair, "Game should be unfair with odd event count");
    assert!(
        output.reason.unwrap().contains("pairs"),
        "Error should mention event pairs"
    );
}

#[test]
fn test_exactly_10000_events() {
    let config = ConfigInts {
        seed: 12345,
        width: 800,
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 500,
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![0; 10000]; // Exactly at the limit - should be OK

    let input = ValidateLogInput { config, events };

    let env = ExecutorEnv::builder()
        .write(&input)
        .unwrap()
        .build()
        .unwrap();

    let prover = default_prover();
    let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

    let receipt = prove_info.receipt;
    receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

    let output: ValidateLogOutput = receipt.journal.decode().unwrap();

    // This should fail for a different reason (invalid events content),
    // but NOT for exceeding the limit
    if !output.fair {
        assert!(
            !output.reason.as_ref().unwrap().contains("Too many events"),
            "Should not reject due to event count at exactly 10000"
        );
    }
}

#[test]
fn test_hash_determinism() {
    let config = ConfigInts {
        seed: 42,
        width: 800,
        height: 480,
        paddle_height: 80,
        paddle_width: 10,
        paddle_margin: 16,
        ball_radius: 6,
        paddle_max_speed: 200,
        serve_speed: 500,
        speed_increment: 50,
        max_bounce_angle_deg: 60,
        serve_max_angle_deg: 20,
        points_to_win: 3,
        micro_jitter_milli_deg: 800,
        ai_offset_max_permille: 600,
    };

    let events = vec![12345, 67890, 11111, 22222];

    let input = ValidateLogInput {
        config: config.clone(),
        events: events.clone(),
    };

    // Run proof twice with same inputs
    let mut hashes = Vec::new();

    for _ in 0..2 {
        let env = ExecutorEnv::builder()
            .write(&input)
            .unwrap()
            .build()
            .unwrap();

        let prover = default_prover();
        let prove_info = prover.prove(env, GUEST_CODE_FOR_ZK_PROOF_ELF).unwrap();

        let receipt = prove_info.receipt;
        receipt.verify(GUEST_CODE_FOR_ZK_PROOF_ID).unwrap();

        let output: ValidateLogOutput = receipt.journal.decode().unwrap();
        hashes.push(output.log_hash_sha256);
    }

    assert_eq!(
        hashes[0], hashes[1],
        "Hash should be deterministic - same inputs should produce same hash"
    );
}

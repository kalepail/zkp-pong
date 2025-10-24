use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpResponse, HttpServer, Responder};
use host::{generate_pong_proof, verify_pong_proof, PongProof, ReceiptKind};
use pong_core::CompactLog;
use serde::{Deserialize, Serialize};

// Request/Response types

#[derive(Deserialize)]
struct ProveRequest {
    /// The compact game log to validate
    log: CompactLog,
    /// Optional receipt format (defaults to succinct)
    #[serde(default)]
    receipt_kind: Option<ReceiptKind>,
}

#[derive(Debug, Serialize)]
struct ProveResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    proof: Option<PongProof>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    /// The proof to verify
    proof: PongProof,
}

#[derive(Debug, Serialize)]
struct VerifyResponse {
    success: bool,
    is_valid: bool,
    fair: bool,
    left_score: u32,
    right_score: u32,
    game_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// API Handlers

/// POST /api/prove
/// Generate a proof for a pong game log
async fn prove(req: web::Json<ProveRequest>) -> impl Responder {
    let receipt_kind = req.receipt_kind.unwrap_or_default();
    tracing::info!(
        "Received prove request for game: {}, receipt_kind: {}",
        req.log.game_id,
        receipt_kind
    );

    match generate_pong_proof(&req.log, receipt_kind) {
        Ok(proof) => {
            tracing::info!(
                "Successfully generated proof for game: {} (fair: {})",
                proof.game_id,
                proof.fair
            );
            HttpResponse::Ok().json(ProveResponse {
                success: true,
                proof: Some(proof),
                error: None,
            })
        }
        Err(e) => {
            tracing::error!("Failed to generate proof: {}", e);
            HttpResponse::InternalServerError().json(ProveResponse {
                success: false,
                proof: None,
                error: Some(e.to_string()),
            })
        }
    }
}

/// POST /api/verify
/// Verify a pong proof cryptographically
async fn verify(req: web::Json<VerifyRequest>) -> impl Responder {
    tracing::info!(
        "Received verify request for game: {}",
        req.proof.game_id
    );

    // Cryptographically verify the receipt
    match verify_pong_proof(&req.proof) {
        Ok(()) => {
            tracing::info!(
                "Receipt verified successfully: fair={}, game_id={}",
                req.proof.fair,
                req.proof.game_id
            );

            HttpResponse::Ok().json(VerifyResponse {
                success: true,
                is_valid: true,
                fair: req.proof.fair,
                left_score: req.proof.left_score,
                right_score: req.proof.right_score,
                game_id: req.proof.game_id,
                error: None,
            })
        }
        Err(e) => {
            tracing::error!("Receipt verification failed: {}", e);
            HttpResponse::InternalServerError().json(VerifyResponse {
                success: false,
                is_valid: false,
                fair: false,
                left_score: 0,
                right_score: 0,
                game_id: req.proof.game_id,
                error: Some(e.to_string()),
            })
        }
    }
}

/// GET /health
/// Health check endpoint
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "risc0-pong-api"
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::filter::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    tracing::info!("Starting RISC Zero Pong API Server");

    let bind_address = "0.0.0.0:8080";
    tracing::info!("Binding to {}", bind_address);

    HttpServer::new(|| {
        // Configure CORS to allow all origins
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .expose_any_header()
            .max_age(86400);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(web::JsonConfig::default().limit(10_485_760)) // 10MB limit
            .route("/health", web::get().to(health))
            .route("/api/prove", web::post().to(prove))
            .route("/api/verify", web::post().to(verify))
    })
    .bind(bind_address)?
    .run()
    .await
}

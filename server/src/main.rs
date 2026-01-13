use axum::{Json, Router, routing::get, extract::State};
use pathcollab_server::config::Config;
use pathcollab_server::overlay::overlay_routes;
use pathcollab_server::server::{AppState, ws_handler};
use serde::Serialize;
use std::net::SocketAddr;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Application start time for uptime calculation
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[derive(Serialize)]
struct MetricsResponse {
    /// Server uptime in seconds
    uptime_seconds: u64,
    /// Server version
    version: &'static str,
    /// Number of active sessions
    active_sessions: usize,
    /// Total WebSocket connections
    total_connections: usize,
}

async fn metrics(State(state): State<AppState>) -> Json<MetricsResponse> {
    let uptime = START_TIME
        .get()
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0);

    let (sessions, connections) = state.get_stats().await;

    Json(MetricsResponse {
        uptime_seconds: uptime,
        version: env!("CARGO_PKG_VERSION"),
        active_sessions: sessions,
        total_connections: connections,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Record server start time
    START_TIME.set(Instant::now()).ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "pathcollab=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration from environment
    let config = Config::from_env();
    info!("Loaded configuration: host={}, port={}", config.host, config.port);
    if config.demo.enabled {
        info!(
            "Demo mode enabled: slide_id={:?}",
            config.demo.slide_id
        );
    }

    // Create shared application state
    let app_state = AppState::new();

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build the router
    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/ws", get(ws_handler))
        .nest("/api/overlay", overlay_routes())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(app_state);

    // Start the server
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("PathCollab server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

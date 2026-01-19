use axum::{Json, Router, extract::State, response::IntoResponse, routing::get};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use pathcollab_server::SessionManager;
use pathcollab_server::config::{Config, SlideSourceMode};
use pathcollab_server::overlay::overlay_routes;
use pathcollab_server::server::{AppState, ws_handler};
use pathcollab_server::session::state::SessionConfig as SessionStateConfig;
use pathcollab_server::slide::{LocalSlideService, SlideAppState, slide_routes};
use serde::Serialize;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Application start time for uptime calculation
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// Ensure a directory exists, creating it if necessary.
/// Returns true if directory exists and is empty.
fn ensure_directory(path: &Path, name: &str) -> std::io::Result<bool> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
        info!("Created {} directory: {:?}", name, path);
        Ok(true) // newly created, so empty
    } else if path.is_dir() {
        let is_empty = path.read_dir()?.next().is_none();
        Ok(is_empty)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{} path {:?} exists but is not a directory", name, path),
        ))
    }
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    slide_service: &'static str,
    websocket: &'static str,
    uptime_seconds: u64,
}

async fn health(State(state): State<AppState>) -> (axum::http::StatusCode, Json<HealthResponse>) {
    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    // Check if slide service is operational by listing slides
    let slide_ready = if let Some(ref service) = state.slide_service {
        service.list_slides().await.is_ok()
    } else {
        false
    };

    let status = if slide_ready { "healthy" } else { "degraded" };
    let slide_status = if slide_ready { "ready" } else { "unavailable" };
    let http_status = if slide_ready {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };

    (
        http_status,
        Json(HealthResponse {
            status,
            version: env!("CARGO_PKG_VERSION"),
            slide_service: slide_status,
            websocket: "ready", // WebSocket is always ready if server is running
            uptime_seconds: uptime,
        }),
    )
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
    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    let (sessions, connections) = state.get_stats().await;

    Json(MetricsResponse {
        uptime_seconds: uptime,
        version: env!("CARGO_PKG_VERSION"),
        active_sessions: sessions,
        total_connections: connections,
    })
}

/// Prometheus metrics handle for exposing metrics in Prometheus format
static PROMETHEUS_HANDLE: std::sync::OnceLock<PrometheusHandle> = std::sync::OnceLock::new();

/// Initialize the Prometheus metrics recorder
fn setup_prometheus_metrics() -> PrometheusHandle {
    PrometheusBuilder::new()
        .install_recorder()
        .expect("Failed to install Prometheus recorder")
}

/// Endpoint to expose metrics in Prometheus format
async fn prometheus_metrics() -> impl IntoResponse {
    let handle = PROMETHEUS_HANDLE
        .get()
        .expect("Prometheus handle not initialized");
    handle.render()
}

/// Update gauge metrics for sessions and connections (called periodically)
async fn update_gauge_metrics(state: &AppState) {
    let (sessions, connections) = state.get_stats().await;

    // Update gauges using the metrics crate
    metrics::gauge!("pathcollab_sessions_active").set(sessions as f64);
    metrics::gauge!("pathcollab_ws_connections_active").set(connections as f64);

    // Uptime gauge
    let uptime = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);
    metrics::gauge!("pathcollab_uptime_seconds").set(uptime as f64);
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Record server start time
    START_TIME.set(Instant::now()).ok();

    // Initialize Prometheus metrics recorder (must be done before any metrics are recorded)
    let prometheus_handle = setup_prometheus_metrics();
    PROMETHEUS_HANDLE.set(prometheus_handle).ok();

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
    info!(
        "Loaded configuration: host={}, port={}",
        config.host, config.port
    );
    if let Some(ref base_url) = config.public_base_url {
        info!("Public base URL: {}", base_url);
    }
    if config.demo.enabled {
        info!("Demo mode enabled: slide_id={:?}", config.demo.slide_id);
    }

    // Ensure data directories exist (auto-create for dev-friendly startup)
    let slides_dir = &config.slide.slides_dir;
    match ensure_directory(slides_dir, "slides") {
        Ok(is_empty) => {
            if is_empty {
                warn!(
                    "Slides directory {:?} is empty - place WSI files here to serve them",
                    slides_dir
                );
            }
        }
        Err(e) => {
            warn!("Failed to create slides directory {:?}: {}", slides_dir, e);
        }
    }

    let overlay_cache_dir = Path::new(&config.overlay.cache_dir);
    match ensure_directory(overlay_cache_dir, "overlay cache") {
        Ok(_) => {}
        Err(e) => {
            warn!(
                "Failed to create overlay cache directory {:?}: {}",
                overlay_cache_dir, e
            );
        }
    }

    // Initialize slide service based on configuration
    let slide_service: Arc<dyn pathcollab_server::SlideService> = match config.slide.source_mode {
        SlideSourceMode::Local => {
            info!("Using local slide source: {:?}", config.slide.slides_dir);
            let service = LocalSlideService::new(&config.slide)
                .expect("Failed to initialize local slide service");
            Arc::new(service)
        }
        SlideSourceMode::WsiStreamer => {
            info!("Using WSIStreamer at: {}", config.wsistreamer_url);
            // For now, fall back to local if WsiStreamer is configured
            // TODO: Implement WsiStreamerSlideService
            info!("WsiStreamer mode not yet implemented, falling back to local");
            let service = LocalSlideService::new(&config.slide)
                .expect("Failed to initialize local slide service");
            Arc::new(service)
        }
    };

    // Ensure overlay directory exists
    let overlay_dir = &config.overlay.overlay_dir;
    match ensure_directory(overlay_dir, "overlays") {
        Ok(is_empty) => {
            if is_empty {
                warn!(
                    "Overlay directory {:?} is empty - place overlay files here (pattern: <slide_name>/overlays.bin)",
                    overlay_dir
                );
            }
        }
        Err(e) => {
            warn!("Failed to create overlay directory {:?}: {}", overlay_dir, e);
        }
    }

    // Create slide app state for HTTP routes
    let slide_app_state = SlideAppState {
        slide_service: slide_service.clone(),
        overlay_dir: config.overlay.overlay_dir.clone(),
    };

    // Create shared application state with session config, slide service, and public base URL
    let session_config = SessionStateConfig {
        max_duration: config.session.max_duration,
        presenter_grace_period: config.session.presenter_grace_period,
        max_followers: config.session.max_followers,
    };
    let session_manager = Arc::new(SessionManager::with_config(session_config));

    let app_state = AppState::new()
        .with_session_manager(session_manager)
        .with_slide_service(slide_service)
        .with_public_base_url(config.public_base_url.clone())
        .with_overlay_dir(config.overlay.overlay_dir.clone());

    // Periodic cleanup for expired sessions
    let cleanup_state = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_state.session_manager.cleanup_expired().await;
        }
    });

    // Periodic update of gauge metrics (every 5 seconds)
    let metrics_state = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            update_gauge_metrics(&metrics_state).await;
        }
    });

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build slide API routes (separate state, merged as nested service)
    let slide_api = slide_routes(slide_app_state);

    // Build the router with multiple state types
    // The slide routes have their own state, so we nest them before adding AppState
    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/metrics/prometheus", get(prometheus_metrics))
        .route("/ws", get(ws_handler))
        .nest("/api/overlay", overlay_routes())
        .with_state(app_state)
        // Merge slide routes after setting AppState (slide routes have their own state)
        .merge(Router::new().nest("/api", slide_api))
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    // Add static file serving if configured (for unified Docker image)
    let app = if let Some(ref static_dir) = config.static_files.dir {
        if static_dir.exists() {
            info!("Serving static files from: {:?}", static_dir);

            // ServeDir with SPA fallback: serve index.html for any unmatched routes
            let index_path = static_dir.join("index.html");
            let serve_dir =
                ServeDir::new(static_dir).not_found_service(ServeFile::new(&index_path));

            // Add compression layer for static files (gzip)
            let static_service = ServiceBuilder::new()
                .layer(CompressionLayer::new())
                .service(serve_dir);

            app.fallback_service(static_service)
        } else {
            warn!(
                "Static files directory not found: {:?} - static file serving disabled",
                static_dir
            );
            app
        }
    } else {
        info!("Static file serving disabled (STATIC_FILES_DIR not set)");
        app
    };

    // Start the server
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!("PathCollab server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

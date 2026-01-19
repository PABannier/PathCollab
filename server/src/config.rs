//! Server configuration
//!
//! Configuration is loaded from environment variables. See `.env.example` for documentation.
//!
//! # Canonical Ports
//!
//! PathCollab uses the following canonical ports (do not change without updating all config files):
//! - **3000**: Frontend (Vite dev server / Nginx production)
//! - **8080**: Backend (this Rust Axum server)
//! - **3001**: WSIStreamer (DEPRECATED: will be replaced by LocalSlideService)
//!
//! See also: `docker-compose.yml`, `README.md`, `.env.example`, `web/vite.config.ts`

use std::env;
use std::path::PathBuf;
use std::time::Duration;

/// Main server configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// Server bind address
    pub host: String,
    /// Server port
    pub port: u16,
    /// Public base URL for link generation (optional)
    pub public_base_url: Option<String>,
    /// Whether server is behind a reverse proxy
    pub behind_proxy: bool,

    /// WSIStreamer URL
    pub wsistreamer_url: String,

    /// Session configuration
    pub session: SessionConfig,

    /// Presence configuration
    pub presence: PresenceConfig,

    /// Demo configuration
    pub demo: DemoConfig,

    /// Slide configuration
    pub slide: SlideConfig,

    /// Static file serving configuration
    pub static_files: StaticFilesConfig,
}

/// Session-related configuration
#[derive(Debug, Clone)]
pub struct SessionConfig {
    /// Maximum number of followers per session
    pub max_followers: usize,
    /// Maximum concurrent sessions
    pub max_concurrent_sessions: usize,
    /// Session maximum duration
    pub max_duration: Duration,
    /// Grace period after presenter disconnects
    pub presenter_grace_period: Duration,
}

/// Presence-related configuration
#[derive(Debug, Clone)]
pub struct PresenceConfig {
    /// Cursor broadcast frequency in Hz
    pub cursor_broadcast_hz: u32,
    /// Viewport broadcast frequency in Hz
    pub viewport_broadcast_hz: u32,
}

/// Demo mode configuration
#[derive(Debug, Clone, Default)]
pub struct DemoConfig {
    /// Whether demo mode is enabled
    pub enabled: bool,
    /// Demo slide ID
    pub slide_id: Option<String>,
}

/// Slide source mode
#[derive(Debug, Clone, PartialEq, Default)]
pub enum SlideSourceMode {
    /// Use local OpenSlide to read slide files (recommended)
    #[default]
    Local,
    /// Use external WSIStreamer service (DEPRECATED - falls back to Local)
    WsiStreamer,
}

/// Static file serving configuration
#[derive(Debug, Clone)]
pub struct StaticFilesConfig {
    /// Directory containing static files (frontend build)
    /// If None, static file serving is disabled
    pub dir: Option<PathBuf>,
    /// Enable gzip compression for static files
    pub compression: bool,
    /// Cache duration for immutable assets (hashed files) in seconds
    pub cache_max_age: u64,
}

impl Default for StaticFilesConfig {
    fn default() -> Self {
        Self {
            dir: None, // Disabled by default in dev mode
            compression: true,
            cache_max_age: 31536000, // 1 year for hashed assets
        }
    }
}

/// Slide-related configuration
#[derive(Debug, Clone)]
pub struct SlideConfig {
    /// Slide source mode
    pub source_mode: SlideSourceMode,
    /// Directory containing slide files (for local mode)
    pub slides_dir: PathBuf,
    /// Tile size for serving
    pub tile_size: u32,
    /// JPEG quality for tile encoding (1-100)
    pub jpeg_quality: u8,
    /// Maximum number of cached slide handles
    pub max_cached_slides: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 8080,
            public_base_url: None,
            behind_proxy: false,
            wsistreamer_url: "http://wsistreamer:3000".to_string(),
            session: SessionConfig::default(),
            presence: PresenceConfig::default(),
            demo: DemoConfig::default(),
            slide: SlideConfig::default(),
            static_files: StaticFilesConfig::default(),
        }
    }
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            max_followers: 20,
            max_concurrent_sessions: 50,
            max_duration: Duration::from_secs(4 * 60 * 60), // 4 hours
            presenter_grace_period: Duration::from_secs(30),
        }
    }
}

impl Default for PresenceConfig {
    fn default() -> Self {
        Self {
            cursor_broadcast_hz: 30,
            viewport_broadcast_hz: 10,
        }
    }
}

impl Default for SlideConfig {
    fn default() -> Self {
        Self {
            source_mode: SlideSourceMode::default(),
            // Use relative path for dev-friendly defaults (auto-created if missing)
            slides_dir: PathBuf::from("./data/slides"),
            tile_size: 256,
            jpeg_quality: 85,
            max_cached_slides: 10,
        }
    }
}

impl Config {
    /// Load configuration from environment variables
    #[allow(clippy::collapsible_if)]
    pub fn from_env() -> Self {
        let mut config = Self::default();

        // Server config
        if let Ok(host) = env::var("HOST") {
            config.host = host;
        }
        if let Ok(port) = env::var("PORT") {
            if let Ok(p) = port.parse() {
                config.port = p;
            }
        }
        if let Ok(url) = env::var("PUBLIC_BASE_URL") {
            if !url.is_empty() {
                config.public_base_url = Some(url);
            }
        }
        if let Ok(val) = env::var("BEHIND_PROXY") {
            config.behind_proxy = val.to_lowercase() == "true" || val == "1";
        }

        // WSIStreamer config
        if let Ok(url) = env::var("WSISTREAMER_URL") {
            config.wsistreamer_url = url;
        }

        // Session config
        if let Ok(val) = env::var("MAX_FOLLOWERS") {
            if let Ok(v) = val.parse() {
                config.session.max_followers = v;
            }
        }
        if let Ok(val) = env::var("MAX_CONCURRENT_SESSIONS") {
            if let Ok(v) = val.parse() {
                config.session.max_concurrent_sessions = v;
            }
        }
        if let Ok(val) = env::var("SESSION_MAX_DURATION_HOURS") {
            if let Ok(hours) = val.parse::<u64>() {
                config.session.max_duration = Duration::from_secs(hours * 60 * 60);
            }
        }
        if let Ok(val) = env::var("PRESENTER_GRACE_PERIOD_SECS") {
            if let Ok(secs) = val.parse::<u64>() {
                config.session.presenter_grace_period = Duration::from_secs(secs);
            }
        }

        // Presence config
        if let Ok(val) = env::var("CURSOR_BROADCAST_HZ") {
            if let Ok(hz) = val.parse() {
                config.presence.cursor_broadcast_hz = hz;
            }
        }
        if let Ok(val) = env::var("VIEWPORT_BROADCAST_HZ") {
            if let Ok(hz) = val.parse() {
                config.presence.viewport_broadcast_hz = hz;
            }
        }

        // Demo config
        if let Ok(val) = env::var("DEMO_ENABLED") {
            config.demo.enabled = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(id) = env::var("DEMO_SLIDE_ID") {
            if !id.is_empty() {
                config.demo.slide_id = Some(id);
            }
        }

        // Slide config
        if let Ok(val) = env::var("SLIDE_SOURCE") {
            config.slide.source_mode = match val.to_lowercase().as_str() {
                "local" => SlideSourceMode::Local,
                "wsistreamer" | "wsi_streamer" => SlideSourceMode::WsiStreamer,
                _ => SlideSourceMode::WsiStreamer,
            };
        }
        if let Ok(path) = env::var("SLIDES_DIR") {
            config.slide.slides_dir = PathBuf::from(path);
        }
        if let Ok(val) = env::var("SLIDE_TILE_SIZE") {
            if let Ok(size) = val.parse() {
                config.slide.tile_size = size;
            }
        }
        if let Ok(val) = env::var("SLIDE_JPEG_QUALITY") {
            if let Ok(quality) = val.parse::<u8>() {
                config.slide.jpeg_quality = quality.clamp(1, 100);
            }
        }
        if let Ok(val) = env::var("SLIDE_CACHE_SIZE") {
            if let Ok(size) = val.parse() {
                config.slide.max_cached_slides = size;
            }
        }

        // Static files config
        if let Ok(path) = env::var("STATIC_FILES_DIR") {
            if !path.is_empty() {
                config.static_files.dir = Some(PathBuf::from(path));
            }
        }
        if let Ok(val) = env::var("STATIC_FILES_COMPRESSION") {
            config.static_files.compression = val.to_lowercase() == "true" || val == "1";
        }

        config
    }
}

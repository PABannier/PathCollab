//! Server configuration
//!
//! Configuration is loaded from environment variables. See `.env.example` for documentation.

use std::env;
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

    /// Overlay configuration
    pub overlay: OverlayConfig,

    /// Presence configuration
    pub presence: PresenceConfig,

    /// Demo configuration
    pub demo: DemoConfig,
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

/// Overlay-related configuration
#[derive(Debug, Clone)]
pub struct OverlayConfig {
    /// Maximum upload size in bytes
    pub max_upload_size: usize,
    /// Upload timeout
    pub upload_timeout: Duration,
    /// Cache directory path
    pub cache_dir: String,
    /// Maximum cache size in bytes
    pub cache_max_size: usize,
    /// Tile size for rendering
    pub tile_size: u32,
    /// Maximum concurrent processing jobs
    pub max_jobs: usize,
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
    /// Path to demo overlay file
    pub overlay_path: Option<String>,
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
            overlay: OverlayConfig::default(),
            presence: PresenceConfig::default(),
            demo: DemoConfig::default(),
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

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            max_upload_size: 500 * 1024 * 1024, // 500 MB
            upload_timeout: Duration::from_secs(300),
            cache_dir: "/var/lib/pathcollab/overlays".to_string(),
            cache_max_size: 50 * 1024 * 1024 * 1024, // 50 GB
            tile_size: 256,
            max_jobs: 2,
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

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Self {
        let mut config = Self::default();

        // Server config
        if let Ok(host) = env::var("HOST") {
            config.host = host;
        }
        if let Ok(port) = env::var("PORT")
            && let Ok(p) = port.parse()
        {
            config.port = p;
        }
        if let Ok(url) = env::var("PUBLIC_BASE_URL")
            && !url.is_empty()
        {
            config.public_base_url = Some(url);
        }
        if let Ok(val) = env::var("BEHIND_PROXY") {
            config.behind_proxy = val.to_lowercase() == "true" || val == "1";
        }

        // WSIStreamer config
        if let Ok(url) = env::var("WSISTREAMER_URL") {
            config.wsistreamer_url = url;
        }

        // Session config
        if let Ok(val) = env::var("MAX_FOLLOWERS")
            && let Ok(v) = val.parse()
        {
            config.session.max_followers = v;
        }
        if let Ok(val) = env::var("MAX_CONCURRENT_SESSIONS")
            && let Ok(v) = val.parse()
        {
            config.session.max_concurrent_sessions = v;
        }
        if let Ok(val) = env::var("SESSION_MAX_DURATION_HOURS")
            && let Ok(hours) = val.parse::<u64>()
        {
            config.session.max_duration = Duration::from_secs(hours * 60 * 60);
        }
        if let Ok(val) = env::var("PRESENTER_GRACE_PERIOD_SECS")
            && let Ok(secs) = val.parse::<u64>()
        {
            config.session.presenter_grace_period = Duration::from_secs(secs);
        }

        // Overlay config
        if let Ok(val) = env::var("OVERLAY_MAX_SIZE_MB")
            && let Ok(mb) = val.parse::<usize>()
        {
            config.overlay.max_upload_size = mb * 1024 * 1024;
        }
        if let Ok(val) = env::var("OVERLAY_UPLOAD_TIMEOUT_SECS")
            && let Ok(secs) = val.parse::<u64>()
        {
            config.overlay.upload_timeout = Duration::from_secs(secs);
        }
        if let Ok(path) = env::var("OVERLAY_CACHE_DIR") {
            config.overlay.cache_dir = path;
        }
        if let Ok(val) = env::var("OVERLAY_CACHE_MAX_GB")
            && let Ok(gb) = val.parse::<usize>()
        {
            config.overlay.cache_max_size = gb * 1024 * 1024 * 1024;
        }
        if let Ok(val) = env::var("TILE_SIZE")
            && let Ok(size) = val.parse()
        {
            config.overlay.tile_size = size;
        }
        if let Ok(val) = env::var("OVERLAY_MAX_JOBS")
            && let Ok(jobs) = val.parse()
        {
            config.overlay.max_jobs = jobs;
        }

        // Presence config
        if let Ok(val) = env::var("CURSOR_BROADCAST_HZ")
            && let Ok(hz) = val.parse()
        {
            config.presence.cursor_broadcast_hz = hz;
        }
        if let Ok(val) = env::var("VIEWPORT_BROADCAST_HZ")
            && let Ok(hz) = val.parse()
        {
            config.presence.viewport_broadcast_hz = hz;
        }

        // Demo config
        if let Ok(val) = env::var("DEMO_ENABLED") {
            config.demo.enabled = val.to_lowercase() == "true" || val == "1";
        }
        if let Ok(id) = env::var("DEMO_SLIDE_ID")
            && !id.is_empty()
        {
            config.demo.slide_id = Some(id);
        }
        if let Ok(path) = env::var("DEMO_OVERLAY_PATH")
            && !path.is_empty()
        {
            config.demo.overlay_path = Some(path);
        }

        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert_eq!(config.session.max_followers, 20);
        assert!(!config.demo.enabled);
    }

    #[test]
    fn test_config_from_env() {
        // This test doesn't set env vars, so it should return defaults
        let config = Config::from_env();
        assert_eq!(config.host, "0.0.0.0");
    }
}

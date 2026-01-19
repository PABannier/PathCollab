//! PathCollab Server Library
//!
//! This module exports the server components for use in integration tests
//! and external tooling.

pub mod config;
pub mod overlay;
pub mod protocol;
pub mod server;
pub mod session;
pub mod slide;

// Re-export commonly used types
pub use config::Config;
pub use overlay::{
    LocalOverlayService, OverlayAppState, OverlayError, OverlayMetadata, OverlayService,
    overlay_routes,
};
pub use protocol::{ClientMessage, ServerMessage};
pub use server::AppState;
pub use session::manager::SessionManager;
pub use slide::{
    LocalSlideService, SlideAppState, SlideError, SlideMetadata, SlideService, TileRequest,
    slide_routes,
};

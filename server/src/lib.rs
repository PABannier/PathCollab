//! PathCollab Server Library
//!
//! This module exports the server components for use in integration tests
//! and external tooling.

pub mod overlay;
pub mod protocol;
pub mod server;
pub mod session;

// Re-export commonly used types
pub use overlay::overlay_routes;
pub use protocol::{ClientMessage, ServerMessage};
pub use server::AppState;
pub use session::manager::SessionManager;

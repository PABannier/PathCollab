//! Load test scenarios
//!
//! Single comprehensive benchmark that tests all hot paths:
//! - WebSocket cursor/viewport broadcasts
//! - HTTP tile serving
//! - HTTP overlay requests

pub mod comprehensive;

pub use comprehensive::{ComprehensiveStressConfig, ComprehensiveStressScenario};

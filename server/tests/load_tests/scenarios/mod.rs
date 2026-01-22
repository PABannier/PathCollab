//! Load test scenarios
//!
//! The primary benchmark system uses `ComprehensiveStressScenario` with
//! tiered configurations (Smoke, Standard, Stress).
//!
//! Other scenarios are kept for specialized testing:
//! - `fanout`: WebSocket fan-out testing
//! - `overlay`: Cell overlay stress testing

pub mod comprehensive;
pub mod fanout;
pub mod overlay;

pub use comprehensive::{ComprehensiveStressConfig, ComprehensiveStressScenario};

//! Slide catalog module.
//!
//! This module provides:
//! - `SlideService` trait for the slide catalog (list + metadata)
//! - `LocalSlideService` reading slide metadata locally with OpenSlide
//! - HTTP routes for slide listing and metadata
//!
//! Rendering tiles are served by the fovea forwarder (`crate::fovea`), not here.

mod cache;
mod local;
pub mod routes;
mod service;
mod types;

pub use local::LocalSlideService;
pub use routes::{SlideAppState, slide_routes};
pub use service::SlideService;
pub use types::{SlideError, SlideListItem, SlideMetadata};

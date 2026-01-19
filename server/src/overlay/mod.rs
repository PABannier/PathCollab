//! Overlay service module for reading cell mask annotations
//!
//! This module provides:
//! - `OverlayService` trait for abstracting overlay sources
//! - `LocalOverlayService` for reading overlay files locally
//! - HTTP routes for serving overlay data
//! - Spatial indexing for efficient region queries

mod index;
mod local;
mod reader;
pub mod routes;
mod service;
mod types;

pub use local::LocalOverlayService;
pub use routes::{OverlayAppState, overlay_routes};
pub use service::OverlayService;
pub use types::{CellMask, OverlayError, OverlayMetadata, Point, RegionRequest};

// Include generated protobuf code
pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/histotyper.rs"));
}

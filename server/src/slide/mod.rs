//! Slide service module for reading whole-slide images
//!
//! This module provides:
//! - `SlideService` trait for abstracting slide sources
//! - `LocalSlideService` for reading slides locally with OpenSlide
//! - HTTP routes for serving slide metadata and tiles
//! - `TileCache` for caching encoded JPEG tile bytes

mod cache;
mod local;
pub mod routes;
mod service;
mod tile_cache;
mod types;

pub use local::LocalSlideService;
pub use routes::{SlideAppState, slide_routes};
pub use service::SlideService;
pub use types::{SlideError, SlideListItem, SlideMetadata, TileRequest};

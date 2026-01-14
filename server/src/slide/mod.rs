//! Slide service module for reading whole-slide images
//!
//! This module provides:
//! - `SlideService` trait for abstracting slide sources
//! - `LocalSlideService` for reading slides locally with OpenSlide
//! - HTTP routes for serving slide metadata and tiles

mod cache;
mod local;
pub mod routes;
mod service;
mod types;

pub use local::LocalSlideService;
pub use routes::{slide_routes, SlideAppState};
pub use service::SlideService;
pub use types::{SlideError, SlideListItem, SlideMetadata, TileRequest};

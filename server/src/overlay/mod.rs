//! Overlay processing module
//!
//! Handles parsing, indexing, and serving of cell/tissue overlay data.

pub mod derive;
pub mod discovery;
pub mod index;
pub mod parser;
pub mod routes;
pub mod types;

pub use derive::{DerivePipeline, DerivedOverlay};
pub use discovery::{check_overlay_exists, discover_all_overlays, get_overlay_path, OverlayInfo};
pub use index::TileBinIndex;
pub use parser::OverlayParser;
pub use routes::overlay_routes;
pub use types::{OverlayError, ParsedOverlay};

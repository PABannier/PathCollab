//! Overlay processing module
//!
//! Handles parsing, indexing, and serving of cell/tissue overlay data.

pub mod derive;
pub mod index;
pub mod parser;
pub mod types;

pub use derive::{DerivePipeline, DerivedOverlay};
pub use index::TileBinIndex;
pub use parser::OverlayParser;
pub use types::{OverlayError, ParsedOverlay};

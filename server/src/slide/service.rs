//! SlideService trait definition

use async_trait::async_trait;
use bytes::Bytes;

use super::types::{SlideError, SlideMetadata, TileRequest};

/// Trait for slide services (local OpenSlide or external WSIStreamer)
#[async_trait]
pub trait SlideService: Send + Sync {
    /// List all available slides
    async fn list_slides(&self) -> Result<Vec<SlideMetadata>, SlideError>;

    /// Get metadata for a specific slide
    async fn get_slide(&self, id: &str) -> Result<SlideMetadata, SlideError>;

    /// Get a tile as JPEG bytes
    async fn get_tile(&self, request: &TileRequest) -> Result<Bytes, SlideError>;

    /// Check if a slide exists
    async fn slide_exists(&self, id: &str) -> bool {
        self.get_slide(id).await.is_ok()
    }
}

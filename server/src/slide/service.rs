//! SlideService trait definition

use async_trait::async_trait;

use super::types::{SlideError, SlideMetadata};

/// Trait for slide services (local OpenSlide catalog). Rendering tiles are served
/// separately by the fovea forwarder; this trait covers only the slide catalog.
#[async_trait]
pub trait SlideService: Send + Sync {
    /// List all available slides
    async fn list_slides(&self) -> Result<Vec<SlideMetadata>, SlideError>;

    /// Get metadata for a specific slide
    async fn get_slide(&self, id: &str) -> Result<SlideMetadata, SlideError>;

    /// Check if a slide exists
    async fn slide_exists(&self, id: &str) -> bool {
        self.get_slide(id).await.is_ok()
    }
}

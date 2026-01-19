//! OverlayService trait definition

use async_trait::async_trait;

use super::types::{CellMask, OverlayError, OverlayMetadata, RegionRequest};

/// Trait for overlay services
#[async_trait]
pub trait OverlayService: Send + Sync {
    /// List overlays available for a slide
    async fn list_overlays(&self, slide_id: &str) -> Result<Vec<OverlayMetadata>, OverlayError>;

    /// Get cells within a region
    async fn get_cells_in_region(
        &self,
        request: &RegionRequest,
    ) -> Result<Vec<CellMask>, OverlayError>;

    /// Get overlay metadata for a slide
    async fn get_overlay_metadata(&self, slide_id: &str) -> Result<OverlayMetadata, OverlayError>;

    /// Check if overlay exists for a slide
    async fn overlay_exists(&self, slide_id: &str) -> bool {
        self.get_overlay_metadata(slide_id).await.is_ok()
    }
}

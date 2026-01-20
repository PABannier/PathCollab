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

    /// Check overlay status: (file_exists, is_ready)
    /// Returns (true, true) if overlay is loaded and ready
    /// Returns (true, false) if overlay file exists but is still loading
    /// Returns (false, false) if no overlay file exists
    async fn get_overlay_status(&self, slide_id: &str) -> (bool, bool);

    /// Initiate background loading for an overlay
    /// This is a non-blocking call that starts loading in the background
    async fn initiate_load(&self, slide_id: &str);
}

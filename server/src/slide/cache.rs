//! Thread-safe slide handle cache with LRU eviction

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use openslide_rs::OpenSlide;
use tokio::sync::RwLock;
use tracing::{debug, warn};

use super::types::{SlideError, SlideMetadata};

/// Thread-safe cache for OpenSlide handles
pub struct SlideCache {
    /// Cached slide handles
    slides: RwLock<HashMap<String, Arc<OpenSlide>>>,
    /// Cached slide metadata
    metadata: RwLock<HashMap<String, SlideMetadata>>,
    /// Maximum number of cached slides
    max_size: usize,
    /// Access order for LRU eviction (most recent at end)
    access_order: RwLock<Vec<String>>,
}

impl SlideCache {
    /// Create a new slide cache with the given maximum size
    pub fn new(max_size: usize) -> Self {
        Self {
            slides: RwLock::new(HashMap::new()),
            metadata: RwLock::new(HashMap::new()),
            max_size,
            access_order: RwLock::new(Vec::new()),
        }
    }

    /// Get or open a slide, caching the handle
    pub async fn get_or_open(&self, id: &str, path: &Path) -> Result<Arc<OpenSlide>, SlideError> {
        // Check cache first
        {
            let slides = self.slides.read().await;
            if let Some(slide) = slides.get(id) {
                // Update access order
                self.update_access_order(id).await;
                return Ok(Arc::clone(slide));
            }
        }

        // Open the slide
        debug!("Opening slide: {} at {:?}", id, path);
        let slide = OpenSlide::new(path)
            .map_err(|e| SlideError::OpenError(format!("Failed to open {:?}: {}", path, e)))?;
        let slide = Arc::new(slide);

        // Insert into cache
        {
            let mut slides = self.slides.write().await;

            // Evict LRU if needed
            if slides.len() >= self.max_size {
                self.evict_lru().await;
            }

            slides.insert(id.to_string(), Arc::clone(&slide));
        }

        // Update access order
        self.update_access_order(id).await;

        Ok(slide)
    }

    /// Get cached metadata for a slide
    pub async fn get_metadata(&self, id: &str) -> Option<SlideMetadata> {
        let metadata = self.metadata.read().await;
        metadata.get(id).cloned()
    }

    /// Set metadata for a slide
    pub async fn set_metadata(&self, id: &str, meta: SlideMetadata) {
        let mut metadata = self.metadata.write().await;
        metadata.insert(id.to_string(), meta);
    }

    /// Update access order for LRU tracking
    async fn update_access_order(&self, id: &str) {
        let mut order = self.access_order.write().await;
        // Remove if exists
        if let Some(pos) = order.iter().position(|x| x == id) {
            order.remove(pos);
        }
        // Add to end (most recent)
        order.push(id.to_string());
    }

    /// Evict the least recently used slide
    async fn evict_lru(&self) {
        let mut order = self.access_order.write().await;
        if let Some(lru_id) = order.first().cloned() {
            order.remove(0);
            drop(order);

            let mut slides = self.slides.write().await;
            if slides.remove(&lru_id).is_some() {
                debug!("Evicted slide from cache: {}", lru_id);
            }

            // Also remove metadata
            let mut metadata = self.metadata.write().await;
            metadata.remove(&lru_id);
        }
    }

    /// Clear all cached slides
    #[allow(dead_code)]
    pub async fn clear(&self) {
        let mut slides = self.slides.write().await;
        let mut metadata = self.metadata.write().await;
        let mut order = self.access_order.write().await;

        slides.clear();
        metadata.clear();
        order.clear();

        warn!("Slide cache cleared");
    }

    /// Get the number of cached slides
    #[allow(dead_code)]
    pub async fn len(&self) -> usize {
        let slides = self.slides.read().await;
        slides.len()
    }
}

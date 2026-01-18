//! Thread-safe slide handle cache with LRU eviction

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use openslide_rs::OpenSlide;
use tokio::sync::RwLock;
use tracing::debug;

use super::types::{SlideError, SlideMetadata};

/// Thread-safe cache for OpenSlide handles
pub struct SlideCache {
    /// Cached slide handles
    slides: RwLock<HashMap<String, Arc<OpenSlide>>>,
    /// Cached slide metadata
    metadata: RwLock<HashMap<String, SlideMetadata>>,
    /// Cached slide paths (id -> path) - avoids directory scan on every request
    paths: RwLock<HashMap<String, PathBuf>>,
    /// Maximum number of cached slides
    max_size: usize,
    /// Access order for LRU eviction using HashMap for O(1) lookup + VecDeque for order
    /// Key: slide_id, Value: position in access_queue
    access_map: RwLock<HashMap<String, u64>>,
    /// Monotonically increasing counter for access timestamps
    access_counter: RwLock<u64>,
}

impl SlideCache {
    /// Create a new slide cache with the given maximum size
    pub fn new(max_size: usize) -> Self {
        Self {
            slides: RwLock::new(HashMap::new()),
            metadata: RwLock::new(HashMap::new()),
            paths: RwLock::new(HashMap::new()),
            max_size,
            access_map: RwLock::new(HashMap::new()),
            access_counter: RwLock::new(0),
        }
    }

    /// Get a cached path for a slide ID
    pub async fn get_path(&self, id: &str) -> Option<PathBuf> {
        let paths = self.paths.read().await;
        paths.get(id).cloned()
    }

    /// Set multiple paths at once (for batch initialization from directory scan)
    pub async fn set_paths(&self, new_paths: HashMap<String, PathBuf>) {
        let mut paths = self.paths.write().await;
        paths.extend(new_paths);
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

    /// Get a cached slide handle without requiring a path
    /// Returns None if the slide is not in cache
    pub async fn get_cached(&self, id: &str) -> Option<Arc<OpenSlide>> {
        let slide = {
            let slides = self.slides.read().await;
            slides.get(id).map(Arc::clone)
        };
        if slide.is_some() {
            self.update_access_order(id).await;
        }
        slide
    }

    /// Set metadata for a slide
    pub async fn set_metadata(&self, id: &str, meta: SlideMetadata) {
        let mut metadata = self.metadata.write().await;
        metadata.insert(id.to_string(), meta);
    }

    /// Update access order for LRU tracking
    async fn update_access_order(&self, id: &str) {
        let mut counter = self.access_counter.write().await;
        *counter += 1;
        let timestamp = *counter;
        drop(counter);

        let mut access_map = self.access_map.write().await;
        access_map.insert(id.to_string(), timestamp);
    }

    /// Evict the least recently used slide
    async fn evict_lru(&self) {
        let lru_id = {
            let access_map = self.access_map.read().await;
            access_map
                .iter()
                .min_by_key(|(_, ts)| *ts)
                .map(|(id, _)| id.clone())
        };

        if let Some(lru_id) = lru_id {
            // Remove from access_map
            {
                let mut access_map = self.access_map.write().await;
                access_map.remove(&lru_id);
            }

            // Remove from slides
            let mut slides = self.slides.write().await;
            if slides.remove(&lru_id).is_some() {
                debug!("Evicted slide from cache: {}", lru_id);
            }

            // Also remove metadata
            let mut metadata = self.metadata.write().await;
            metadata.remove(&lru_id);
        }
    }
}

//! Thread-safe slide handle cache with LRU eviction

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use indexmap::IndexMap;
use openslide_rs::OpenSlide;
use tokio::sync::RwLock;
use tracing::debug;

use super::types::{SlideError, SlideMetadata};

const SLIDE_LIST_CACHE_TTL: Duration = Duration::from_secs(30);

/// Cached slide list with timestamp
struct SlideListCache {
    /// List of (id, path) pairs
    slides: Vec<(String, PathBuf)>,
    /// When this cache was populated
    cached_at: Instant,
}

/// Thread-safe cache for OpenSlide handles with O(1) LRU tracking
///
/// Uses IndexMap which maintains insertion order and provides O(1) access/removal.
/// When an item is accessed, we remove and re-insert it to move it to the end (most recent).
///
/// The metadata cache uses DashMap for lock-free concurrent reads, since metadata
/// is checked on every tile request but rarely written.
pub struct SlideCache {
    /// Cached slide handles with LRU ordering (most recent at end)
    slides: RwLock<IndexMap<String, Arc<OpenSlide>>>,
    /// Cached slide metadata
    metadata: DashMap<String, SlideMetadata>,
    /// Maximum number of cached slides
    max_size: usize,
    /// Cached slide list (avoids repeated directory scans)
    slide_list_cache: RwLock<Option<SlideListCache>>,
}

impl SlideCache {
    /// Create a new slide cache with the given maximum size
    pub fn new(max_size: usize) -> Self {
        Self {
            slides: RwLock::new(IndexMap::with_capacity(max_size)),
            metadata: DashMap::new(),
            max_size,
            slide_list_cache: RwLock::new(None),
        }
    }

    /// Get or open a slide, caching the handle
    pub async fn get_or_open(&self, id: &str, path: &Path) -> Result<Arc<OpenSlide>, SlideError> {
        // Check cache first and update access order (move to end)
        {
            let mut slides = self.slides.write().await;
            if let Some(slide) = slides.shift_remove(id) {
                // Re-insert at end to update LRU order (O(1) operation)
                let slide_clone = Arc::clone(&slide);
                slides.insert(id.to_string(), slide);
                return Ok(slide_clone);
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

            // Evict LRU if needed (first item is oldest)
            if slides.len() >= self.max_size {
                if let Some((lru_id, _)) = slides.shift_remove_index(0) {
                    debug!("Evicted slide from cache: {}", lru_id);
                    // Also remove metadata
                    self.metadata.remove(&lru_id);
                }
            }

            slides.insert(id.to_string(), Arc::clone(&slide));
        }

        Ok(slide)
    }

    /// Get cached metadata for a slide
    pub fn get_metadata(&self, id: &str) -> Option<SlideMetadata> {
        self.metadata.get(id).map(|r| r.value().clone())
    }

    /// Get a cached slide handle without requiring a path
    /// Returns None if the slide is not in cache
    pub async fn get_cached(&self, id: &str) -> Option<Arc<OpenSlide>> {
        let mut slides = self.slides.write().await;
        // Remove and re-insert to update LRU order
        if let Some(slide) = slides.shift_remove(id) {
            let slide_clone = Arc::clone(&slide);
            slides.insert(id.to_string(), slide);
            Some(slide_clone)
        } else {
            None
        }
    }

    /// Set metadata for a slide
    pub fn set_metadata(&self, id: &str, meta: SlideMetadata) {
        self.metadata.insert(id.to_string(), meta);
    }

    /// Get the cached slide list if still valid, or None if expired/empty
    pub async fn get_slide_list(&self) -> Option<Vec<(String, PathBuf)>> {
        let cache = self.slide_list_cache.read().await;
        if let Some(ref list_cache) = *cache {
            if list_cache.cached_at.elapsed() < SLIDE_LIST_CACHE_TTL {
                return Some(list_cache.slides.clone());
            }
        }
        None
    }

    /// Set the cached slide list
    pub async fn set_slide_list(&self, slides: Vec<(String, PathBuf)>) {
        let mut cache = self.slide_list_cache.write().await;
        *cache = Some(SlideListCache {
            slides,
            cached_at: Instant::now(),
        });
    }
}

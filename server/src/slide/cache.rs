//! Thread-safe slide handle cache with LRU eviction

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use indexmap::IndexMap;
use openslide_rs::OpenSlide;
use tokio::sync::RwLock;
use tracing::debug;

use super::types::{SlideError, SlideMetadata};

const SLIDE_LIST_CACHE_TTL: Duration = Duration::from_secs(30);

/// Counter for probabilistic LRU updates - update every N accesses
const LRU_UPDATE_FREQUENCY: u64 = 8;

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
///
/// Performance optimizations:
/// - Read-first approach: check cache with read lock before taking write lock
/// - Probabilistic LRU updates: only update LRU position 1 in N times to reduce contention
/// - Arc<SlideMetadata> for cheap cloning on cache hits
pub struct SlideCache {
    /// Cached slide handles with LRU ordering (most recent at end)
    slides: RwLock<IndexMap<String, Arc<OpenSlide>>>,
    /// Cached slide metadata
    metadata: DashMap<String, Arc<SlideMetadata>>,
    /// Maximum number of cached slides
    max_size: usize,
    /// Cached slide list (avoids repeated directory scans)
    slide_list_cache: RwLock<Option<SlideListCache>>,
    /// Counter for probabilistic LRU updates
    access_counter: AtomicU64,
}

impl SlideCache {
    /// Create a new slide cache with the given maximum size
    pub fn new(max_size: usize) -> Self {
        Self {
            slides: RwLock::new(IndexMap::with_capacity(max_size)),
            metadata: DashMap::new(),
            max_size,
            slide_list_cache: RwLock::new(None),
            access_counter: AtomicU64::new(0),
        }
    }

    /// Get or open a slide, caching the handle
    pub async fn get_or_open(&self, id: &str, path: &Path) -> Result<Arc<OpenSlide>, SlideError> {
        // Fast path: try read-first via get_cached() which uses probabilistic LRU
        // This avoids write lock contention for the common case (cache hit)
        if let Some(slide) = self.get_cached(id).await {
            return Ok(slide);
        }

        // Slow path: cache miss - need to open the slide
        // Take write lock and double-check (another thread may have opened it)
        {
            let mut slides = self.slides.write().await;

            if let Some(slide) = slides.get(id) {
                return Ok(Arc::clone(slide));
            }

            debug!("Opening slide: {} at {:?}", id, path);
            let slide = OpenSlide::new(path)
                .map_err(|e| SlideError::OpenError(format!("Failed to open {:?}: {}", path, e)))?;
            let slide = Arc::new(slide);

            // Evict LRU if needed (first item is oldest)
            if slides.len() >= self.max_size
                && let Some((lru_id, _)) = slides.shift_remove_index(0)
            {
                debug!("Evicted slide from cache: {}", lru_id);
                // Also remove metadata
                self.metadata.remove(&lru_id);
            }

            slides.insert(id.to_string(), Arc::clone(&slide));
            Ok(slide)
        }
    }

    /// Get cached metadata for a slide
    pub fn get_metadata(&self, id: &str) -> Option<Arc<SlideMetadata>> {
        self.metadata.get(id).map(|r| Arc::clone(r.value()))
    }

    /// Get a cached slide handle without requiring a path
    /// Returns None if the slide is not in cache
    ///
    /// Uses a read-first approach with probabilistic LRU updates to minimize
    /// write lock contention under high concurrency:
    /// - First checks cache with read lock (fast path, no contention)
    /// - Only takes write lock 1 in N times to update LRU order
    pub async fn get_cached(&self, id: &str) -> Option<Arc<OpenSlide>> {
        // Fast path: read lock to check if item exists
        {
            let slides = self.slides.read().await;
            if let Some(slide) = slides.get(id) {
                let slide_clone = Arc::clone(slide);

                // Probabilistic LRU update: only update every N accesses
                // This dramatically reduces write lock contention under load
                let count = self.access_counter.fetch_add(1, Ordering::Relaxed);
                if count.is_multiple_of(LRU_UPDATE_FREQUENCY) {
                    // Drop read lock before taking write lock
                    drop(slides);
                    // Update LRU order (best effort - may race but that's OK)
                    let mut slides_write = self.slides.write().await;
                    if let Some(slide) = slides_write.shift_remove(id) {
                        slides_write.insert(id.to_string(), slide);
                    }
                }
                return Some(slide_clone);
            }
        }
        None
    }

    /// Set metadata for a slide
    pub fn set_metadata(&self, id: &str, meta: SlideMetadata) {
        self.metadata.insert(id.to_string(), Arc::new(meta));
    }

    /// Get the cached slide list if still valid, or None if expired/empty
    pub async fn get_slide_list(&self) -> Option<Vec<(String, PathBuf)>> {
        let cache = self.slide_list_cache.read().await;
        if let Some(ref list_cache) = *cache
            && list_cache.cached_at.elapsed() < SLIDE_LIST_CACHE_TTL
        {
            return Some(list_cache.slides.clone());
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

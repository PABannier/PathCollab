//! LRU tile cache for caching encoded JPEG tile bytes
//!
//! This cache dramatically improves tile serving performance by caching
//! the encoded JPEG bytes for frequently accessed tiles, avoiding the
//! expensive OpenSlide read + resize + JPEG encode pipeline.
//!
//! Key features:
//! - Concurrent access without global lock (sharded internally by moka)
//! - Size-based eviction (counts total bytes, not just entry count)
//! - Metrics for hit/miss rates
//!
//! Performance impact:
//! - Cache hit: <1ms (memory lookup)
//! - Cache miss: 300-600ms (OpenSlide read + resize + encode)

use bytes::Bytes;
use metrics::{counter, gauge};
use moka::future::Cache;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Key for tile cache entries
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TileKey {
    pub slide_id: String,
    pub level: u32,
    pub x: u32,
    pub y: u32,
}

impl Hash for TileKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.slide_id.hash(state);
        self.level.hash(state);
        self.x.hash(state);
        self.y.hash(state);
    }
}

/// Configuration for the tile cache
#[derive(Debug, Clone)]
pub struct TileCacheConfig {
    /// Maximum cache size in bytes (default: 256MB)
    pub max_size_bytes: u64,
    /// Time-to-live for cache entries (default: 1 hour)
    /// Tiles are immutable, so this is mainly for memory management
    pub ttl: Duration,
    /// Time-to-idle: evict entries not accessed for this duration (default: 30 min)
    pub tti: Duration,
}

impl Default for TileCacheConfig {
    fn default() -> Self {
        Self {
            max_size_bytes: 256 * 1024 * 1024, // 256 MB
            ttl: Duration::from_secs(3600),    // 1 hour
            tti: Duration::from_secs(1800),    // 30 minutes
        }
    }
}

/// Thread-safe LRU tile cache using moka
///
/// Caches encoded JPEG tile bytes keyed by (slide_id, level, x, y).
/// Uses size-based eviction with configurable max bytes.
pub struct TileCache {
    cache: Cache<TileKey, Bytes>,
    /// Total hits counter
    hits: AtomicU64,
    /// Total misses counter
    misses: AtomicU64,
}

impl TileCache {
    /// Create a new tile cache with the given configuration
    pub fn new(config: TileCacheConfig) -> Self {
        let cache = Cache::builder()
            // Weigher counts actual bytes stored
            .weigher(|_key: &TileKey, value: &Bytes| -> u32 {
                // Each entry weighs its byte size (capped at u32::MAX for safety)
                value.len().min(u32::MAX as usize) as u32
            })
            // Max capacity in "weight units" (bytes)
            .max_capacity(config.max_size_bytes)
            // Time-to-live
            .time_to_live(config.ttl)
            // Time-to-idle
            .time_to_idle(config.tti)
            // Build the cache
            .build();

        Self {
            cache,
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    /// Get a cached tile if present
    pub async fn get(&self, key: &TileKey) -> Option<Bytes> {
        let result = self.cache.get(key).await;

        if result.is_some() {
            let hits = self.hits.fetch_add(1, Ordering::Relaxed) + 1;
            counter!("pathcollab_tile_cache_hits_total").increment(1);

            // Update hit rate gauge periodically (every 100 hits)
            if hits % 100 == 0 {
                self.update_hit_rate_gauge();
            }
        } else {
            self.misses.fetch_add(1, Ordering::Relaxed);
            counter!("pathcollab_tile_cache_misses_total").increment(1);
        }

        result
    }

    /// Insert a tile into the cache
    pub async fn insert(&self, key: TileKey, value: Bytes) {
        let size = value.len();
        self.cache.insert(key, value).await;

        // Record the size of cached tiles
        counter!("pathcollab_tile_cache_bytes_inserted_total").increment(size as u64);
    }

    /// Get the current hit rate (0.0 to 1.0)
    fn hit_rate(&self) -> f64 {
        let hits = self.hits.load(Ordering::Relaxed);
        let misses = self.misses.load(Ordering::Relaxed);
        let total = hits + misses;

        if total == 0 {
            0.0
        } else {
            hits as f64 / total as f64
        }
    }

    /// Update the hit rate gauge metric
    fn update_hit_rate_gauge(&self) {
        let rate = self.hit_rate();
        gauge!("pathcollab_tile_cache_hit_rate").set(rate);
        gauge!("pathcollab_tile_cache_entry_count").set(self.cache.entry_count() as f64);
        gauge!("pathcollab_tile_cache_size_bytes").set(self.cache.weighted_size() as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_tile_cache_basic() {
        let cache = TileCache::new(TileCacheConfig::default());

        let key = TileKey {
            slide_id: "test_slide".to_string(),
            level: 10,
            x: 5,
            y: 3,
        };

        // Initially empty
        assert!(cache.get(&key).await.is_none());

        // Insert a tile
        let tile_data = Bytes::from(vec![0u8; 1024]);
        cache.insert(key.clone(), tile_data.clone()).await;

        // Now should be cached
        let cached = cache.get(&key).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap(), tile_data);
    }

    #[tokio::test]
    async fn test_tile_cache_hit_rate() {
        let cache = TileCache::new(TileCacheConfig::default());

        let key = TileKey {
            slide_id: "test".to_string(),
            level: 1,
            x: 0,
            y: 0,
        };

        // Miss
        cache.get(&key).await;
        assert_eq!(cache.hit_rate(), 0.0);

        // Insert
        cache.insert(key.clone(), Bytes::from(vec![1, 2, 3])).await;

        // Hit
        cache.get(&key).await;
        assert_eq!(cache.hit_rate(), 0.5); // 1 hit, 1 miss

        // Another hit
        cache.get(&key).await;
        assert!((cache.hit_rate() - 0.666).abs() < 0.01); // 2 hits, 1 miss
    }
}

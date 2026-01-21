/**
 * Unit Tests for TissueTileIndex
 *
 * Tests the spatial indexing functionality including:
 * - Tile addition and retrieval
 * - Viewport queries with O(k) complexity
 * - Fallback tile lookups from coarser levels
 * - Query caching and invalidation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TissueTileIndex, type ViewportBounds } from './TissueTileIndex'
import type { CachedTile, TileBounds } from '../hooks/useTissueOverlay'
import type { TissueOverlayMetadata } from '../types/overlay'

// Test fixtures
const SLIDE_WIDTH = 100000
const SLIDE_HEIGHT = 100000
const TILE_SIZE = 512

const mockMetadata: TissueOverlayMetadata = {
  slide_id: 'test-slide',
  model_name: 'test-model',
  classes: [
    { id: 0, name: 'stroma' },
    { id: 1, name: 'tumor' },
    { id: 2, name: 'necrosis' },
  ],
  tile_size: TILE_SIZE,
  max_level: 4, // Level 4 is full resolution
  tiles: [], // Tiles are added dynamically in tests
}

function createMockTile(level: number, x: number, y: number, bounds: TileBounds): CachedTile {
  // Calculate scale factor based on max_level (4) - level
  const scaleFactor = Math.pow(2, mockMetadata.max_level - level)
  return {
    level,
    x,
    y,
    width: TILE_SIZE,
    height: TILE_SIZE,
    bounds,
    data: new Uint8Array([0, 1, 2, 3]), // Minimal mock data
    scaleFactor,
    loadTime: performance.now(),
  }
}

describe('TissueTileIndex', () => {
  let index: TissueTileIndex

  beforeEach(() => {
    index = new TissueTileIndex(mockMetadata, SLIDE_WIDTH, SLIDE_HEIGHT)
  })

  describe('addTile', () => {
    it('should add a tile to the index', () => {
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })

      const indexed = index.addTile(tile)

      expect(indexed.tile).toBe(tile)
      expect(index.size).toBe(1)
    })

    it('should return existing tile if already indexed', () => {
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })

      const first = index.addTile(tile)
      const second = index.addTile(tile)

      expect(first).toBe(second)
      expect(index.size).toBe(1)
    })

    it('should assign grid cells based on tile bounds', () => {
      // Tile covering top-left corner
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 5000,
        bottom: 5000,
      })

      const indexed = index.addTile(tile)

      // Should have grid cells assigned
      expect(indexed.gridCells.size).toBeGreaterThan(0)
    })
  })

  describe('getTile', () => {
    it('should retrieve a tile by level and coordinates', () => {
      const tile = createMockTile(3, 5, 7, {
        left: 25000,
        top: 35000,
        right: 35000,
        bottom: 45000,
      })

      index.addTile(tile)

      const retrieved = index.getTile(3, 5, 7)

      expect(retrieved).toBeDefined()
      expect(retrieved?.tile).toBe(tile)
    })

    it('should return undefined for non-existent tile', () => {
      const retrieved = index.getTile(3, 99, 99)

      expect(retrieved).toBeUndefined()
    })
  })

  describe('hasTile', () => {
    it('should return true for indexed tile', () => {
      const tile = createMockTile(2, 1, 1, {
        left: 10000,
        top: 10000,
        right: 20000,
        bottom: 20000,
      })

      index.addTile(tile)

      expect(index.hasTile(2, 1, 1)).toBe(true)
    })

    it('should return false for non-existent tile', () => {
      expect(index.hasTile(2, 1, 1)).toBe(false)
    })
  })

  describe('queryViewport', () => {
    it('should return tiles that intersect the viewport', () => {
      // Add tiles at level 3 covering different regions
      const tile1 = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })
      const tile2 = createMockTile(3, 1, 0, {
        left: 10000,
        top: 0,
        right: 20000,
        bottom: 10000,
      })
      const tile3 = createMockTile(3, 0, 1, {
        left: 0,
        top: 10000,
        right: 10000,
        bottom: 20000,
      })
      // Tile far away that shouldn't be in viewport
      const tile4 = createMockTile(3, 5, 5, {
        left: 50000,
        top: 50000,
        right: 60000,
        bottom: 60000,
      })

      index.addTile(tile1)
      index.addTile(tile2)
      index.addTile(tile3)
      index.addTile(tile4)

      // Query viewport covering only first 3 tiles
      const viewport: ViewportBounds = {
        left: 0,
        top: 0,
        right: 15000,
        bottom: 15000,
      }

      const result = index.queryViewport(3, viewport)

      // Should find tile1, tile2, and tile3
      expect(result.length).toBe(3)
      const tileCoords = result.map((t) => `${t.tile.x},${t.tile.y}`)
      expect(tileCoords).toContain('0,0')
      expect(tileCoords).toContain('1,0')
      expect(tileCoords).toContain('0,1')
      // Should NOT include tile4
      expect(tileCoords).not.toContain('5,5')
    })

    it('should only return tiles at the specified level', () => {
      // Add tiles at different levels
      const tile_level2 = createMockTile(2, 0, 0, {
        left: 0,
        top: 0,
        right: 20000,
        bottom: 20000,
      })
      const tile_level3 = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })
      const tile_level4 = createMockTile(4, 0, 0, {
        left: 0,
        top: 0,
        right: 5000,
        bottom: 5000,
      })

      index.addTile(tile_level2)
      index.addTile(tile_level3)
      index.addTile(tile_level4)

      const viewport: ViewportBounds = {
        left: 0,
        top: 0,
        right: 25000,
        bottom: 25000,
      }

      // Query only level 3
      const result = index.queryViewport(3, viewport)

      expect(result.length).toBe(1)
      expect(result[0].tile.level).toBe(3)
    })

    it('should return empty array for empty viewport', () => {
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })

      index.addTile(tile)

      // Viewport that doesn't intersect any tiles
      const viewport: ViewportBounds = {
        left: 90000,
        top: 90000,
        right: 95000,
        bottom: 95000,
      }

      const result = index.queryViewport(3, viewport)

      expect(result.length).toBe(0)
    })

    it('should use cached result for identical viewport query', () => {
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })

      index.addTile(tile)

      const viewport: ViewportBounds = {
        left: 0,
        top: 0,
        right: 15000,
        bottom: 15000,
      }

      const result1 = index.queryViewport(3, viewport)
      const result2 = index.queryViewport(3, viewport)

      // Should return same array reference (cached)
      expect(result1).toBe(result2)
    })
  })

  describe('findFallback', () => {
    it('should find a coarser tile that covers the target area', () => {
      // Add a coarse tile at level 1
      const coarseTile = createMockTile(1, 0, 0, {
        left: 0,
        top: 0,
        right: 50000,
        bottom: 50000,
      })

      index.addTile(coarseTile)

      // Try to find fallback for a finer tile at level 3
      const targetBounds: TileBounds = {
        left: 5000,
        top: 5000,
        right: 15000,
        bottom: 15000,
      }

      const fallback = index.findFallback(3, 0, 0, targetBounds)

      expect(fallback).not.toBeNull()
      expect(fallback?.tile).toBe(coarseTile)
      // Texture coords should map to the portion of coarse tile
      expect(fallback?.texCoords.u0).toBeCloseTo(0.1) // 5000/50000
      expect(fallback?.texCoords.v0).toBeCloseTo(0.1) // 5000/50000
      expect(fallback?.texCoords.u1).toBeCloseTo(0.3) // 15000/50000
      expect(fallback?.texCoords.v1).toBeCloseTo(0.3) // 15000/50000
    })

    it('should return null if no fallback tile covers the area', () => {
      // Add a tile that doesn't cover the target area
      const tile = createMockTile(1, 2, 2, {
        left: 50000,
        top: 50000,
        right: 75000,
        bottom: 75000,
      })

      index.addTile(tile)

      // Target area is in a different region
      const targetBounds: TileBounds = {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      }

      const fallback = index.findFallback(3, 0, 0, targetBounds)

      expect(fallback).toBeNull()
    })

    it('should prefer closer level fallbacks', () => {
      // Add tiles at multiple levels covering the same area
      const level0Tile = createMockTile(0, 0, 0, {
        left: 0,
        top: 0,
        right: 100000,
        bottom: 100000,
      })
      const level1Tile = createMockTile(1, 0, 0, {
        left: 0,
        top: 0,
        right: 50000,
        bottom: 50000,
      })
      const level2Tile = createMockTile(2, 0, 0, {
        left: 0,
        top: 0,
        right: 25000,
        bottom: 25000,
      })

      index.addTile(level0Tile)
      index.addTile(level1Tile)
      index.addTile(level2Tile)

      // Target at level 3
      const targetBounds: TileBounds = {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      }

      const fallback = index.findFallback(3, 0, 0, targetBounds)

      // Should find level 2 (closest to level 3)
      expect(fallback).not.toBeNull()
      expect(fallback?.tile.level).toBe(2)
    })
  })

  describe('getTilesAtLevel', () => {
    it('should return all tiles at the specified level', () => {
      const tile1 = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })
      const tile2 = createMockTile(3, 1, 0, {
        left: 10000,
        top: 0,
        right: 20000,
        bottom: 10000,
      })
      const tile3 = createMockTile(2, 0, 0, {
        left: 0,
        top: 0,
        right: 20000,
        bottom: 20000,
      })

      index.addTile(tile1)
      index.addTile(tile2)
      index.addTile(tile3)

      const level3Tiles = index.getTilesAtLevel(3)
      const level2Tiles = index.getTilesAtLevel(2)

      expect(level3Tiles.length).toBe(2)
      expect(level2Tiles.length).toBe(1)
    })

    it('should return empty array for level with no tiles', () => {
      const tiles = index.getTilesAtLevel(4)

      expect(tiles).toEqual([])
    })
  })

  describe('clear', () => {
    it('should remove all tiles from the index', () => {
      const tile1 = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })
      const tile2 = createMockTile(3, 1, 0, {
        left: 10000,
        top: 0,
        right: 20000,
        bottom: 10000,
      })

      index.addTile(tile1)
      index.addTile(tile2)
      expect(index.size).toBe(2)

      index.clear()

      expect(index.size).toBe(0)
      expect(index.getTile(3, 0, 0)).toBeUndefined()
      expect(index.getTile(3, 1, 0)).toBeUndefined()
    })
  })

  describe('invalidateCache', () => {
    it('should force re-query after cache invalidation', () => {
      const tile = createMockTile(3, 0, 0, {
        left: 0,
        top: 0,
        right: 10000,
        bottom: 10000,
      })

      index.addTile(tile)

      const viewport: ViewportBounds = {
        left: 0,
        top: 0,
        right: 15000,
        bottom: 15000,
      }

      const result1 = index.queryViewport(3, viewport)
      index.invalidateCache()
      const result2 = index.queryViewport(3, viewport)

      // After invalidation, should be a new array (not same reference)
      expect(result1).not.toBe(result2)
      // But contents should be equivalent
      expect(result1.length).toBe(result2.length)
    })
  })
})
